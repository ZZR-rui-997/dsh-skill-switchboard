// dsh-skill-switchboard — host half (v2)
// Internal commands (all recordInput:false, never enter model context):
//   /skills-panel-list    {cwd?}              → user-owned skill catalog (incl. disabled) + body text for full-text search
//   /skills-panel-set     {path,field,value}  → rewrite frontmatter flags (enabled|model|user)
//   /skills-panel-read    {path}              → raw SKILL.md text (editor)
//   /skills-panel-write   {path,content}      → save SKILL.md (editor), BOM/EOL preserving
//   /skills-panel-check   {path}              → spec validation report (kebab name, description, bool flags…)
//   /skills-panel-fix     {path}              → auto-repair spec violations (rename dir + rewrite frontmatter)
//   /skills-panel-create  {root,name,description?} → create new skill dir + SKILL.md
//   /skills-panel-import  {source,targetRoot?}    → copy a skill folder into a user root (batch-safe, dup handling)
//   /skills-panel-delete  {path}              → delete skill dir (recycle-safe: refuses junction roots)
// Only node: builtins + ctx services (no @deepseek-ai imports — not resolvable from profile).

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync, renameSync, statSync, lstatSync, cpSync, copyFileSync } from 'node:fs';
import { join, basename, dirname, extname, resolve as pathResolve, sep as pathSep, dirname as pathDirname, basename as pathBasename } from 'node:path';
import { realpathSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { homedir, tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const NS = 'dsh-skill-switchboard';

// field 'model' controls disable-model-invocation (inverted); field 'user' controls user-invocable.
const FIELD_KEY = { model: 'disable-model-invocation', user: 'user-invocable' };
const MAX_BODY_CHARS = 20000;   // full-text search payload cap per skill
const MAX_EDIT_BYTES = 2 * 1024 * 1024; // editor save cap (mirrors yanglaofish 2MB)

// ---------- panel data (groups.json tags) + self version (batch2) ----------
const PANEL_DIR = () => join(homedir(), '.dsh', 'skills-panel');

// Sandbox-aware default target root: when SP_TEST_ROOTS is set (test mode), writes
// must never fall back to the real user skills root (see docs/BUG-2026-11-25-e2e-pollutes-user-skills.md).
function defaultTargetRoot() {
  const testRoot = (process.env.SP_TEST_ROOTS || '').split('|').map((s) => s.trim()).filter(Boolean)[0];
  return testRoot ? join(testRoot, '_import-target')
                  : join(homedir(), '.dsh', 'skills');
}
function loadGroups() {
  try {
    const raw = readFileSync(join(PANEL_DIR(), 'groups.json'), 'utf8');
    const data = JSON.parse(raw);
    return (data && typeof data === 'object' && data.tags && typeof data.tags === 'object') ? data : { tags: {} };
  } catch { return { tags: {} }; }
}
function saveGroups(data) {
  try {
    mkdirSync(PANEL_DIR(), { recursive: true });
    writeFileSync(join(PANEL_DIR(), 'groups.json'), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch { return false; }
}
function sanitizeTags(list) {
  if (!Array.isArray(list)) return [];
  const seen = [];
  for (const t of list) {
    const s = String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
    if (s && !seen.includes(s)) seen.push(s);
    if (seen.length >= 12) break;
  }
  return seen;
}
function versionOfSelf() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    return String(pkg.version || 'unknown');
  } catch { return 'unknown'; }
}

function safe(fn, ctx, invocation) {
  return Promise.resolve()
    .then(() => fn(ctx, invocation))
    .catch((e) => ({ kind: 'error', text: (e && e.message) || String(e) }));
}

function parsePayload(rawInput) {
  const text = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new Error('payload 不是合法 JSON: ' + text.slice(0, 200));
  }
}

// ---------- frontmatter surgery ----------

function detectEol(text) {
  const idx = text.indexOf('\n');
  if (idx > 0 && text[idx - 1] === '\r') return '\r\n';
  return '\n';
}

function parseFrontmatter(raw) {
  const out = {};
  const lines = raw.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i >= lines.length || lines[i].trim() !== '---') return out;
  for (let j = i + 1; j < lines.length; j += 1) {
    if (lines[j].trim() === '---') break;
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[j]);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

// Writes `key: true|false` into the SKILL.md frontmatter (replaces, inserts, or creates the block).
function applyFrontmatterFlag(file, key, value) {
  let raw = readFileSync(file, 'utf8');
  let hadBom = false;
  if (raw.charCodeAt(0) === 0xfeff) {
    hadBom = true;
    raw = raw.slice(1);
  }
  const eol = detectEol(raw);
  let lines = raw.split(/\r?\n/);
  const flagLine = `${key}: ${value ? 'true' : 'false'}`;
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i < lines.length && lines[i].trim() === '---') {
    let close = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === '---') { close = j; break; }
    }
    if (close === -1) {
      lines = ['---', flagLine, '---', ''].concat(lines);
    } else {
      const keyRe = new RegExp('^\\s*' + key.replace(/-/g, '\\-') + '\\s*:');
      let found = false;
      for (let j = i + 1; j < close; j += 1) {
        if (keyRe.test(lines[j])) { lines[j] = flagLine; found = true; break; }
      }
      if (!found) lines.splice(i + 1, 0, flagLine);
    }
  } else {
    lines = ['---', flagLine, '---', ''].concat(lines);
  }
  writeFileSync(file, (hadBom ? '\uFEFF' : '') + lines.join(eol), 'utf8');
  return true;
}

// Replace one scalar frontmatter value (used by spec fix for name/description).
function applyFrontmatterScalar(file, key, value) {
  let raw = readFileSync(file, 'utf8');
  let hadBom = false;
  if (raw.charCodeAt(0) === 0xfeff) { hadBom = true; raw = raw.slice(1); }
  const eol = detectEol(raw);
  let lines = raw.split(/\r?\n/);
  const needsQuote = /[:#\[\]{}&*!|>'"%@`,]/.test(value) || value.trim() !== value || value === '';
  const encoded = needsQuote ? JSON.stringify(value) : value;
  const flagLine = `${key}: ${encoded}`;
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i < lines.length && lines[i].trim() === '---') {
    let close = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === '---') { close = j; break; }
    }
    if (close === -1) {
      lines = ['---', flagLine, '---', ''].concat(lines);
    } else {
      const keyRe = new RegExp('^\\s*' + key.replace(/-/g, '\\-') + '\\s*:');
      let found = false;
      for (let j = i + 1; j < close; j += 1) {
        if (keyRe.test(lines[j])) { lines[j] = flagLine; found = true; break; }
      }
      if (!found) lines.splice(i + 1, 0, flagLine);
    }
  } else {
    lines = ['---', flagLine, '---', ''].concat(lines);
  }
  writeFileSync(file, (hadBom ? '\uFEFF' : '') + lines.join(eol), 'utf8');
  return true;
}

// Remove a frontmatter key line entirely (spec fix for invalid bool values).
function removeFrontmatterKey(file, key) {
  let raw = readFileSync(file, 'utf8');
  let hadBom = false;
  if (raw.charCodeAt(0) === 0xfeff) { hadBom = true; raw = raw.slice(1); }
  const eol = detectEol(raw);
  let lines = raw.split(/\r?\n/);
  const keyRe = new RegExp('^\\s*' + key.replace(/-/g, '\\-') + '\\s*:');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i < lines.length && lines[i].trim() === '---') {
    let close = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j].trim() === '---') { close = j; break; }
    }
    if (close !== -1) {
      for (let j = close - 1; j > i; j -= 1) {
        if (keyRe.test(lines[j])) { lines.splice(j, 1); break; }
      }
    }
  }
  writeFileSync(file, (hadBom ? '\uFEFF' : '') + lines.join(eol), 'utf8');
  return true;
}

// ---------- listing ----------

function normBool(v, dflt) {
  if (typeof v !== 'string') return dflt;
  const s = v.trim().toLowerCase();
  if (s === 'true' || s === 'yes' || s === 'on' || s === '1') return true;
  if (s === 'false' || s === 'no' || s === 'off' || s === '0') return false;
  return dflt;
}

function boolRawValid(v) {
  if (typeof v !== 'string') return true; // absent is fine
  return /^(true|false|yes|no|on|off|1|0)$/i.test(v.trim());
}

function rowFromSummary(s) {
  const inv = s.invocation || {};
  return {
    name: s.name,
    description: s.description || '',
    whenToUse: s.whenToUse || '',
    modelInvocable: inv.modelInvocable !== false,
    userInvocable: inv.userInvocable !== false,
    path: typeof s.path === 'string' ? s.path : null,
    source: s.source || '',
    rank: typeof s.rank === 'number' ? s.rank : null,
  };
}

async function listViaRegistry(skills, cwd, signal) {
  const options = {};
  if (cwd) options.cwd = cwd;
  if (signal) options.signal = signal;
  const snap = await skills.snapshot(options);
  const list = (snap && Array.isArray(snap.skills)) ? snap.skills : [];
  return list.map(rowFromSummary);
}

// Fallback: scan the default skill roots directly (mirrors filesystem provider ranks).
function rootsFor(cwd) {
  const home = homedir();
  const roots = [];
  if (cwd) {
    roots.push({ dir: join(cwd, '.dsh', 'skills'), kind: 'project', rank: 100 });
    roots.push({ dir: join(cwd, '.agents', 'skills'), kind: 'project-agents', rank: 200 });
  }
  roots.push({ dir: join(home, '.dsh', 'skills'), kind: 'user', rank: 400 });
  roots.push({ dir: join(home, '.agents', 'skills'), kind: 'agents', rank: 500 });
  if (process.env.DSH_BUNDLED_SKILL_DIR) {
    roots.push({ dir: process.env.DSH_BUNDLED_SKILL_DIR, kind: 'bundled', rank: 600 });
  }
  if (process.env.SP_TEST_ROOTS) {
    // Sandbox/testing roots — same injection point as userRootList.
    let i = 0;
    for (const p of process.env.SP_TEST_ROOTS.split('|')) {
      if (p) roots.push({ dir: p, kind: 'user', rank: 400 + i }); i += 1;
    }
  }
  return roots;
}

function isJunctionOrSymlink(dir) {
  try { const st = lstatSync(dir); return st.isSymbolicLink(); } catch { return false; }
}

function rowFromDir(dir, kind, rank) {
  const skillFile = join(dir, 'SKILL.md');
  if (!existsSync(skillFile)) return null;
  let raw = '';
  let mtimeMs = null;
  let bytes = null;
  try { raw = readFileSync(skillFile, 'utf8'); } catch { return null; }
  try { const st = statSync(skillFile); mtimeMs = st.mtimeMs; bytes = st.size; } catch { /* optional */ }
  const fm = parseFrontmatter(raw);
  const dirName = basename(dir);
  return {
    name: fm.name || dirName,
    description: fm.description || '',
    whenToUse: '',
    // disable-model-invocation 缺省 = false（模型可调用）；显式 true 才禁用
    modelInvocable: !normBool(fm['disable-model-invocation'], false),
    userInvocable: normBool(fm['user-invocable'], true),
    path: skillFile,
    dir,
    source: kind,
    rank,
    linked: isJunctionOrSymlink(dir),
    body: raw.length > MAX_BODY_CHARS ? raw.slice(0, MAX_BODY_CHARS) : raw,
    dirName,
    // 徽章数据：修改时间（毫秒）+ 正文字节（token 粗估 = bytes/2.5，中英混合经验值）
    mtimeMs,
    bytes,
  };
}

function scanAll(cwd) {
  const byName = new Map();
  for (const root of rootsFor(cwd)) {
    let entries = [];
    try { entries = readdirSync(root.dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      // ent.isDirectory() is FALSE for junctions/symlinks (readdirSync withFileTypes
      // reports lstat facts) — must stat() the target to know it's a real dir.
      const full = join(root.dir, ent.name);
      let isDir = ent.isDirectory();
      if (!isDir && (ent.isSymbolicLink() || ent.isJunction?.())) {
        try { isDir = statSync(full).isDirectory(); } catch { isDir = false; }
      }
      if (!isDir) continue;
      const row = rowFromDir(full, root.kind, root.rank);
      if (!row) continue;
      const prev = byName.get(row.name);
      if (!prev || row.rank < prev.rank) byName.set(row.name, row);
    }
  }
  return Array.from(byName.values());
}

// ---------- spec check & fix ----------

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function checkSkill(row) {
  const issues = [];
  const raw = readFileSync(row.path, 'utf8').replace(/^\uFEFF/, '');
  const fm = parseFrontmatter(raw);
  const lines = raw.split(/\r?\n/);
  let hasFm = lines[0] != null && lines[0].trim() === '---';
  if (!hasFm) issues.push({ code: 'no-frontmatter', message: '缺少 YAML frontmatter（--- 开头）', fixable: true });
  if (!fm.name) issues.push({ code: 'name-missing', message: 'frontmatter 缺少 name 字段', fixable: true });
  else if (!KEBAB_RE.test(fm.name)) issues.push({ code: 'name-not-kebab', message: `name「${fm.name}」不是 kebab-case`, fixable: true });
  else if (row.dirName && fm.name !== row.dirName) issues.push({ code: 'name-dir-mismatch', message: `name「${fm.name}」与目录名「${row.dirName}」不一致`, fixable: true });
  if (!fm.description) issues.push({ code: 'description-missing', message: '缺少 description（DSH 会排除无描述的技能）', fixable: false });
  for (const key of ['disable-model-invocation', 'user-invocable']) {
    if (raw.split(/\r?\n/).some((l) => new RegExp('^\\s*' + key.replace(/-/g, '\\-') + '\\s*:').test(l))
      && !boolRawValid(fm[key]) && fm[key] !== undefined) {
      issues.push({ code: 'bad-bool:' + key, message: `${key} 的值「${fm[key]}」不是合法布尔`, fixable: true });
    }
  }
  return { issues, hasFm };
}

// 面板只显示用户自己安装/编写的技能（用户要求 m00950/m00987）：
// 按 skill 根目录归属判断——路径落在 ~/.dsh/skills、~/.agents/skills、<cwd>/.dsh/skills、
// <cwd>/.agents/skills（含指向 .workbuddy 的 Junction，因为链接本身在用户根目录下）→ 保留；
// bundled / 插件包内路径 → 排除。
function filterUserOwned(rows, cwd) {
  const home = homedir().toLowerCase();
  const userRoots = [
    join(home, '.dsh', 'skills'),
    join(home, '.agents', 'skills'),
    // Junction 技能（nature-*、fluent-pyfluent-ops）经注册表解析后返回 .workbuddy 真实路径；
    // .workbuddy/skills 本身就是用户自己的技能库，链入 DSH 的才会出现在注册表里。
    join(home, '.workbuddy', 'skills'),
  ];
  if (cwd) {
    const c = String(cwd).toLowerCase();
    userRoots.push(join(c, '.dsh', 'skills'));
    userRoots.push(join(c, '.agents', 'skills'));
  }
  if (process.env.SP_TEST_ROOTS) {
    for (const p of process.env.SP_TEST_ROOTS.split('|')) {
      if (p) userRoots.push(p.toLowerCase());
    }
  }
  return (rows || []).filter((r) => {
    if (!r.path) return false; // bundled / registry 无路径来源 → 排除
    const p = canonUserPath(r.path);
    if (!p) return false; // 无法解析的路径视为不可信
    for (const root of userRoots) {
      const cr = canonUserPath(root);
      if (cr && p.startsWith(cr)) return true;
    }
    return false;
  });
}

async function handleList(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  // Resolve the session's working directory from the receiving agent, so that
  // PROJECT-level skills (<cwd>/.dsh/skills, <cwd>/.agents/skills) are visible too.
  // Commands run against the exact receiving agent (dsh-commands adapter), and the
  // agent context exposes the working-directory service (serviceKey 'workingDirectory').
  let cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : undefined;
  if (!cwd) {
    try {
      const agent = invocation && invocation.agent;
      if (agent) {
        const wd = ctx.workingDirectory || (typeof ctx.get === 'function' && ctx.get('workingDirectory'));
        // wd.get(session) → committed directory string (stateOf(session) ?? defaultDirectory).
        const dir = wd && typeof wd.get === 'function' ? wd.get(agent.session || agent) : null;
        if (typeof dir === 'string' && dir) cwd = dir;
      }
    } catch (e) { /* keep undefined → user roots only */ }
  }
  let skills = null;
  try {
    // ctx 属性访问本身可能因 inject 门禁抛错（cordis gated proxy）——必须捕获，
    // 否则整个命令失败；捕获后走 scanAll fs 兜底，功能一致。
    skills = ctx.skills || (typeof ctx.get === 'function' && ctx.get('skills'));
  } catch (e) {
    skills = null;
  }
  let rows = null;
  let via = 'scan';
  // Strategy: the fs scan is deterministic and complete (junction-aware, all user roots,
  // no registry cache/scope filtering). The registry snapshot proved to return scoped
  // subsets depending on which session the command ran against. Prefer SCAN always;
  // fall back to registry only if the scan throws unexpectedly.
  try {
    rows = scanAll(cwd);
  } catch (e) {
    console.error('[' + NS + '] fs scan failed, falling back to registry:', e && e.message);
    rows = null;
  }
  if (!rows && skills && typeof skills.snapshot === 'function') {
    try {
      rows = await listViaRegistry(skills, cwd, invocation && invocation.signal);
      via = 'registry';
    } catch (e) {
      console.error('[' + NS + '] registry snapshot failed:', e && e.message);
      rows = null;
    }
  }
  if (!rows) rows = scanAll(cwd);
  rows = filterUserOwned(rows, cwd);
  const groupsData = loadGroups();
  for (const r of rows) r.tags = sanitizeTags(groupsData.tags[r.name] || []);
  rows.sort((a, b) => a.name.localeCompare(b.name));
  // 下发候选根目录，客户端（新建/归档对话框）据此渲染根选择器，不再硬编码本机路径。
  const roots = userRootList();
  return { kind: 'success', text: JSON.stringify({ ok: true, via, roots, skills: rows }) };
}

// ---------- backups & optimistic lock (batch1 #2/#6) ----------

// Backup root lives under ~/.dsh/skills-panel-backups (NOT inside a scanned skills root,
// so the engine/panel never mistake backups for skills). Flat dir, filename carries the
// timestamp + originating root hash + skill name; capped by pruneBackups.
function backupRoot() {
  return join(homedir(), '.dsh', 'skills-panel-backups');
}

const BACKUP_CAP = 100;

// Cross-device rename fallback (EXDEV): central trash/archive live on the home drive,
// project skills may live on another drive — copy+remove instead of failing.
function renameAnywhere(from, to) {
  try {
    renameSync(from, to);
  } catch (e) {
    if (e && e.code === 'EXDEV') {
      cpSync(from, to, { recursive: true });
      rmSync(from, { recursive: true, force: true });
    } else {
      throw e;
    }
  }
}

function stampNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

// Snapshot one SKILL.md before a write-family operation. Best-effort: a backup
// failure must never block the user's actual operation, so errors are swallowed
// (reported in the returned label only).
function backupSkillFile(file) {
  try {
    if (!existsSync(file)) return null;
    const root = backupRoot();
    mkdirSync(root, { recursive: true });
    const dirReal = (() => { try { return realpathSync(dirname(file)); } catch { return dirname(file); } })();
    // Encode the originating root into the filename (short hash) so restore knows where it came from.
    let h = 0;
    for (const ch of String(dirReal)) { h = ((h * 31) + ch.charCodeAt(0)) >>> 0; }
    const name = basename(dirReal);
    const target = join(root, stampNow() + '-' + h.toString(36) + '-' + name.replace(/[^A-Za-z0-9_-]/g, '_') + '-SKILL.md');
    copyFileSync(file, target);
    pruneBackups();
    return target;
  } catch (e) {
    console.error('[' + NS + '] backup failed (continuing):', e && e.message);
    return null;
  }
}

function pruneBackups() {
  try {
    const root = backupRoot();
    const entries = readdirSync(root).filter((f) => f.endsWith('-SKILL.md')).sort();
    while (entries.length > BACKUP_CAP) {
      const oldest = entries.shift();
      try { rmSync(join(root, oldest), { force: true }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// List the most recent backups (newest first), with parsed timestamps.
function listBackups(limit) {
  try {
    const root = backupRoot();
    const entries = readdirSync(root)
      .filter((f) => f.endsWith('-SKILL.md'))
      .sort()
      .reverse()
      .slice(0, Math.max(1, Math.min(200, limit || 30)))
      .map((f) => {
        const m = /^(\d{8})-(\d{4})-(\w+)-(.+)-SKILL\.md$/.exec(f);
        const ts = m ? m[1] + '-' + m[2].slice(0, 2) + ':' + m[2].slice(2) : '';
        return { file: join(root, f), name: m ? m[4] : f, ts, rootTag: m ? m[3] : '' };
      });
    return entries;
  } catch { return []; }
}

// Optimistic lock: refuse to overwrite a file that changed on disk since the client read it.
// baselineMtimeMs comes from the read response; when absent (older clients) the lock is skipped.
function assertNotStale(file, baselineMtimeMs, label) {
  if (typeof baselineMtimeMs !== 'number' || !isFinite(baselineMtimeMs)) return null;
  let cur = null;
  try { cur = statSync(file).mtimeMs; } catch { return null; }
  // 5ms tolerance for FAT/NTFS timestamp rounding.
  if (Math.abs(cur - baselineMtimeMs) > 5) {
    throw new Error((label || '保存被拒绝') + '：文件在读取后被外部修改过（mtime 已变化）。请刷新后重试，避免覆盖外部改动。');
  }
  return cur;
}

async function handleSet(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const file = assertSkillFile(typeof payload.path === 'string' ? payload.path : '', (await cwdOf(ctx, invocation)));
  const field = payload.field;
  const value = payload.value;
  if (field !== 'enabled' && field !== 'model' && field !== 'user') {
    throw new Error("field 必须是 'enabled'、'model' 或 'user'");
  }
  if (typeof value !== 'boolean') {
    throw new Error('value 必须是布尔值');
  }
  if (!existsSync(file)) {
    throw new Error('SKILL.md 不存在: ' + file);
  }
  assertNotStale(file, payload.baselineMtimeMs, '开关写入被拒绝');
  backupSkillFile(file);
  if (field === 'enabled') {
    // 整体开关（用户要求：像插件页一样只有一个开关）：
    // 开 = 对模型与用户都可用；关 = 都不可见。
    applyFrontmatterFlag(file, 'disable-model-invocation', !value);
    applyFrontmatterFlag(file, 'user-invocable', value);
    return {
      kind: 'success',
      text: JSON.stringify({ ok: true, path: file, field, value, written: { model: value, user: value } }),
    };
  }
  const key = FIELD_KEY[field];
  const fmValue = field === 'model' ? !value : value; // disable-model-invocation is the inverted flag
  applyFrontmatterFlag(file, key, fmValue);
  return {
    kind: 'success',
    text: JSON.stringify({ ok: true, path: file, field, value, key, written: fmValue }),
  };
}

// ---------- editor: read / write ----------

async function handleRead(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const file = assertSkillFile(typeof payload.path === 'string' ? payload.path : '', (await cwdOf(ctx, invocation)));
  if (!existsSync(file)) throw new Error('文件不存在: ' + file);
  const st = statSync(file);
  if (st.size > MAX_EDIT_BYTES) throw new Error('文件超过 2MB，请在编辑器中直接打开');
  let content = readFileSync(file, 'utf8');
  let hadBom = content.charCodeAt(0) === 0xfeff;
  if (hadBom) content = content.slice(1);
  return { kind: 'success', text: JSON.stringify({ ok: true, path: file, content, hadBom, bytes: st.size, baselineMtimeMs: st.mtimeMs }) };
}

async function handleWrite(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const file = assertSkillFile(typeof payload.path === 'string' ? payload.path : '', (await cwdOf(ctx, invocation)));
  const content = payload.content;
  if (content == null) throw new Error('content 缺失');
  if (Buffer.byteLength(content, 'utf8') > MAX_EDIT_BYTES) throw new Error('内容超过 2MB 上限');
  if (!existsSync(file)) throw new Error('文件不存在: ' + file);
  assertNotStale(file, payload.baselineMtimeMs, '保存被拒绝');
  backupSkillFile(file);
  // Write back preserving the original BOM + EOL style.
  let hadBom = payload.hadBom === true;
  if (!hadBom) {
    try { hadBom = readFileSync(file, 'utf8').charCodeAt(0) === 0xfeff; } catch { hadBom = false; }
  }
  const eol = payload.eol === '\r\n' || detectEol(content) === '\r\n' ? '\r\n' : '\n';
  const body = content.replace(/^\uFEFF/, '');
  writeFileSync(file, (hadBom ? '\uFEFF' : '') + body.replace(/\r?\n/g, eol), 'utf8');
  let mtimeMs = null;
  try { mtimeMs = statSync(file).mtimeMs; } catch { /* optional */ }
  return { kind: 'success', text: JSON.stringify({ ok: true, path: file, bytes: Buffer.byteLength(body, 'utf8'), mtimeMs }) };
}

// ---------- spec: check / fix ----------

function skillDirOf(file) { return dirname(file); }

async function handleCheck(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const file = assertSkillFile(typeof payload.path === 'string' ? payload.path : '', (await cwdOf(ctx, invocation)));
  if (!existsSync(file)) throw new Error('文件不存在: ' + file);
  const row = { path: file, dir: skillDirOf(file), dirName: basename(skillDirOf(file)) };
  const { issues } = checkSkill(row);
  return { kind: 'success', text: JSON.stringify({ ok: true, path: file, issues, clean: issues.length === 0 }) };
}

async function handleFix(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const file = assertSkillFile(typeof payload.path === 'string' ? payload.path : '', (await cwdOf(ctx, invocation)));
  if (!existsSync(file)) throw new Error('文件不存在: ' + file);
  backupSkillFile(file);
  let dir = skillDirOf(file);
  const row = { path: file, dir, dirName: basename(dir) };
  const { issues } = checkSkill(row);
  const applied = [];
  let renamed = null;
  // Fix steps mutate the same file/dir — rename LAST so earlier fixes never chase a moved path.
  const renamePlan = [];
  for (const issue of issues) {
    try {
      if (issue.code === 'no-frontmatter') {
        // Wrap whole file in a minimal frontmatter block (name from dir).
        const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
        const eol = detectEol(raw);
        writeFileSync(file, '---\nname: ' + basename(dir) + '\ndescription: ""\n---\n' + (raw.startsWith('---') ? raw : raw.replace(/\r?\n/g, eol)));
        applied.push(issue.code);
      } else if (issue.code === 'name-missing' || issue.code === 'name-not-kebab' || issue.code === 'name-dir-mismatch') {
        // Directory name is the source of truth (mirrors ytxue auto-fix).
        let target = row.dirName;
        if (!KEBAB_RE.test(target)) {
          target = target.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        }
        applyFrontmatterScalar(file, 'name', target);
        applied.push(issue.code);
        // Rename the dir itself if it is not kebab (skip junctions — cannot rename a link safely).
        if (!KEBAB_RE.test(row.dirName) && !isJunctionOrSymlink(dir)) {
          renamePlan.push({ from: dir, to: join(dirname(dir), target) });
        }
      } else if (issue.code === 'description-missing') {
        applyFrontmatterScalar(file, 'description', '');
        applied.push(issue.code);
      } else if (issue.code.startsWith('bad-bool:')) {
        removeFrontmatterKey(file, issue.code.slice(9));
        applied.push(issue.code);
      }
    } catch (e) {
      // One failing fix must not abort the rest.
      console.error('[' + NS + '] fix ' + issue.code + ' failed:', e && e.message);
    }
  }
  for (const plan of renamePlan) {
    try {
      if (!existsSync(plan.to)) {
        renameSync(plan.from, plan.to);
        renamed = { from: plan.from, to: plan.to };
        file = join(plan.to, 'SKILL.md'); // keep path fresh for the response
      }
    } catch (e) {
      console.error('[' + NS + '] rename failed:', e && e.message);
    }
  }
  return { kind: 'success', text: JSON.stringify({ ok: true, path: file, applied, renamed, checked: issues.map((i) => i.code) }) };
}

// ---------- create / import / delete ----------

// ---------- path security helpers ----------
// Canonicalize a path for security checks: absolute, realpath'd (junctions/symlinks
// resolved), case-normalized, with a trailing separator so prefix tests cannot match
// sibling directories. Returns null when the path does not exist on disk.
// Session cwd of this command invocation (agent.session wins, fallback agent.id/sessionId).
async function cwdOf(ctx, invocation) {
  try {
    const agent = invocation && invocation.agent;
    const wd = ctx && (ctx.workingDirectory || (typeof ctx.get === 'function' && ctx.get('workingDirectory')));
    if (wd && typeof wd.get === 'function') {
      const s = agent && (agent.session || agent.sessionId || agent.id);
      const d = await wd.get(s || agent);
      if (typeof d === 'string' && d) return d;
    }
  } catch { /* ignore */ }
  return undefined;
}

function canonUserPath(p) {
  try {
    let full = pathResolve(String(p || ''));
    try { full = realpathSync(full); } catch { /* keep unresolved when missing */ }
    let c = full.toLowerCase();
    if (!c.endsWith('\\') && !c.endsWith('/')) c += pathSep;
    return c;
  } catch { return null; }
}

function userRootList(cwd) {
  const home = homedir();
  const roots = [
    join(home, '.dsh', 'skills'),
    join(home, '.agents', 'skills'),
    join(home, '.workbuddy', 'skills'),
  ];
  try {
    // M5: the session's working directory (not the host process cwd) decides which
    // project roots are writable — otherwise project skills list but fail writes.
    const base = typeof cwd === 'string' && cwd ? cwd : process.cwd();
    if (base) {
      roots.push(join(base, '.dsh', 'skills'), join(base, '.agents', 'skills'));
    }
  } catch { /* ignore */ }
  if (process.env.SP_TEST_ROOTS) {
    for (const p of process.env.SP_TEST_ROOTS.split('|')) {
      if (p) roots.push(p);
    }
  }
  return roots;
}

function assertUserRoot(root, cwd) {
  // 允许根：主目录三根 + <cwd> 的 .dsh/.agents 两根 + SP_TEST_ROOTS（测试注入）。
  const target = canonUserPath(root);
  if (!target) return false;
  for (const a of userRootList(cwd)) {
    const ca = canonUserPath(a);
    if (ca && target.startsWith(ca)) return true;
  }
  return false;
}

// Gate for every write/read command that receives a SKILL.md path from the client.
// Refuses paths outside managed roots, symlink/junction indirection and non-SKILL.md
// targets. Returns the resolved absolute path to use.
function assertSkillFile(file, cwd) {
  const raw = String(file || '');
  if (!raw || !raw.toUpperCase().endsWith('SKILL.MD')) {
    throw new Error('path 必须指向一个 SKILL.md 文件');
  }
  const full = pathResolve(raw);
  let st;
  try { st = lstatSync(full); } catch { throw new Error('文件不存在: ' + raw); }
  if (st.isSymbolicLink()) throw new Error('拒绝链接路径（symlink/junction）: ' + raw);
  if (!st.isFile()) throw new Error('路径不是普通文件: ' + raw);
  const dir = pathDirname(full);
  let dirReal;
  try { dirReal = realpathSync(dir); } catch { throw new Error('目录不存在: ' + dir); }
  if (!assertUserRoot(dirReal, cwd)) {
    throw new Error('路径必须位于用户技能根目录内（~/.dsh/skills、~/.agents/skills、~/.workbuddy/skills 或项目 .dsh/.agents skills）');
  }
  return join(dirReal, pathBasename(full));
}

async function handleCreate(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const root = typeof payload.root === 'string' ? payload.root : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const description = typeof payload.description === 'string' ? payload.description : '';
  if (!root || !assertUserRoot(root)) throw new Error('root 必须是用户技能根目录（~/.dsh/skills、~/.agents/skills 或 ~/.workbuddy/skills）');
  if (!name || !KEBAB_RE.test(name)) throw new Error('name 必须是 kebab-case（小写字母/数字，短横线分隔）');
  const dir = join(root, name);
  if (existsSync(dir)) throw new Error('目录已存在: ' + dir);
  mkdirSync(dir, { recursive: true });
  const skillFile = join(dir, 'SKILL.md');
  const eol = '\n';
  const desc = description ? (needsQuote(description) ? JSON.stringify(description) : description) : '""';
  const body = '---' + eol
    + 'name: ' + name + eol
    + 'description: ' + desc + eol
    + '---' + eol
    + eol
    + '# ' + name + eol
    + eol
    + '(在此编写技能说明…)' + eol;
  writeFileSync(skillFile, body, 'utf8');
  return { kind: 'success', text: JSON.stringify({ ok: true, dir, path: skillFile }) };
}

function needsQuote(v) {
  return /[:#\[\]{}&*!|>'"%@`,]/.test(v) || String(v).trim() !== String(v);
}

// Import = copy (never move). Source may be the skill dir itself or its parent containing several skills.
async function handleImport(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const source = typeof payload.source === 'string' ? payload.source : '';
  const targetRoot = typeof payload.targetRoot === 'string' && payload.targetRoot ? payload.targetRoot : defaultTargetRoot();
  if (!source || !existsSync(source)) throw new Error('来源目录不存在: ' + source);
  if (!assertUserRoot(targetRoot)) throw new Error('目标必须是用户技能根目录');
  if (/\.zip$/i.test(source)) {
    // zip 走严格解析（无链接条目、总量/条数/单文件上限），不要求位于受管根目录。
  } else {
    // 来源也必须位于受管根目录内（防止从任意位置投放内容）。
    const sst = lstatSync(source);
    if (sst.isSymbolicLink()) throw new Error('拒绝链接来源（symlink/junction）: ' + source);
    if (!assertUserRoot(realpathSync(source))) throw new Error('来源必须位于用户技能根目录内');
  }
  let scanDir = source;
  let zipTmp = null;
  if (/\.zip$/i.test(source)) {
    const zst = statSync(source);
    if (!zst.isFile()) throw new Error('zip 来源必须是文件: ' + source);
    if (zst.size > 128 * 1024 * 1024) throw new Error('zip 文件过大（>128MB），请先拆分');
    zipTmp = mkdtempSync(join(tmpdir(), 'sp-zip-'));
    try {
      extractZip(readFileSync(source), zipTmp);
    } catch (e) {
      try { rmSync(zipTmp, { recursive: true, force: true }); } catch (e2) { /* ignore */ }
      throw e;
    }
    scanDir = zipTmp;
    try {
      payload.__zipName = basename(source).replace(/\.zip$/i, '');
      const r = importScanAndCopy(payload, scanDir, targetRoot, true);
      return { kind: 'success', text: JSON.stringify({ ok: true, targetRoot, ...r }) };
    } finally {
      try { rmSync(zipTmp, { recursive: true, force: true }); } catch (e9) { /* ignore */ }
    }
  }
  const r = importScanAndCopy(payload, scanDir, targetRoot, payload.preview === true);
  return { kind: 'success', text: JSON.stringify({ ok: true, targetRoot, ...r }) };
}

// Shared scan/preview/copy core for import (non-zip path uses it inline; zip path via try/finally).
function importScanAndCopy(payload, scanDir, targetRoot, preview) {
  const candidates = [];
  const zipBase = payload.__zipName || null;
  if (existsSync(join(scanDir, 'SKILL.md'))) {
    candidates.push({ from: scanDir, name: zipBase || basename(scanDir) });
  } else if (statSync(scanDir).isDirectory()) {
    for (const ent of readdirSync(scanDir, { withFileTypes: true })) {
      if (ent.isDirectory() && existsSync(join(scanDir, ent.name, 'SKILL.md'))) {
        candidates.push({ from: join(scanDir, ent.name), name: ent.name });
      }
    }
  }
  if (payload.preview === true) {
    // 预检：只算会怎样，不复制（导入对话框两步确认）。
    const preview = candidates.map((cand) => {
      let name = cand.name;
      if (!KEBAB_RE.test(name)) name = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'imported-skill';
      const exists = existsSync(join(targetRoot, name));
      return { name: cand.name, target: name, status: exists ? (payload.overwrite === true ? 'overwrite' : 'duplicate') : 'new' };
    });
    return { preview: true, results: preview };
  }
  if (!candidates.length) throw new Error('未在来源中找到含 SKILL.md 的技能目录');
  const results = [];
  for (const cand of candidates) {
    // Normalize the name to kebab; keep frontmatter in sync later via fix.
    let name = cand.name;
    if (!KEBAB_RE.test(name)) name = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'imported-skill';
    let dest = join(targetRoot, name);
    let status = 'copied';
    if (existsSync(dest)) {
      if (payload.overwrite === true) status = 'overwritten';
      else { results.push({ name: cand.name, status: 'skipped-duplicate', dest }); continue; }
    }
    try {
      cpSync(cand.from, dest, { recursive: true, force: payload.overwrite === true });
      // Sync frontmatter name with the normalized dir name.
      try { applyFrontmatterScalar(join(dest, 'SKILL.md'), 'name', name); } catch { /* best effort */ }
      results.push({ name: cand.name, status, dest });
    } catch (e) {
      results.push({ name: cand.name, status: 'failed', error: (e && e.message) || String(e) });
    }
  }
  return { results };
}

async function handleDelete(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const file = assertSkillFile(typeof payload.path === 'string' ? payload.path : '', (await cwdOf(ctx, invocation)));
  const dir = dirname(file);
  if (!existsSync(dir)) throw new Error('目录不存在: ' + dir);
  // Safety: never delete a root itself, and refuse junction/symlink dirs (deleting a link
  // would remove the real WorkBuddy skill for other hosts — require manual unlink there).
  if (isJunctionOrSymlink(dir)) throw new Error('该技能是链接（Junction/Symlink），为避免影响源目录请手动删除链接');
  // Reuse the same allow-list as create/import (user roots + project cwd roots + test roots).
  const rootDir = dir;
  if (!assertUserRoot(rootDir, (await cwdOf(ctx, invocation)))) throw new Error('只允许删除用户技能根目录下的技能');
  if (basename(dir).toLowerCase() === 'skills') throw new Error('拒绝删除技能根目录本身');
  // Trash instead of hard delete: rename into <root>/.skills-panel-trash/<ts>-<name>.
  // Dot-prefixed dir is invisible to the skill scanner, so it never shows up in the panel.
  const root = parentRootOf(dir);
  // Central trash outside every scanned skills root (a dot-dir inside the root proved
  // fragile on this machine — one such dir got ACL-poisoned and became undeletable).
  const trashRoot = trashDirOf(root);
  mkdirSync(trashRoot, { recursive: true });
  let dest = join(trashRoot, stampNow() + '-' + basename(dir));
  // Same-second collision guard.
  if (existsSync(dest)) dest = join(trashRoot, stampNow() + '-2-' + basename(dir));
  renameAnywhere(dir, dest);
  pruneTrash(trashRoot);
  return { kind: 'success', text: JSON.stringify({ ok: true, trashed: dir, trashPath: dest }) };
}

// ---------- trash: list / restore ----------
const TRASH_DIRNAME = '.skills-panel-trash';
const TRASH_CAP = 100;

function trashRoots() {
  const roots = new Set();
  for (const r of userRootList()) {
    try {
      const parent = dirname(r);
      if (!existsSync(parent)) continue;
      roots.add(r);
    } catch { /* skip unreadable root */ }
  }
  return [...roots];
}

function parentRootOf(dir) {
  // dir = <root>/<name> → return <root>. canonUserPath already appends a trailing
  // separator, so a plain startsWith(rc) proves dir lies strictly below root.
  const canon = canonUserPath(dir);
  if (canon) {
    for (const r of userRootList()) {
      const rc = canonUserPath(r);
      if (!rc || canon === rc) continue;
      if (canon.startsWith(rc)) return r;
    }
  }
  throw new Error('无法定位技能所属根目录');
}

// Stable, collision-free tag for a root path (all default roots share basename 'skills').
function rootTag(root) {
  const base = basename(root).replace(/[^A-Za-z0-9_-]/g, '') || 'root';
  let h = 5381;
  const str = canonUserPath(root) || String(root);
  for (let i = 0; i < str.length; i += 1) { h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; }
  return base + '-' + h.toString(36);
}

function trashDirOf(root) {
  return join(homedir(), '.dsh', 'skills-panel-trash', rootTag(root));
}

function pruneTrash(trashRoot) {
  try {
    const entries = readdirSync(trashRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => join(trashRoot, e.name))
      .sort(); // stamp prefix ⇒ oldest first by name
    while (entries.length > TRASH_CAP) {
      const victim = entries.shift();
      try { rmSync(victim, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

async function handleListTrash(ctx, invocation) {
  const items = [];
  const seenTags = new Set();
  for (const root of trashRoots()) {
    const tag = rootTag(root);
    if (seenTags.has(tag)) continue;
    seenTags.add(tag);
    const trashRoot = trashDirOf(root);
    if (!existsSync(trashRoot)) continue;
    let entries;
    try { entries = readdirSync(trashRoot, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!(e.isDirectory() || e.isSymbolicLink())) continue;
      const full = join(trashRoot, e.name);
      // stamp-name = YYYYMMDD-HHMMSS[-n]-<dirname>
      const m = /^(\d{8}-\d{6})(?:-\d+)?-(.+)$/.exec(e.name);
      let skillName = e.name;
      let ts = null;
      if (m) { ts = m[1]; skillName = m[2]; }
      else { ts = null; skillName = e.name; }
      // Read description from the trashed SKILL.md if present.
      let description = '';
      try {
        const fm = parseFrontmatter(readFileSync(join(full, 'SKILL.md'), 'utf8'));
        if (fm && fm.description) description = String(fm.description).slice(0, 200);
      } catch { /* no SKILL.md in trash item */ }
      items.push({ trashPath: full, skillName, ts, description, root });
    }
  }
  items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  return { kind: 'success', text: JSON.stringify({ ok: true, items }) };
}

async function handleRestore(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const trashPath = typeof payload.trashPath === 'string' ? payload.trashPath : '';
  if (!trashPath) throw new Error('trashPath 缺失');
  // Trash item must live inside a managed trash dir (~/.dsh/skills-panel-trash/<rootName>).
  let root = null;
  const canon = canonUserPath(trashPath);
  const central = canonUserPath(join(homedir(), '.dsh', 'skills-panel-trash'));
  if (canon && central && canon.startsWith(central)) {
    for (const r of userRootList()) {
      if (canonUserPath(dirname(trashPath)) === canonUserPath(trashDirOf(r))) { root = r; break; }
    }
  }
  if (!root) throw new Error('路径不在回收站目录内');
  const trashRoot = trashDirOf(root);
  if (canonUserPath(dirname(trashPath)) !== canonUserPath(trashRoot)) throw new Error('路径不在回收站目录内');
  const name = basename(trashPath);
  const m = /^(\d{8}-\d{6})(?:-\d+)?-(.+)$/.exec(name);
  const skillName = m ? m[2] : name;
  const dest = join(root, skillName);
  if (existsSync(dest)) throw new Error('目标已存在同名技能目录: ' + skillName);
  renameAnywhere(trashPath, dest);
  return { kind: 'success', text: JSON.stringify({ ok: true, restored: dest, name: skillName }) };
}

// Reveal a skill folder in Explorer (webview cannot open file:// URLs — do it host-side).
async function handleReveal(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const target = typeof payload.path === 'string' ? payload.path : '';
  if (!target || !existsSync(target)) throw new Error('路径不存在: ' + target);
  if (!assertUserRoot(dirname(pathResolve(target)))) throw new Error('只能打开用户技能根目录内的位置');
  const isDir = statSync(target).isDirectory();
  if (process.platform === 'win32') {
    // explorer /select,<path> works for both files and folders.
    spawn('explorer.exe', ['/select,' + target], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', isDir ? [target] : ['-R', target], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [isDir ? target : dirname(target)], { detached: true, stdio: 'ignore' }).unref();
  }
  return { kind: 'success', text: JSON.stringify({ ok: true, revealed: target }) };
}

// 经验沉淀: append a dated entry to the 经验附注 section at the end of SKILL.md
// (human-fed notes stay auditable; agent-driven 整理 later merges them into the body).
const NOTES_HEADING = '## 经验附注';

async function handleSediment(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const file = assertSkillFile(typeof payload.path === 'string' ? payload.path : '', (await cwdOf(ctx, invocation)));
  const note = payload.note;
  if (!note) throw new Error('note 不能为空');
  if (!existsSync(file)) throw new Error('文件不存在: ' + file);
  backupSkillFile(file);
  let raw = readFileSync(file, 'utf8');
  let hadBom = false;
  if (raw.charCodeAt(0) === 0xfeff) { hadBom = true; raw = raw.slice(1); }
  const eol = detectEol(raw);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const entry = '- ' + stamp + ': ' + note.replace(/\r?\n/g, ' ');
  const lines = raw.split(/\r?\n/);
  const headIdx = lines.findIndex((l) => l.trim() === NOTES_HEADING);
  if (headIdx >= 0) {
    // Append BELOW existing notes (oldest→newest reading order).
    let insertAt = headIdx + 1;
    while (insertAt < lines.length && (lines[insertAt].trim() === '' || lines[insertAt].trim().startsWith('- '))) {
      insertAt += 1;
    }
    lines.splice(insertAt, 0, entry);
  } else {
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push('', NOTES_HEADING, '', entry);
  }
  writeFileSync(file, (hadBom ? '\uFEFF' : '') + lines.join(eol), 'utf8');
  return { kind: 'success', text: JSON.stringify({ ok: true, path: file, entry }) };
}

// Archive: move a skill dir out of the scanned roots into ~/.dsh/skills-archive/<group>/
// so the engine stops seeing it; restore moves it back to ~/.dsh/skills.
async function handleArchive(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const file = typeof payload.path === 'string' ? payload.path : '';
  const restore = payload.restore === true;
  const group = typeof payload.group === 'string' && payload.group.trim() ? payload.group.trim() : 'default';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(group)) throw new Error('group 只允许字母/数字/短横线/下划线（≤64 字符）');
  if (!file || !file.toUpperCase().endsWith('SKILL.MD')) throw new Error('path 必须指向 SKILL.md');
  const dir = dirname(file);
  if (!existsSync(dir)) throw new Error('目录不存在: ' + dir);
  if (isJunctionOrSymlink(dir)) throw new Error('链接技能不支持归档（会影响源目录），请手动处理');
  const home = homedir();
  const archiveRoot = join(home, '.dsh', 'skills-archive', group);
  if (restore) {
    // Gate (R1): restore source must live inside the managed archive root — never
    // rename arbitrary disk directories into the scanned skills root.
    const dirReal = canonUserPath(dir);
    if (!dirReal.startsWith(canonUserPath(join(home, '.dsh', 'skills-archive')))) {
      throw new Error('恢复来源必须位于技能归档目录内（~/.dsh/skills-archive）');
    }
    const destRoot = join(home, '.dsh', 'skills');
    const dest = join(destRoot, basename(dir));
    if (existsSync(dest)) throw new Error('目标已存在，无法恢复: ' + dest);
    mkdirSync(destRoot, { recursive: true });
    renameAnywhere(dir, dest);
    return { kind: 'success', text: JSON.stringify({ ok: true, restored: dest }) };
  }
  // Gate (R1): archive source must be inside a managed user skills root.
  if (!assertUserRoot(dir)) throw new Error('归档来源必须位于用户技能根目录内');
  const name = basename(dir);
  let dest = join(archiveRoot, name);
  if (existsSync(dest)) dest = join(archiveRoot, name + '-' + Date.now());
  mkdirSync(archiveRoot, { recursive: true });
  renameAnywhere(dir, dest);
  return { kind: 'success', text: JSON.stringify({ ok: true, archived: dest }) };
}

// ---------- move (level migration): user <-> agents <-> project, junction refused ----------
async function handleMove(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const file = typeof payload.path === 'string' ? payload.path : '';
  const destRoot = typeof payload.destRoot === 'string' && payload.destRoot.trim() ? payload.destRoot.trim() : '';
  if (!file || !file.toUpperCase().endsWith('SKILL.MD')) throw new Error('path 必须指向 SKILL.md');
  if (!destRoot) throw new Error('destRoot 必须是目标技能根目录');
  const dir = dirname(file);
  if (!existsSync(dir)) throw new Error('目录不存在: ' + dir);
  if (isJunctionOrSymlink(dir)) throw new Error('链接技能不支持移动（移动只是挪走链接本身，不会动 WorkBuddy 等源目录）；如需迁移请到源目录操作，或在 DSH 侧新建后再导入');
  if (!assertUserRoot(dir, (await cwdOf(ctx, invocation)))) throw new Error('来源必须位于用户技能根目录内');
  if (!assertUserRoot(destRoot, (await cwdOf(ctx, invocation)))) throw new Error('目标必须位于用户技能根目录内');
  const destRootCanon = canonUserPath(destRoot);
  if (canonUserPath(dir).startsWith(destRootCanon + pathSep)) throw new Error('目标与来源在同一技能根目录内，无需移动');
  const dest = join(destRoot, basename(dir));
  if (existsSync(dest)) throw new Error('目标已存在同名技能，未移动: ' + dest);
  mkdirSync(destRoot, { recursive: true });
  renameAnywhere(dir, dest);
  return { kind: 'success', text: JSON.stringify({ ok: true, moved: dest }) };
}

// ---------- zip import (batch2): hand-rolled store/deflate reader, no deps ----------
const ZIP_TOTAL_CAP = 64 * 1024 * 1024;
const ZIP_FILE_CAP = 32 * 1024 * 1024;
const ZIP_ENTRY_CAP = 2000;
function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function safeZipEntryName(name) {
  const n = String(name).replace(/\\/g, '/');
  if (!n || n.startsWith('/') || /^[A-Za-z]:/.test(n)) return null;
  const parts = n.split('/').filter((p) => p.length && p !== '.');
  if (parts.some((p) => p === '..')) return null;
  return parts.join('/');
}
function extractZip(buf, destDir) {
  // 找 End Of Central Directory（签名 0x06054b50），从尾部向前扫。
  let eocd = -1;
  const minEocd = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minEocd; i -= 1) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件（找不到中央目录）');
  let count = u16(buf, eocd + 10);
  const cdOffset = u32(buf, eocd + 16);
  if (count > ZIP_ENTRY_CAP) throw new Error('zip 条目过多（>' + ZIP_ENTRY_CAP + '）');
  // Guard against EOCD lying about the entry count: never scan past the buffer.
  if (cdOffset + 46 > buf.length) throw new Error('zip 中央目录越界（文件损坏？）');
  const maxByBuf = Math.floor((buf.length - cdOffset) / 46);
  if (count > maxByBuf) count = maxByBuf;
  let totalOut = 0;
  let extracted = 0;
  let p = cdOffset;
  for (let k = 0; k < count; k += 1) {
    if (u32(buf, p) !== 0x02014b50) break;
    const method = u16(buf, p + 10);
    const csize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const lho = u32(buf, p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // 目录条目
    const rel = safeZipEntryName(name);
    if (!rel) continue; // 不安全/怪异条目 → 跳过（zip 条目不会创建符号链接，最坏是普通文件）
    if (u32(buf, lho) !== 0x04034b50) continue;
    const lNameLen = u16(buf, lho + 26);
    const lExtraLen = u16(buf, lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    if (csize > ZIP_FILE_CAP) throw new Error('zip 内单文件过大: ' + rel);
    if (totalOut > ZIP_TOTAL_CAP) throw new Error('zip 解压总量超限（>' + Math.round(ZIP_TOTAL_CAP / 1048576) + 'MB）');
    const raw = buf.slice(dataStart, dataStart + csize);
    let out;
    if (method === 0) out = raw;
    else if (method === 8) out = inflateRawSync(raw, { maxOutputLength: ZIP_FILE_CAP });
    else continue; // 不支持的压缩方法 → 跳过
    totalOut += out.length;
    if (totalOut > ZIP_TOTAL_CAP) throw new Error('zip 解压总量超限（>' + Math.round(ZIP_TOTAL_CAP / 1048576) + 'MB）');
    const dest = join(destDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, out);
    extracted += 1;
  }
  if (!extracted) throw new Error('zip 中没有可解压的文件条目');
}

// ---------- tags / version handlers (batch2) ----------
async function handleTags(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name || name.length > 96) throw new Error('name 非法');
  const tags = sanitizeTags(payload.tags);
  const data = loadGroups();
  if (tags.length) data.tags[name] = tags;
  else delete data.tags[name];
  if (!saveGroups(data)) throw new Error('groups.json 写入失败');
  return { kind: 'success', text: JSON.stringify({ ok: true, name, tags }) };
}

async function handleVersion(ctx, invocation) {
  const payload = parsePayload(invocation.rawInput);
  const cfgDir = PANEL_DIR();
  const cfgFile = join(cfgDir, 'config.json');
  let cfg = {};
  try { const parsed = JSON.parse(readFileSync(cfgFile, 'utf8')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cfg = parsed; } catch { cfg = {}; }
  if (typeof payload.repo === 'string' && payload.repo.trim()) {
    const repo = payload.repo.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo) || repo.includes('..'))
      throw new Error('repo 需为 owner/repo 形式');
    cfg.checkRepo = repo;
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8');
  }
  return { kind: 'success', text: JSON.stringify({ ok: true, repo: cfg.checkRepo || '', version: versionOfSelf() }) };
}

// ---------- registration ----------


export const inject = ['commands', 'skills', 'workingDirectory'];

export function apply(ctx) {
  try {
    const commands = ctx.commands || (typeof ctx.get === 'function' && ctx.get('commands'));
    if (!commands || typeof commands.register !== 'function') {
      console.error('[' + NS + '] commands service unavailable; panel will be read-only/no-op');
      return;
    }
    const registration = () => {
      commands.register({
        name: 'skills-panel-list',
        description: '列出本机全部 DSH 技能（技能面板内部命令，不进入模型上下文）',
        input: { hint: 'JSON: {"cwd": "<可选的项目工作目录>"}' },
        recordInput: false,
        handler: (inv) => safe(handleList, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-set',
        description: '切换技能的启用开关（改写 SKILL.md frontmatter；技能面板内部命令）',
        input: { hint: 'JSON: {"path": "<SKILL.md 绝对路径>", "field": "enabled"|"model"|"user", "value": true|false}' },
        recordInput: false,
        handler: (inv) => safe(handleSet, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-read',
        description: '读取 SKILL.md 原文（技能面板编辑器内部命令）',
        input: { hint: 'JSON: {"path": "<SKILL.md 绝对路径>"}' },
        recordInput: false,
        handler: (inv) => safe(handleRead, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-write',
        description: '保存 SKILL.md 内容（技能面板编辑器内部命令）',
        input: { hint: 'JSON: {"path": "<SKILL.md 绝对路径>", "content": "<全文>"}' },
        recordInput: false,
        handler: (inv) => safe(handleWrite, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-check',
        description: '技能规范检查（kebab-case、description、布尔字段；技能面板内部命令）',
        input: { hint: 'JSON: {"path": "<SKILL.md 绝对路径>"}' },
        recordInput: false,
        handler: (inv) => safe(handleCheck, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-fix',
        description: '技能规范自动修复（name 规整/目录重命名/非法布尔移除；技能面板内部命令）',
        input: { hint: 'JSON: {"path": "<SKILL.md 绝对路径>"}' },
        recordInput: false,
        handler: (inv) => safe(handleFix, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-create',
        description: '新建技能目录与 SKILL.md 骨架（技能面板内部命令）',
        input: { hint: 'JSON: {"root": "<用户技能根目录>", "name": "<kebab-case>", "description": "<可选>"}' },
        recordInput: false,
        handler: (inv) => safe(handleCreate, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-import',
        description: '把含 SKILL.md 的文件夹批量复制进用户技能根目录（技能面板内部命令）',
        input: { hint: 'JSON: {"source": "<技能目录或父目录>", "targetRoot": "<可选，默认 ~/.dsh/skills>", "overwrite": false}' },
        recordInput: false,
        handler: (inv) => safe(handleImport, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-delete',
        description: '删除一个技能目录（拒绝链接与根目录；技能面板内部命令）',
        input: { hint: 'JSON: {"path": "<SKILL.md 绝对路径>"}' },
        recordInput: false,
        handler: (inv) => safe(handleDelete, ctx, inv),
      });

      commands.register({
        name: 'skills-panel-list-trash',
        description: '列出技能回收站（.skills-panel-trash）内的已删除技能（面板内部调用）',
        input: { hint: 'JSON: {}' },
        recordInput: false,
        handler: (inv) => safe(handleListTrash, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-restore',
        description: '从技能回收站恢复一个技能目录到原技能根目录（面板内部调用）',
        input: { hint: 'JSON: {"trashPath": "<回收条目绝对路径>"}' },
        recordInput: false,
        handler: (inv) => safe(handleRestore, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-reveal',
        description: '在资源管理器中打开技能文件夹（技能面板内部命令）',
        input: { hint: 'JSON: {"path": "<SKILL.md 或技能目录>"}' },
        recordInput: false,
        handler: (inv) => safe(handleReveal, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-sediment',
        description: '往 SKILL.md 的「经验附注」区追加一条带日期的经验（技能面板内部命令）',
        input: { hint: 'JSON: {"path": "<SKILL.md 绝对路径>", "note": "<经验内容>"}' },
        recordInput: false,
        handler: (inv) => safe(handleSediment, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-archive',
        description: '把技能目录移出扫描根（归档到 ~/.dsh/skills-archive/<group>/），restore:true 恢复（技能面板内部命令）',
        input: { hint: 'JSON: {"path": "<SKILL.md 绝对路径>", "group": "<项目名>", "restore": false}' },
        recordInput: false,
        handler: (inv) => safe(handleArchive, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-move',
        description: '把技能目录移动到另一个技能根目录（用户级/通用级/项目级层级迁移；拒绝链接；技能面板内部命令）',
        input: { hint: 'JSON: {"path": "<SKILL.md 绝对路径>", "destRoot": "<目标技能根目录绝对路径>"}' },
        recordInput: false,
        handler: (inv) => safe(handleMove, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-tags',
        description: '设置/清除技能的自定义标签（groups.json；技能面板内部命令）',
        input: { hint: 'JSON: {"name": "<技能名>", "tags": ["a","b"]}' },
        recordInput: false,
        handler: (inv) => safe(handleTags, ctx, inv),
      });
      commands.register({
        name: 'skills-panel-version',
        description: '读取/设置更新检查仓库（config.json）并返回插件本地版本（技能面板内部命令）',
        input: { hint: 'JSON: {"repo": "owner/repo（可选，传入即保存）"}' },
        recordInput: false,
        handler: (inv) => safe(handleVersion, ctx, inv),
      });
    };
    if (typeof ctx.effect === 'function') {
      ctx.effect(registration);
    } else {
      registration();
    }
  } catch (e) {
    console.error('[' + NS + '] apply failed', e);
  }
}
