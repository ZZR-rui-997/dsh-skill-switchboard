// dsh-skill-switchboard — client half (v2)
// Sidebar 「技能」 panel: user-owned skills only, single 已启用 toggle,
// full-text search, spec check dots, SKILL.md editor modal, create/import/delete,
// source grouping, refresh-on-focus. RPC via ctx.remote.commands (host commands).

(function () {
  const MOD_ID = 'dsh-skill-switchboard';
  const PANEL_ID = 'skills';
  const NS = 'dsh-skill-switchboard';

  const stringsZh = {
    panel: '技能',
    'panel.title': '技能',
    'panel.search': '搜索技能（名称 / 描述 / 正文）…',
    'panel.empty': '没有找到技能',
    'panel.loading': '正在加载技能…',
    'panel.error': '加载失败',
    'panel.retry': '重试',
    'panel.toggle': '已启用',
    'panel.toggle.desc': '关闭后技能立即对模型与用户不可见（写回 SKILL.md frontmatter，自动重载）',
    'panel.count': '共 {n} 个技能',
    'panel.count.searching': '{n}/{total} 个技能',
    'panel.note': '只显示你自己安装/编写的技能；系统自带与插件技能不在此列。',
    'panel.disabledBadge': '已停用',
    'panel.refresh': '刷新',
    'panel.new': '新建',
    'panel.import': '导入',
    'panel.check': '检查',
    'panel.check.ok': '规范 ✓',
    'panel.check.bad': '{n} 项问题',
    'panel.fix': '一键修复',
    'panel.fixed': '已修复：{items}',
    'panel.edit': '编辑',
    'panel.delete': '删除',
    'panel.openFolder': '文件夹',
    'panel.sediment': '记经验',
    'panel.sedimentTitle': '沉淀经验到 /{name}',
    'panel.sedimentHint': '把这次学到的东西（新坑、纠错、新参数）写下来，会以日期条目追加到 SKILL.md 末尾的「经验附注」区；之后可用 agent 整理合并进正文。',
    'panel.sedimentPlaceholder': '例：WinError 740 需以管理员身份运行 schtasks…',
    'panel.sedimentSubmit': '追加',
    'panel.linkedBadge': '链接',
    'panel.save': '保存',
    'panel.cancel': '取消',
    'panel.saved': '已保存',
    'panel.createTitle': '新建技能',
    'panel.createName': '技能名（kebab-case，如 my-skill）',
    'panel.createDesc': '描述（可选）',
    'panel.createRoot': '位置',
    'panel.createSubmit': '创建',
    'panel.importTitle': '导入技能',
    'panel.importHint': '输入一个技能文件夹路径，或包含多个技能的父目录（批量）：',
    'panel.importSubmit': '导入',
    'panel.importResult': '{copied} 个已复制，{skipped} 个重名跳过，{failed} 个失败',
    'panel.confirmDelete': '确定删除技能「{name}」？此操作不可恢复。',
    'panel.group.user': '用户技能（~/.dsh/skills）',
    'panel.group.agents': '通用技能（~/.agents/skills）',
    'panel.group.project': '项目技能',
    'panel.group.other': '其他来源',
    'panel.checkRunning': '检查中…',
    'panel.allCheck': '全部检查',
    'panel.fulltextHit': '正文命中',
    'panel.chip.all': '全部',
    'panel.chip.on': '已启用',
    'panel.chip.off': '已停用',
    'panel.chip.issues': '有规范问题',
    'panel.chip.linked': '链接技能',
    'panel.tokenHint': '按字符数估算的 token 量（≈字节÷2.5，仅参考）',
    'panel.usageHint': '技能被真实加载的次数与最近使用时间（本机会话事件统计，不含子智能体）',
    'panel.chip.used': '常用',
    'panel.trashTitle': '回收站',
    'panel.move': '移动',
    'panel.moveTitle': '移动技能「{name}」',
    'panel.moveHint': '选择目标技能根目录。用户级 = 所有会话可见；通用级 = 所有会话可见（agents 规范目录）；项目级 = 仅当前项目可见。移动保留全部内容，不改动 SKILL.md。',
    'panel.moveBlocked': '链接技能不支持移动（移动只是挪走链接本身）。如需迁移，请到 WorkBuddy 等源目录操作，或在 DSH 侧重新创建。',
    'panel.moveBtn': '移动',
    'panel.trashEmpty': '回收站为空',
    'panel.trashRestore': '恢复',
    'panel.trashRestored': '已恢复：{name}',
    'panel.tags': '标签',
    'panel.tagsTitle': '标签：/{name}',
    'panel.tagsHint': '用逗号分隔，最多 12 个、每个 ≤32 字符；保存在 ~/.dsh/skills-panel/groups.json。',
    'panel.tagsSave': '保存标签',
    'panel.selectMode': '批量',
    'panel.selectAll': '全选',
    'panel.batchOn': '批量启用',
    'panel.batchOff': '批量停用',
    'panel.batchDone': '批量完成：启用 {on} 个，停用 {off} 个',
    'panel.batchFail': '{n} 个失败',
    'panel.aiDraft': '让 Agent 起草',
    'panel.aiWaiting': '已向当前会话的 Agent 发起起草请求…完成后自动填入（最多等 90 秒），可修改后再追加。',
    'panel.aiFailed': 'Agent 起草失败或超时，可直接手写后追加。',
    'panel.importPreview': '预检',
    'panel.importDo': '执行导入',
    'panel.importDone': '完成',
    'panel.importPreviewResult': '预检：{new} 个新增，{dup} 个重名，{ow} 个将覆盖',
    'panel.zipHint': '支持 .zip（自动安全解压后导入；上限 64MB）',
    'panel.overwrite': '覆盖同名',
    'panel.versionCheck': '检查更新',
    'panel.versionUpToDate': '已是最新（远端 v{remote}）',
    'panel.versionNew': '发现新版本 v{remote}（本地 v{local}）',
    'panel.versionFail': '检查失败：{msg}',
    'panel.versionNoRelease': '仓库 {repo} 还没有发布（GitHub repo 尚未初始化或无 release）',
    'panel.versionRepoPrompt': '输入 GitHub 仓库（owner/repo），留空取消：',
    'meta.title': '技能面板',
    'meta.description': '在侧栏管理自己安装的技能：开关、编辑、规范检查、导入导出。',
    'meta.detail': '技能面板只展示你自己安装/编写的技能（~/.dsh/skills、~/.agents/skills、项目根、WorkBuddy 链接）。支持：单一启用开关（写回 frontmatter，自动重载）、全文搜索、SKILL.md 编辑、规范检查与一键修复、新建技能、文件夹批量导入、删除。系统自带与插件提供的技能不在此列。',
  };
  const stringsEn = {
    panel: 'Skills',
    'panel.title': 'Skills',
    'panel.search': 'Search skills (name / description / body)…',
    'panel.empty': 'No skills found',
    'panel.loading': 'Loading skills…',
    'panel.error': 'Failed to load',
    'panel.retry': 'Retry',
    'panel.toggle': 'Enabled',
    'panel.toggle.desc': 'When off, the skill is hidden from both model and user (writes frontmatter, auto reloads)',
    'panel.count': '{n} skills',
    'panel.count.searching': '{n}/{total} skills',
    'panel.note': 'Only your own installed/written skills are shown; bundled and plugin skills are excluded.',
    'panel.disabledBadge': 'Disabled',
    'panel.refresh': 'Refresh',
    'panel.new': 'New',
    'panel.import': 'Import',
    'panel.check': 'Check',
    'panel.check.ok': 'Spec ✓',
    'panel.check.bad': '{n} issues',
    'panel.fix': 'Auto-fix',
    'panel.fixed': 'Fixed: {items}',
    'panel.edit': 'Edit',
    'panel.delete': 'Delete',
    'panel.openFolder': 'Folder',
    'panel.sediment': 'Note',
    'panel.sedimentTitle': 'Add note to /{name}',
    'panel.sedimentHint': 'Capture a lesson (pitfall, fix, parameter). It is appended as a dated entry under 经验附注 at the end of SKILL.md; an agent can later merge notes into the body.',
    'panel.sedimentPlaceholder': 'e.g. WinError 740: run schtasks as administrator…',
    'panel.sedimentSubmit': 'Append',
    'panel.linkedBadge': 'link',
    'panel.save': 'Save',
    'panel.cancel': 'Cancel',
    'panel.saved': 'Saved',
    'panel.createTitle': 'New skill',
    'panel.createName': 'Skill name (kebab-case, e.g. my-skill)',
    'panel.createDesc': 'Description (optional)',
    'panel.createRoot': 'Location',
    'panel.createSubmit': 'Create',
    'panel.importTitle': 'Import skills',
    'panel.importHint': 'Path to a skill folder, or a parent folder containing several skills (batch):',
    'panel.importSubmit': 'Import',
    'panel.importResult': '{copied} copied, {skipped} skipped (duplicate), {failed} failed',
    'panel.confirmDelete': 'Delete skill "{name}"? It moves to the panel trash (.skills-panel-trash) first — restorable anytime.',
    'panel.group.user': 'User skills (~/.dsh/skills)',
    'panel.group.agents': 'Shared skills (~/.agents/skills)',
    'panel.group.project': 'Project skills',
    'panel.group.other': 'Other sources',
    'panel.checkRunning': 'Checking…',
    'panel.allCheck': 'Check all',
    'panel.fulltextHit': 'body match',
    'panel.chip.all': 'All',
    'panel.chip.on': 'Enabled',
    'panel.chip.off': 'Disabled',
    'panel.chip.issues': 'Spec issues',
    'panel.chip.linked': 'Linked',
    'panel.tokenHint': 'Rough token estimate from bytes (≈bytes÷2.5)',
    'panel.usageHint': 'Real skill-load count & last used (local session-event stats, subagents excluded)',
    'panel.chip.used': 'Used',
    'panel.trashTitle': 'Trash',
    'panel.move': 'Move',
    'panel.moveTitle': 'Move skill "{name}"',
    'panel.moveHint': 'Pick a destination skills root. User level = visible everywhere; Agents level = visible everywhere (agents convention dir); Project level = visible in this project only. Content is preserved untouched.',
    'panel.moveBlocked': 'Linked skills cannot be moved here (moving would only move the link itself). Operate on the source directory (e.g. WorkBuddy), or recreate the skill on the DSH side.',
    'panel.moveBtn': 'Move',
    'panel.trashEmpty': 'Trash is empty',
    'panel.trashRestore': 'Restore',
    'panel.trashRestored': 'Restored: {name}',
    'panel.tags': 'Tags',
    'panel.tagsTitle': 'Tags: /{name}',
    'panel.tagsHint': 'Comma separated, max 12 tags, 32 chars each; stored in ~/.dsh/skills-panel/groups.json.',
    'panel.tagsSave': 'Save tags',
    'panel.selectMode': 'Batch',
    'panel.selectAll': 'Select all',
    'panel.batchOn': 'Enable',
    'panel.batchOff': 'Disable',
    'panel.batchDone': 'Batch done: {on} enabled, {off} disabled',
    'panel.batchFail': '{n} failed',
    'panel.aiDraft': 'Draft via Agent',
    'panel.aiWaiting': 'Asked the current session Agent to draft a note… it will fill in automatically (up to 90s); edit then append.',
    'panel.aiFailed': 'Agent draft failed or timed out — write it manually.',
    'panel.importPreview': 'Preview',
    'panel.importDo': 'Import',
    'panel.importDone': 'Done',
    'panel.importPreviewResult': 'Preview: {new} new, {dup} duplicates, {ow} overwrites',
    'panel.zipHint': '.zip supported (safe auto-extract then import; 64MB cap)',
    'panel.overwrite': 'Overwrite duplicates',
    'panel.versionCheck': 'Check updates',
    'panel.versionUpToDate': 'Up to date (remote v{remote})',
    'panel.versionNew': 'New version v{remote} available (local v{local})',
    'panel.versionFail': 'Check failed: {msg}',
    'panel.versionNoRelease': 'Repo {repo} has no release yet (GitHub repo not initialized or no release published)',
    'panel.versionRepoPrompt': 'GitHub repo (owner/repo); empty cancels:',
    'meta.title': 'Skills panel',
    'meta.description': 'Manage your own skills in the sidebar: toggle, edit, spec-check, import.',
    'meta.detail': 'The skills panel shows only your own installed/written skills (~/.dsh/skills, ~/.agents/skills, project roots, WorkBuddy junctions). Features: single enable toggle (writes frontmatter, auto reloads), full-text search, SKILL.md editor, spec check with one-click fix, create new skill, folder batch import, delete. Bundled and plugin skills are excluded.',
  };

  window.__ModuleLoader__.load({
    id: MOD_ID,
    factory(require) {
      const React = require('react');
      const h = React.createElement;

      return {
        inject: ['slots', 'locale', 'remote', 'remote.commands', 'remote.session', 'sessions'],
        apply(ctx) {
          try { applyInner(ctx); } catch (e) {
            console.error('[' + MOD_ID + '] apply failed', e);
          }
        },
      };

      function applyInner(ctx) {
        const locale = ctx.locale;
        const remote = ctx.remote;
        const sessions = ctx.sessions;

        // ---- locale ----
        try {
          if (locale && typeof locale.register === 'function') {
            locale.register(NS, 'zh', stringsZh);
            locale.register(NS, 'en', stringsEn);
          }
        } catch (e) { console.warn('[' + MOD_ID + '] locale.register failed', e); }
        const t = (k, vars) => {
          let s = stringsZh[k] != null ? stringsZh[k] : (stringsEn[k] != null ? stringsEn[k] : k);
          try {
            const bind = locale && typeof locale.bind === 'function' ? locale.bind(NS) : null;
            const v = bind ? bind(k) : null;
            if (v && v !== k) s = v;
          } catch (e) { /* keep fallback */ }
          if (vars) {
            for (const key of Object.keys(vars)) {
              s = s.split('{' + key + '}').join(String(vars[key]));
            }
          }
          return s;
        };

        // ---- data layer ----
        function pickSessionId() {
          try {
            if (sessions && sessions.list) {
              const snap = sessions.list.getSnapshot();
              const ids = (snap && snap.ids) || [];
              const byId = (snap && snap.byId) || {};
              let best = null;
              for (const id of ids) {
                const row = byId[id];
                if (!row || row.blank || row.origin === 'subagent') continue;
                if (!best || (row.updatedAt || 0) > (best.updatedAt || 0)) best = row;
              }
              if (best) return best.id;
              if (ids.length) return ids[0];
            }
          } catch (e) { /* fallthrough */ }
          return null;
        }

        async function executeCommand(sessionId, name, payload) {
          const line = '/' + name + ' ' + JSON.stringify(payload);
          const result = await remote.commands.execute(sessionId, line, []);
          if (!result || !result.ok) {
            throw new Error((result && result.error && result.error.message) || ('command ' + name + ' failed'));
          }
          const value = result.value;
          let commandResult = null;
          if (value && value.commandResult) commandResult = value.commandResult;
          else if (value && value.result) commandResult = value.result;
          if (!commandResult) throw new Error('no commandResult in ' + name + ' response');
          if (commandResult.kind !== 'success') {
            throw new Error(commandResult.text || ('command ' + name + ' returned ' + commandResult.kind));
          }
          return JSON.parse(commandResult.text);
        }

        let lastRoots = []; // 由 loadRows 随列表接口更新（host userRootList 同源）
        async function loadRows() {
          const sessionId = pickSessionId();
          if (!sessionId) throw new Error('没有可用会话');
          const data = await executeCommand(sessionId, 'skills-panel-list', {});
          if (!Array.isArray(data.skills)) data.skills = [];
          lastRoots = data.roots || lastRoots;
          return data.skills;
        }

        function groupKeyOf(row) {
          const p = String(row.path || '').toLowerCase();
          const home = (navigator.platform && '') || '';
          if (p.indexOf('.dsh\\skills') >= 0 && p.indexOf('users') >= 0 && p.indexOf('.workbuddy') < 0) return 'user';
          if (p.indexOf('.workbuddy\\skills') >= 0) return 'user';
          if (p.indexOf('.agents\\skills') >= 0 && p.indexOf('users') >= 0 && p.indexOf('.dsh') < 0) return 'agents';
          if (row.source === 'project' || row.source === 'project-agents') return 'project';
          return 'other';
        }

        // ---- CSS ----
        const css = `
.sp-wrap{display:flex;flex-direction:column;height:100%;min-height:0;padding-top:var(--dsh-frame-top-clearance,48px);}
.sp-head{display:flex;align-items:center;gap:8px;padding:12px 16px 8px;}
.sp-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8e8);flex:1;}
.sp-btn{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);cursor:pointer;font-size:12px;padding:4px 8px;border-radius:6px;}
.sp-btn:hover{background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e8e8e8);}
.sp-search{margin:0 16px 8px;}
.sp-search input{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.06));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;color:var(--dsw-alias-label-primary,#e8e8e8);padding:7px 10px;font-size:13px;outline:none;}
.sp-search input:focus{border-color:var(--dsw-alias-brand-primary,#4c8dff);}
.sp-note{margin:0 16px 6px;font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);line-height:1.5;}
.sp-chips{display:flex;gap:6px;margin:4px 16px 6px;flex-wrap:wrap;}
.sp-chip{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);border-radius:999px;padding:3px 10px;font-size:11px;cursor:pointer;}
.sp-chip:hover{color:var(--dsw-alias-label-primary,#e8e8e8);}
.sp-chip.active{background:var(--dsw-alias-brand-primary,#4c8dff);border-color:var(--dsw-alias-brand-primary,#4c8dff);color:#fff;}
.sp-meta{font-size:10px;color:var(--dsw-alias-label-secondary,#9a9a9a);margin-left:6px;}
.sp-list{flex:1;overflow-y:auto;padding:4px 8px 16px;min-height:0;}
.sp-group{margin:10px 8px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#8a8a8a);letter-spacing:.02em;}
.sp-row{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:10px;margin:2px 8px;}
.sp-row:hover{background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.05));}
.sp-main{flex:1;min-width:0;}
.sp-name{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8e8);}
.sp-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none;}
.sp-dot.ok{background:#3fb96a;}
.sp-dot.bad{background:#e5484d;}
.sp-dot.none{background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.25));}
.sp-badge{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.08));color:var(--dsw-alias-label-secondary,#9a9a9a);}
.sp-badge.warn{color:#e7a13c;}
.sp-src{font-size:10px;color:var(--dsw-alias-label-secondary,#8a8a8a);}
.sp-desc{margin-top:3px;font-size:12px;color:var(--dsw-alias-label-secondary,#9a9a9a);line-height:1.45;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
.sp-desc mark{background:transparent;color:var(--dsw-alias-brand-primary,#4c8dff);padding:0;}
.sp-actions{display:flex;flex-direction:column;gap:4px;align-items:flex-end;}
.sp-actrow{display:flex;gap:6px;align-items:center;}
.sp-toggle{display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;}
.sp-toggle input{accent-color:var(--dsw-alias-brand-primary,#4c8dff);cursor:pointer;}
.sp-toggle-label{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);white-space:nowrap;}
.sp-toggle.off .sp-toggle-label{opacity:.55;}
.sp-trashbar{display:flex;justify-content:flex-end;padding:2px 16px 4px;}
.sp-trashbtn{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:transparent;color:var(--dsw-alias-label-secondary,#9a9a9a);border-radius:8px;padding:3px 10px;font-size:11px;cursor:pointer;}
.sp-trashbtn:hover{color:var(--dsw-alias-label-primary,#e8e8e8);border-color:var(--dsw-alias-label-secondary,#9a9a9a);}
.sp-trash-modal{width:min(560px,92vw);}
.sp-trash-list{display:flex;flex-direction:column;min-height:120px;max-height:50vh;overflow-y:auto;}
.sp-trash-row{display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.08));}
.sp-trash-info{flex:1;min-width:0;}
.sp-trash-name{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8e8);}
.sp-trash-desc{font-size:11px;color:var(--dsw-alias-label-secondary,#9a9a9a);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sp-restorebtn{border:1px solid var(--dsw-alias-brand-primary,#4c8dff);background:transparent;color:var(--dsw-alias-brand-primary,#4c8dff);border-radius:8px;padding:3px 10px;font-size:11px;cursor:pointer;flex:none;}
.sp-restorebtn:disabled{opacity:.5;cursor:default;}
.sp-foot{padding:6px 16px 10px;font-size:11px;color:var(--dsw-alias-label-secondary,#8a8a8a);display:flex;gap:10px;align-items:center;}
.sp-empty,.sp-error,.sp-loading{padding:32px 16px;text-align:center;color:var(--dsw-alias-label-secondary,#9a9a9a);font-size:13px;}
.sp-error button,.sp-loading button{margin-top:10px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:transparent;color:var(--dsw-alias-label-primary,#e8e8e8);border-radius:8px;padding:5px 12px;cursor:pointer;font-size:12px;}
.sp-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;}
.sp-modal{background:var(--dsw-alias-bg-base,#1b1b1f);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:12px;padding:16px;width:min(860px,92vw);max-height:86vh;display:flex;flex-direction:column;gap:10px;}
.sp-modal.small{width:min(480px,92vw);}
.sp-modal-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#e8e8e8);}
.sp-input{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.06));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;color:var(--dsw-alias-label-primary,#e8e8e8);padding:7px 10px;font-size:13px;outline:none;}
.sp-input:focus{border-color:var(--dsw-alias-brand-primary,#4c8dff);}
.sp-textarea{width:100%;box-sizing:border-box;flex:1;min-height:320px;background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.06));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;color:var(--dsw-alias-label-primary,#e8e8e8);padding:10px;font-size:12.5px;font-family:Consolas,'Courier New',monospace;line-height:1.55;outline:none;resize:vertical;}
.sp-textarea:focus{border-color:var(--dsw-alias-brand-primary,#4c8dff);}
.sp-issues{margin:0;padding:0 0 0 4px;list-style:none;font-size:12px;color:#e7a13c;display:flex;flex-direction:column;gap:4px;}
.sp-btnrow{display:flex;gap:8px;justify-content:flex-end;}
.sp-btn-primary{border:none;background:var(--dsw-alias-brand-primary,#4c8dff);color:#fff;border-radius:8px;padding:6px 14px;cursor:pointer;font-size:12.5px;}
.sp-btn-primary:disabled{opacity:.5;cursor:default;}
.sp-btn-ghost{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:transparent;color:var(--dsw-alias-label-primary,#e8e8e8);border-radius:8px;padding:6px 14px;cursor:pointer;font-size:12.5px;}
.sp-icon{display:inline-flex;align-items:center;gap:4px;border:none;background:var(--dsw-alias-bg-overlay,#f2f3f5);color:var(--dsw-alias-label-secondary,#666);cursor:pointer;font-size:12px;padding:3px 10px 3px 8px;border-radius:999px;line-height:1.5;white-space:nowrap;transition:background .15s,color .15s;}.sp-icon .ico{font-size:13px;line-height:1;}.sp-icon:hover{background:var(--dsw-alias-brand-primary,#4c6fff);color:#fff;}.sp-icon.danger:hover{background:#e5484d;}.sp-actrow{flex-wrap:wrap;}
.sp-icon:hover{background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e8e8e8);}
.sp-btn.active{background:var(--dsw-alias-bg-overlay,rgba(255,255,255,.10));color:var(--dsw-alias-label-primary,#e8e8e8);}
.sp-preview{max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;margin:4px 0;}
.sp-preview-row{display:flex;align-items:center;gap:8px;font-size:12px;}
.sp-badge.new{color:#3fb96a;}
.sp-badge.dup{color:#e7a13c;}
.sp-badge.ow{color:#e5484d;}
`;

        // ---- components ----

        function Toggle(props) {
          const { checked, disabled, title, label, onChange } = props;
          return h('label', {
            className: 'sp-toggle' + (checked ? '' : ' off'),
            title: title || '',
            onClick: (e) => { e.preventDefault(); if (!disabled) onChange(!checked); },
          },
            h('input', { type: 'checkbox', checked: !!checked, disabled: !!disabled, readOnly: true, style: { pointerEvents: 'none' } }),
            h('span', { className: 'sp-toggle-label' }, label),
          );
        }

        function HighlightText(props) {
          const { text, query } = props;
          if (!query || !text) return h('span', null, text || '');
          const lower = String(text).toLowerCase();
          const idx = lower.indexOf(query.toLowerCase());
          if (idx < 0) return h('span', null, text);
          return h('span', null,
            String(text).slice(0, idx),
            h('mark', null, String(text).slice(idx, idx + query.length)),
            String(text).slice(idx + query.length));
        }

        function cmpVer(a, b) {
          const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
          const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
          for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
            const d = (pa[i] || 0) - (pb[i] || 0);
            if (d !== 0) return d;
          }
          return 0;
        }

        function relTime(ms) {
          const diff = Date.now() - ms;
          if (diff < 60 * 1000) return '刚刚';
          if (diff < 3600 * 1000) return Math.round(diff / 60000) + ' 分钟前';
          if (diff < 86400 * 1000) return Math.round(diff / 3600000) + ' 小时前';
          if (diff < 30 * 86400 * 1000) return Math.round(diff / 86400000) + ' 天前';
          const d = new Date(ms);
          return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        }

          function usageAgo(iso) {
            const ms = iso ? new Date(iso).getTime() : NaN;
            return Number.isFinite(ms) ? ' · ' + relTime(ms) : '';
          }
        function Row(props) {
          const { row, busy, checkState, onToggle, onEdit, onDelete, onOpenFolder, onCheck, onFix, onSediment, query, onTags, onMove, selectMode, selected, onSelect } = props;
          const enabled = row.modelInvocable && row.userInvocable;
          const dot = checkState === 'ok' ? 'ok' : (checkState && checkState.issues && checkState.issues.length ? 'bad' : 'none');
          const dotTitle = checkState === 'ok' ? t('panel.check.ok')
            : (checkState && checkState.issues ? checkState.issues.map((i) => i.message).join('\n') : t('panel.check'));
          return h('div', { className: 'sp-row' },
            selectMode ? h('input', { type: 'checkbox', checked: !!selected, onChange: () => onSelect && onSelect(row), style: { marginTop: 4 } }) : null,
            h('div', { className: 'sp-main' },
              h('div', { className: 'sp-name' },
                checkState ? h('span', { className: 'sp-dot ' + dot, title: dotTitle }) : null,
                h('span', null, '/' + row.name),
                !enabled ? h('span', { className: 'sp-badge' }, t('panel.disabledBadge')) : null,
                row.linked ? h('span', { className: 'sp-badge' }, t('panel.linkedBadge')) : null,
                (row.tags || []).map((tg) => h('span', { key: tg, className: 'sp-badge' }, tg)),
                h('span', { className: 'sp-src', title: row.path || '' }, row.source || ''),
                typeof row.mtimeMs === 'number' ? h('span', { className: 'sp-meta', title: new Date(row.mtimeMs).toLocaleString() }, relTime(row.mtimeMs)) : null,
                typeof row.bytes === 'number' ? h('span', { className: 'sp-meta', title: t('panel.tokenHint') }, '≈' + Math.max(1, Math.round(row.bytes / 2.5)) + ' tok') : null,
                (row.usage && row.usage.count > 0) ? h('span', { className: 'sp-meta', title: t('panel.usageHint') }, '⚡' + row.usage.count + usageAgo(row.usage.lastUsed)) : null,
              ),
              h('div', { className: 'sp-desc' },
                h(HighlightText, { text: row.description || row.whenToUse || '', query })),
              query && row.bodyHit ? h('div', { className: 'sp-src' }, '↳ ' + t('panel.fulltextHit')) : null,
            ),
            h('div', { className: 'sp-actions' },
              h('div', { className: 'sp-actrow' },
                h('button', { className: 'sp-icon', title: t('panel.check'), onClick: () => onCheck(row) }, checkState === 'checking' ? h('span', { className: 'ico' }, '…') : h('span', { className: 'ico' }, '✓'), h('span', null, t('panel.check'))),
                checkState && checkState.issues && checkState.issues.length
                  ? h('button', { className: 'sp-icon', title: t('panel.fix'), onClick: () => onFix(row) }, h('span', { className: 'ico' }, '🛠'), h('span', null, t('panel.fix')))
                  : null,
                h('button', { className: 'sp-icon', title: t('panel.edit'), onClick: () => onEdit(row) }, h('span', { className: 'ico' }, '✎'), h('span', null, t('panel.edit'))),
                h('button', { className: 'sp-icon', title: t('panel.sediment'), onClick: () => onSediment(row) }, h('span', { className: 'ico' }, '📝'), h('span', null, t('panel.sediment'))),
                h('button', { className: 'sp-icon', title: t('panel.tags'), onClick: () => onTags && onTags(row) }, h('span', { className: 'ico' }, '🏷'), h('span', null, t('panel.tags'))),
                h('button', { className: 'sp-icon', title: t('panel.move'), onClick: () => onMove && onMove(row) }, h('span', { className: 'ico' }, '📦'), h('span', null, t('panel.move'))),
                h('button', { className: 'sp-icon', title: t('panel.openFolder'), onClick: () => onOpenFolder(row.dir || row.path) }, h('span', { className: 'ico' }, '📂'), h('span', null, t('panel.openFolder'))),
                row.linked ? null : h('button', { className: 'sp-icon danger', title: t('panel.delete'), onClick: () => onDelete(row) }, h('span', { className: 'ico' }, '🗑'), h('span', null, t('panel.delete'))),
              ),
              h(Toggle, {
                checked: enabled,
                disabled: busy || !row.path,
                title: !row.path ? '' : t('panel.toggle.desc'),
                label: t('panel.toggle'),
                onChange: (v) => onToggle(row, v),
              }),
            ),
          );
        }

        function EditorModal(props) {
          const { row, onClose, onSaved, exec } = props;
          const [content, setContent] = React.useState(null);
          const [error, setError] = React.useState(null);
          const [saving, setSaving] = React.useState(false);
          const [savedFlash, setSavedFlash] = React.useState(false);
          const baselineRef = React.useRef(null);
          React.useEffect(() => {
            let alive = true;
            (async () => {
              try {
                const sessionId = pickSessionId();
                const data = await exec(sessionId, 'skills-panel-read', { path: row.path });
                if (alive) {
                  setContent(data.content || '');
                  baselineRef.current = typeof data.baselineMtimeMs === 'number' ? data.baselineMtimeMs : null;
                }
              } catch (e) { if (alive) setError(e); }
            })();
            return () => { alive = false; };
          }, [row.path]);
          const save = async () => {
            setSaving(true); setError(null);
            try {
              const sessionId = pickSessionId();
              const data = await exec(sessionId, 'skills-panel-write', { path: row.path, content, baselineMtimeMs: baselineRef.current });
              if (data && typeof data.mtimeMs === 'number') baselineRef.current = data.mtimeMs;
              setSavedFlash(true);
              setTimeout(() => { setSavedFlash(false); onSaved(); }, 600);
            } catch (e) { setError(e); } finally { setSaving(false); }
          };
          return h('div', { className: 'sp-modal-backdrop', onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
            h('div', { className: 'sp-modal' },
              h('div', { className: 'sp-modal-title' }, '✎ /' + row.name + ' — SKILL.md', savedFlash ? '  ' + t('panel.saved') : ''),
              error
                ? h('div', { className: 'sp-error' }, String(error.message || error))
                : (content == null
                  ? h('div', { className: 'sp-loading' }, '…')
                  : h('textarea', {
                    className: 'sp-textarea', value: content, spellCheck: false,
                    onChange: (e) => setContent(e.target.value),
                  })),
              h('div', { className: 'sp-btnrow' },
                h('button', { className: 'sp-btn-ghost', onClick: onClose }, t('panel.cancel')),
                h('button', { className: 'sp-btn-primary', disabled: saving || content == null, onClick: save }, t('panel.save')),
              ),
            ));
        }

        function SedimentModal(props) {
          const { row, onClose, onDone, exec } = props;
          const [note, setNote] = React.useState('');
          const [error, setError] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const [aiBusy, setAiBusy] = React.useState(false);
          const [aiState, setAiState] = React.useState('idle');
          const aliveRef = React.useRef(true);
          React.useEffect(() => () => { aliveRef.current = false; }, []);
          const submit = async () => {
            setBusy(true); setError(null);
            try {
              const sessionId = pickSessionId();
              await exec(sessionId, 'skills-panel-sediment', { path: row.path, note: note.trim() });
              onDone();
            } catch (e) { setError(e); } finally { setBusy(false); }
          };
          const aiDraft = async () => {
            if (aiBusy) return;
            setAiBusy(true); setAiState('waiting'); setError(null);
            try {
              const sessionId = pickSessionId();
              if (!sessionId) throw new Error('没有可用会话');
              const session = remote && remote.session;
              if (!session || typeof session.prompt !== 'function') throw new Error('session remote 不可用');
              const fence = '```';
              const directive = '请为技能 /' + row.name + ' 起草一条「经验附注」条目。技能描述：' + String(row.description || '').slice(0, 200) + '。'
                + '请回顾本会话中与该技能相关的讨论、踩过的坑与修正，总结成一条简洁经验（不超过120字，不要日期前缀）。'
                + '只回复一个 ' + fence + 'note 围栏代码块，块内是经验正文；不要调用任何工具，不要执行任何操作。';
              await session.prompt({
                requestId: (window.crypto && typeof window.crypto.randomUUID === 'function') ? window.crypto.randomUUID() : ('sp-' + Date.now()),
                sessionId, mode: 'queue',
                content: [{ type: 'text', text: directive }],
              });
              const deadline = Date.now() + 90000;
              let found = null;
              // M6: only exact ```note fences — a generic fence would swallow unrelated
              // code blocks or injected page content. Only messages newer than the draft
              // request count, and polling stops if the user switches sessions.
              const startedAt = Date.now() - 1500;
              const reNote = new RegExp(fence + 'note[ \\t]*\\n([\\s\\S]*?)' + fence);
              while (Date.now() < deadline && !found) {
                await new Promise((res) => setTimeout(res, 2500));
                if (!aliveRef.current) return;
                const sidNow = pickSessionId();
                if (sidNow !== sessionId) break; // session switched — stop reading events
                try {
                  const page = await session.events({ address: { kind: 'session', sessionId }, maxMessages: 30 });
                  const records = (page && page.records) || [];
                  for (let i = records.length - 1; i >= 0; i -= 1) {
                    const rec = records[i];
                    const ev = rec && rec.event;
                    if (!ev || ev.type !== 'assistant/message') continue;
                    const ts = Date.parse(ev.time || '') || 0;
                    if (ts && ts < startedAt) continue; // older than the request — skip
                    const msg = ev.data && ev.data.message;
                    if (!msg || !Array.isArray(msg.content)) continue;
                    const text = msg.content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
                    const m = reNote.exec(text);
                    if (m && m[1] && m[1].trim()) { found = m[1].trim(); break; }
                  }
                } catch (e2) { /* keep polling */ }
              }
              if (!aliveRef.current) return;
              if (found) { setNote(found); setAiState('idle'); }
              else setAiState('failed');
            } catch (e) {
              if (!aliveRef.current) return;
              setError(e); setAiState('idle');
            } finally {
              if (aliveRef.current) setAiBusy(false);
            }
          };
          return h('div', { className: 'sp-modal-backdrop', onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
            h('div', { className: 'sp-modal small' },
              h('div', { className: 'sp-modal-title' }, t('panel.sedimentTitle', { name: row.name })),
              h('div', { className: 'sp-src' }, t('panel.sedimentHint')),
              h('textarea', {
                className: 'sp-textarea', style: { minHeight: '110px', fontFamily: 'inherit' },
                placeholder: t('panel.sedimentPlaceholder'),
                value: note, onChange: (e) => setNote(e.target.value), autoFocus: true,
              }),
              aiState === 'waiting' ? h('div', { className: 'sp-src' }, t('panel.aiWaiting')) : null,
              aiState === 'failed' ? h('div', { className: 'sp-src' }, t('panel.aiFailed')) : null,
              h('div', { className: 'sp-btnrow', style: { justifyContent: 'flex-start' } },
                h('button', { className: 'sp-btn-ghost', disabled: aiBusy, onClick: aiDraft }, aiBusy ? '…' : '🤖 ' + t('panel.aiDraft')),
              ),
              error ? h('div', { className: 'sp-error' }, String(error.message || error)) : null,
              h('div', { className: 'sp-btnrow' },
                h('button', { className: 'sp-btn-ghost', onClick: onClose }, t('panel.cancel')),
                h('button', { className: 'sp-btn-primary', disabled: busy || !note.trim(), onClick: submit }, t('panel.sedimentSubmit')),
              ),
            ));
        }

        function CreateModal(props) {
          const { onClose, onDone, exec, roots } = props;
          const [name, setName] = React.useState('');
          const [desc, setDesc] = React.useState('');
          const [root, setRoot] = React.useState(roots[0] || '');
          const [error, setError] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const kebabOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name.trim());
          const submit = async () => {
            setBusy(true); setError(null);
            try {
              const sessionId = pickSessionId();
              await exec(sessionId, 'skills-panel-create', { root, name: name.trim(), description: desc });
              onDone();
            } catch (e) { setError(e); } finally { setBusy(false); }
          };
          return h('div', { className: 'sp-modal-backdrop', onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
            h('div', { className: 'sp-modal small' },
              h('div', { className: 'sp-modal-title' }, t('panel.createTitle')),
              h('div', null, t('panel.createRoot')),
              h('select', { className: 'sp-input', value: root, onChange: (e) => setRoot(e.target.value) },
                roots.map((r) => h('option', { key: r, value: r }, r))),
              h('input', { className: 'sp-input', placeholder: t('panel.createName'), value: name, onChange: (e) => setName(e.target.value) }),
              !kebabOk && name ? h('div', { className: 'sp-src' }, '⚠ kebab-case: 小写字母/数字，短横线分隔') : null,
              h('input', { className: 'sp-input', placeholder: t('panel.createDesc'), value: desc, onChange: (e) => setDesc(e.target.value) }),
              error ? h('div', { className: 'sp-error' }, String(error.message || error)) : null,
              h('div', { className: 'sp-btnrow' },
                h('button', { className: 'sp-btn-ghost', onClick: onClose }, t('panel.cancel')),
                h('button', { className: 'sp-btn-primary', disabled: busy || !kebabOk || !root, onClick: submit }, t('panel.createSubmit')),
              ),
            ));
        }

        function ImportModal(props) {
          const { onClose, onDone, exec } = props;
          const [source, setSource] = React.useState('');
          const [previewData, setPreviewData] = React.useState(null);
          const [overwrite, setOverwrite] = React.useState(false);
          const [done, setDone] = React.useState(false);
          const [result, setResult] = React.useState(null);
          const [error, setError] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const doPreview = async () => {
            setBusy(true); setError(null); setPreviewData(null); setResult(null); setDone(false);
            try {
              const sessionId = pickSessionId();
              const data = await exec(sessionId, 'skills-panel-import', { source: source.trim(), preview: true });
              setPreviewData(data);
            } catch (e) { setError(e); } finally { setBusy(false); }
          };
          const doImport = async () => {
            setBusy(true); setError(null);
            try {
              const sessionId = pickSessionId();
              const data = await exec(sessionId, 'skills-panel-import', { source: source.trim(), overwrite });
              setResult(data); setPreviewData(null); setDone(true);
            } catch (e) { setError(e); } finally { setBusy(false); }
          };
          const counts = result ? result.results.reduce((acc, r) => {
            if (r.status === 'copied' || r.status === 'overwritten') acc.copied += 1;
            else if (r.status === 'skipped-duplicate') acc.skipped += 1;
            else acc.failed += 1;
            return acc;
          }, { copied: 0, skipped: 0, failed: 0 }) : null;
          return h('div', { className: 'sp-modal-backdrop', onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
            h('div', { className: 'sp-modal small' },
              h('div', { className: 'sp-modal-title' }, t('panel.importTitle')),
              h('div', { className: 'sp-src' }, t('panel.importHint')),
              h('input', { className: 'sp-input', placeholder: 'D:\\path\\to\\skill 或 D:\\path\\to\\parent', value: source, onChange: (e) => { setSource(e.target.value); setPreviewData(null); setDone(false); } }),
              h('div', { className: 'sp-src' }, t('panel.zipHint')),
              h('label', { className: 'sp-toggle' },
                h('input', { type: 'checkbox', checked: overwrite, onChange: (e) => { setOverwrite(e.target.checked); setPreviewData(null); } }),
                h('span', { className: 'sp-toggle-label' }, t('panel.overwrite')),
              ),
              previewData && Array.isArray(previewData.results) ? h('div', { className: 'sp-preview' },
                previewData.results.map((r) => h('div', { key: r.name + '::' + r.target, className: 'sp-preview-row' },
                  h('span', { className: 'sp-trash-name' }, r.name),
                  h('span', { className: 'sp-src' }, '→ ' + r.target),
                  h('span', { className: 'sp-badge ' + (r.status === 'new' ? 'new' : (r.status === 'duplicate' ? 'dup' : 'ow')) },
                    r.status)))) : null,
              previewData ? h('div', { className: 'sp-src' }, t('panel.importPreviewResult', {
                new: previewData.results.filter((r) => r.status === 'new').length,
                dup: previewData.results.filter((r) => r.status === 'duplicate').length,
                ow: previewData.results.filter((r) => r.status === 'overwrite').length,
              })) : null,
              counts ? h('div', { className: 'sp-src' }, t('panel.importResult', counts)
                + '  ' + result.results.map((r) => r.name + ':' + r.status).join(', ')) : null,
              error ? h('div', { className: 'sp-error' }, String(error.message || error)) : null,
              h('div', { className: 'sp-btnrow' },
                h('button', { className: 'sp-btn-ghost', onClick: done ? onDone : onClose }, done ? t('panel.importDone') : t('panel.cancel')),
                h('button', { className: 'sp-btn-ghost', disabled: busy || !source.trim(), onClick: doPreview }, t('panel.importPreview')),
                h('button', { className: 'sp-btn-primary', disabled: busy || !previewData, onClick: doImport }, t('panel.importDo')),
              ),
            ));
        }

        function MoveModal(props) {
          const { row, onClose, onDone, exec, roots } = props;
          const [destRoot, setDestRoot] = React.useState('');
          const [error, setError] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          React.useEffect(() => {
            if (row.linked) return;
            const cur = row.dir || '';
            const opts = (roots || []).filter((r0) => {
              const rr = String(r0).replace(/[\\/]$/, '');
              const cc = String(cur).replace(/[\\/]$/, '');
              return cc.toLowerCase().indexOf(rr.toLowerCase() + '\\') !== 0 && cc.toLowerCase() !== rr.toLowerCase();
            });
            if (opts.length && !opts.includes(destRoot)) setDestRoot(opts[0]);
          }, [row.path]);
          const submit = async () => {
            if (!destRoot) { setError(new Error(t('panel.moveHint'))); return; }
            setBusy(true); setError(null);
            try {
              const sessionId = pickSessionId();
              await exec(sessionId, 'skills-panel-move', { path: row.path, destRoot });
              onDone();
            } catch (e) { setError(e); } finally { setBusy(false); }
          };
          if (row.linked) {
            return h('div', { className: 'sp-modal-backdrop', onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
              h('div', { className: 'sp-modal small' },
                h('div', { className: 'sp-modal-title' }, t('panel.moveTitle', { name: row.name })),
                h('div', { className: 'sp-src' }, t('panel.moveBlocked')),
                h('div', { className: 'sp-btnrow' },
                  h('button', { className: 'sp-btn-ghost', onClick: onClose }, t('panel.cancel')),
                )));
          }
          const options = (roots || []).filter((r0) => {
            const rr = String(r0).replace(/[\\/]$/, '');
            const cc = String(row.dir || '').replace(/[\\/]$/, '');
            return cc.toLowerCase().indexOf(rr.toLowerCase() + '\\') !== 0 && cc.toLowerCase() !== rr.toLowerCase();
          });
          return h('div', { className: 'sp-modal-backdrop', onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
            h('div', { className: 'sp-modal small' },
              h('div', { className: 'sp-modal-title' }, t('panel.moveTitle', { name: row.name })),
              h('div', { className: 'sp-src' }, t('panel.moveHint')),
              options.length ? h('div', null,
                options.map((r0) => h('label', { key: r0, style: { display: 'block', margin: '6px 0', cursor: 'pointer' } },
                  h('input', { type: 'radio', name: 'sp-move-dest', checked: destRoot === r0, onChange: () => setDestRoot(r0), style: { marginRight: 8 } }),
                  h('span', null, r0),
                )),
              ) : h('div', { className: 'sp-src' }, t('panel.empty')),
              error ? h('div', { className: 'sp-error' }, String(error.message || error)) : null,
              h('div', { className: 'sp-btnrow' },
                h('button', { className: 'sp-btn-ghost', onClick: onClose }, t('panel.cancel')),
                h('button', { className: 'sp-btn-primary', disabled: busy || !destRoot, onClick: submit }, t('panel.moveBtn')),
              ),
            ));
        }

        function TagsModal(props) {
          const { row, onClose, onDone, exec } = props;
          const [tags, setTags] = React.useState((row.tags || []).join(', '));
          const [error, setError] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const submit = async () => {
            setBusy(true); setError(null);
            try {
              const sessionId = pickSessionId();
              const list = tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
              await exec(sessionId, 'skills-panel-tags', { name: row.name, tags: list });
              onDone();
            } catch (e) { setError(e); } finally { setBusy(false); }
          };
          return h('div', { className: 'sp-modal-backdrop', onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
            h('div', { className: 'sp-modal small' },
              h('div', { className: 'sp-modal-title' }, t('panel.tagsTitle', { name: row.name })),
              h('div', { className: 'sp-src' }, t('panel.tagsHint')),
              h('input', { className: 'sp-input', value: tags, onChange: (e) => setTags(e.target.value), autoFocus: true }),
              error ? h('div', { className: 'sp-error' }, String(error.message || error)) : null,
              h('div', { className: 'sp-btnrow' },
                h('button', { className: 'sp-btn-ghost', onClick: onClose }, t('panel.cancel')),
                h('button', { className: 'sp-btn-primary', disabled: busy, onClick: submit }, t('panel.tagsSave')),
              ),
            ));
        }

        function Panel(props) {
          const { rows, state, error, query, total, grouped } = props;
          if (state === 'loading') {
            return h('div', { className: 'sp-loading' }, t('panel.loading'),
              h('div', null, h('button', { onClick: props.onRefresh }, t('panel.refresh'))));
          }
          if (state === 'error') {
            return h('div', { className: 'sp-error' }, (t('panel.error') + ': ' + (error && error.message ? error.message : String(error || ''))),
              h('div', null, h('button', { onClick: props.onRefresh }, t('panel.retry'))));
          }
          const q = (query || '').toLowerCase().trim();
          const chip = props.chip || 'all';
          const hasIssue = (r) => {
            const c = props.checks && props.checks[r.path];
            return !!(c && c.issues && c.issues.length);
          };
          const list = (rows || []).filter((r) => {
            if (chip === 'on' && !(r.modelInvocable && r.userInvocable)) return false;
            if (chip === 'off' && (r.modelInvocable && r.userInvocable)) return false;
            if (chip === 'issues' && !hasIssue(r)) return false;
            if (chip === 'linked' && !r.linked) return false;
            if (chip === 'used' && !(r.usage && r.usage.count > 0)) return false;
            if (!q) return true;
            return (r.name || '').toLowerCase().includes(q)
              || (r.description || '').toLowerCase().includes(q)
              || (r.body || '').toLowerCase().includes(q);
          }).map((r) => {
            if (!q) return r;
            const bodyHit = (r.body || '').toLowerCase().includes(q)
              && !(r.name || '').toLowerCase().includes(q)
              && !(r.description || '').toLowerCase().includes(q);
            return Object.assign({}, r, { bodyHit });
          });
          if (!list.length) return h('div', { className: 'sp-empty' }, t('panel.empty'));
          const groups = [];
          const order = grouped ? ['user', 'agents', 'project', 'other'] : ['other'];
          const byKey = new Map();
          for (const row of list) {
            const k = grouped ? groupKeyOf(row) : 'other';
            if (!byKey.has(k)) byKey.set(k, []);
            byKey.get(k).push(row);
          }
          for (const k of order) {
            if (byKey.has(k)) groups.push({ key: k, rows: byKey.get(k) });
          }
          return h('div', { className: 'sp-list' },
            groups.map((g) => h('div', { key: g.key },
              grouped && groups.length > 1 ? h('div', { className: 'sp-group' }, t('panel.group.' + g.key)) : null,
              g.rows.map((row) => h(Row, {
                key: row.name + '::' + (row.path || ''),
                row,
                busy: props.busyName === row.name,
                checkState: props.checks ? props.checks[row.path] : undefined,
                query: q,
                onToggle: props.onToggle,
                onEdit: props.onEdit,
                onSediment: props.onSediment,
                onDelete: props.onDelete,
                onOpenFolder: props.onOpenFolder,
                onCheck: props.onCheck,
                onFix: props.onFix,
                onTags: props.onTags,
                onMove: props.onMove,
                selectMode: props.selectMode,
                selected: !!(props.selected && props.selected.has(row.path)),
                onSelect: props.onSelect,
              })))),
          );
        }


        function SkillsPage() {
          const [rows, setRows] = React.useState(null);
          const [state, setState] = React.useState('loading');
          const [error, setError] = React.useState(null);
          const [query, setQuery] = React.useState('');
          const [busyName, setBusyName] = React.useState(null);
          const [tick, setTick] = React.useState(0);
          const [checks, setChecks] = React.useState({});
          const [editorRow, setEditorRow] = React.useState(null);
          const [sedimentRow, setSedimentRow] = React.useState(null);
          const [createOpen, setCreateOpen] = React.useState(false);
          const [importOpen, setImportOpen] = React.useState(false);
          const [chip, setChip] = React.useState('all'); // all | on | off | issues | linked | used
          const [trashOpen, setTrashOpen] = React.useState(false);
          const [trashItems, setTrashItems] = React.useState(null); // null = not loaded
          const [trashBusy, setTrashBusy] = React.useState(null);
          const [selectMode, setSelectMode] = React.useState(false);
          const [selected, setSelected] = React.useState(() => new Set());
          const [tagsRow, setTagsRow] = React.useState(null);
          const [moveRow, setMoveRow] = React.useState(null);
          const [versionBusy, setVersionBusy] = React.useState(false);
          const [versionMsg, setVersionMsg] = React.useState(null);
          const aliveRef = React.useRef(true);
          React.useEffect(() => {
            aliveRef.current = true;
            return () => { aliveRef.current = false; };
          }, []);

          const refresh = React.useCallback(async () => {
            setState('loading'); setError(null);
            try {
              const data = await loadRows();
              if (!aliveRef.current) return;
              setRows(data); setState('ready');
            } catch (e) {
              if (!aliveRef.current) return;
              setError(e); setState('error');
            }
          }, []);

          const loadTrash = React.useCallback(async () => {
            try {
              const sessionId = pickSessionId();
              if (!sessionId) return;
              const data = await executeCommand(sessionId, 'skills-panel-list-trash', {});
              if (aliveRef.current) setTrashItems(Array.isArray(data.items) ? data.items : []);
            } catch (e) {
              console.warn('[' + MOD_ID + '] list-trash failed', e);
              if (aliveRef.current) setTrashItems([]);
            }
          }, []);
          const openTrash = () => { setTrashOpen(true); if (!trashItems) loadTrash(); };
          const restoreTrash = async (item) => {
            setTrashBusy(item.trashPath);
            try {
              const sessionId = pickSessionId();
              if (!sessionId) return;
              await executeCommand(sessionId, 'skills-panel-restore', { trashPath: item.trashPath });
              if (aliveRef.current) {
                setTrashOpen(false);
                setTrashItems(null);
                setTick((x) => x + 1);
              }
            } catch (e) {
              window.alert(String(e && e.message ? e.message : e));
            } finally {
              if (aliveRef.current) setTrashBusy(null);
            }
          };
          React.useEffect(() => { refresh(); }, [tick]);

          // Refresh when the window regains focus (mirrors laoqiu behaviour).
          React.useEffect(() => {
            const onFocus = () => { setTick((x) => x + 1); };
            try {
              window.addEventListener('focus', onFocus);
              return () => window.removeEventListener('focus', onFocus);
            } catch (e) { return undefined; }
          }, []);

          const exec = (sessionId, name, payload) => executeCommand(sessionId, name, payload);

          const onToggle = async (row, value) => {
            const sessionId = pickSessionId();
            if (!sessionId) { setError(new Error('没有可用会话')); setState('error'); return; }
            setBusyName(row.name);
            try {
              await executeCommand(sessionId, 'skills-panel-set', { path: row.path, field: 'enabled', value });
              setRows((prev) => prev ? prev.map((r) => {
                if (r.path !== row.path) return r;
                const next = Object.assign({}, r);
                next.modelInvocable = value;
                next.userInvocable = value;
                return next;
              }) : prev);
            } catch (e) {
              console.error('[' + MOD_ID + '] toggle failed', e);
              setRows(null); setTick((x) => x + 1);
            } finally {
              setBusyName(null);
            }
          };

          const onCheck = async (row) => {
            const sessionId = pickSessionId();
            if (!sessionId) return;
            setChecks((prev) => Object.assign({}, prev, { [row.path]: 'checking' }));
            try {
              const data = await executeCommand(sessionId, 'skills-panel-check', { path: row.path });
              setChecks((prev) => Object.assign({}, prev, { [row.path]: { issues: data.issues || [] } }));
            } catch (e) {
              setChecks((prev) => Object.assign({}, prev, { [row.path]: { issues: [{ code: 'error', message: String(e.message || e) }] } }));
            }
          };

          const onFix = async (row) => {
            const sessionId = pickSessionId();
            if (!sessionId) return;
            setBusyName(row.name);
            try {
              const data = await executeCommand(sessionId, 'skills-panel-fix', { path: row.path });
              setChecks((prev) => Object.assign({}, prev, { [row.path]: 'ok' }));
              setRows(null); setTick((x) => x + 1); // dir may have been renamed → resync
              console.info('[' + MOD_ID + '] fixed', data.applied);
            } catch (e) {
              console.error('[' + MOD_ID + '] fix failed', e);
            } finally {
              setBusyName(null);
            }
          };

          const onDelete = async (row) => {
            if (!window.confirm(t('panel.confirmDelete', { name: row.name }))) return;
            const sessionId = pickSessionId();
            if (!sessionId) return;
            setBusyName(row.name);
            try {
              await executeCommand(sessionId, 'skills-panel-delete', { path: row.path });
              setRows((prev) => prev ? prev.filter((r) => r.path !== row.path) : prev);
            } catch (e) {
              window.alert(String(e.message || e));
            } finally {
              setBusyName(null);
            }
          };

          // Webview cannot open file:// URLs — reveal via host-side explorer.
          const shellOpen = async (pathOrUrl) => {
            try {
              const sessionId = pickSessionId();
              if (!sessionId) return;
              await executeCommand(sessionId, 'skills-panel-reveal', { path: pathOrUrl });
              return;
            } catch (e) {
              console.warn('[' + MOD_ID + '] reveal failed, falling back to window.open', e);
            }
            try { window.open('file:///' + String(pathOrUrl).replace(/\\/g, '/'), '_blank'); } catch (e2) { /* ignore */ }
          };

          const userRoots = React.useMemo(() => {
            // 候选根随列表接口下发（与 host 端 userRootList 同源），不再硬编码本机路径。
            return Array.isArray(lastRoots) ? lastRoots : [];
          }, [rows]);

          const onBatch = async (value) => {
            const sessionId = pickSessionId();
            if (!sessionId) return;
            const targets = (rows || []).filter((r) => selected.has(r.path));
            let okOn = 0, okOff = 0, fails = 0;
            for (const r of targets) {
              try {
                await executeCommand(sessionId, 'skills-panel-set', { path: r.path, field: 'enabled', value });
                if (value) okOn += 1; else okOff += 1;
              } catch (e) { fails += 1; }
            }
            window.alert(t('panel.batchDone', { on: okOn, off: okOff }) + (fails ? (' ' + t('panel.batchFail', { n: fails })) : ''));
            setSelected(new Set());
            setTick((x) => x + 1);
          };
          const onVersion = async () => {
            setVersionBusy(true); setVersionMsg(null);
            try {
              const sessionId = pickSessionId();
              if (!sessionId) throw new Error('没有可用会话');
              // Network happens HOST-side (check:true → node:https): the webview
              // renderer cannot fetch api.github.com ('Failed to fetch').
              const cfg = await executeCommand(sessionId, 'skills-panel-version', { check: true });
              if (cfg.noRelease) throw new Error(t('panel.versionNoRelease', { repo: cfg.repo }));
              const remoteV = cfg.remote;
              const localV = cfg.version || '0';
              const isNew = cmpVer(remoteV, localV) > 0;
              setVersionMsg(isNew ? t('panel.versionNew', { remote: remoteV, local: localV }) : t('panel.versionUpToDate', { remote: remoteV }));
            } catch (e) {
              setVersionMsg(t('panel.versionFail', { msg: String(e && e.message ? e.message : e) }));
            } finally { setVersionBusy(false); }
          };
          const total = rows ? rows.length : 0;
          const chipForCount = chip;
          const shownCount = rows ? rows.filter((r) => {
            if (chipForCount === 'on' && !(r.modelInvocable && r.userInvocable)) return false;
            if (chipForCount === 'off' && (r.modelInvocable && r.userInvocable)) return false;
            if (chipForCount === 'issues') {
              const c = checks && checks[r.path];
              if (!(c && c.issues && c.issues.length)) return false;
            }
            if (chipForCount === 'linked' && !r.linked) return false;
            if (chipForCount === 'used' && !(r.usage && r.usage.count > 0)) return false;
            const q = (query || '').toLowerCase().trim();
            if (!q) return true;
            return (r.name || '').toLowerCase().includes(q)
              || (r.description || '').toLowerCase().includes(q)
              || (r.body || '').toLowerCase().includes(q);
          }).length : 0;
          return h('div', { className: 'sp-wrap' },
            h('style', null, css),
            h('div', { className: 'sp-head' },
              h('div', { className: 'sp-title' }, t('panel.title')),
              h('button', { className: 'sp-btn', onClick: () => setCreateOpen(true), title: t('panel.new') }, '＋ ' + t('panel.new')),
              h('button', { className: 'sp-btn', onClick: () => setImportOpen(true), title: t('panel.import') }, '⬇ ' + t('panel.import')),
              h('button', { className: 'sp-btn' + (selectMode ? ' active' : ''), onClick: () => { setSelectMode(!selectMode); setSelected(new Set()); }, title: t('panel.selectMode') }, t('panel.selectMode')),
              h('button', { className: 'sp-btn', onClick: () => setTick((x) => x + 1), title: t('panel.refresh') }, '⟳'),
            ),
            h('div', { className: 'sp-search' },
              h('input', {
                placeholder: t('panel.search'),
                value: query,
                onChange: (e) => setQuery(e.target.value),
              })),
            h('div', { className: 'sp-chips' },
              [['all', t('panel.chip.all')], ['on', t('panel.chip.on')], ['off', t('panel.chip.off')], ['issues', t('panel.chip.issues')], ['linked', t('panel.chip.linked')], ['used', t('panel.chip.used')]].map(([k, label]) =>
                h('button', {
                  key: k,
                  className: 'sp-chip' + (chip === k ? ' active' : ''),
                  onClick: () => setChip(chip === k ? 'all' : k),
                }, label))),
            selectMode ? h('div', { className: 'sp-chips' },
              h('button', { className: 'sp-chip', onClick: () => setSelected(new Set((rows || []).map((r) => r.path))) }, t('panel.selectAll')),
              h('button', { className: 'sp-chip', disabled: !selected.size, onClick: () => onBatch(true) }, t('panel.batchOn') + ' (' + selected.size + ')'),
              h('button', { className: 'sp-chip', disabled: !selected.size, onClick: () => onBatch(false) }, t('panel.batchOff') + ' (' + selected.size + ')'),
            ) : null,
            h('div', { className: 'sp-note' }, t('panel.note')),
            h(Panel, {
              rows, state, error, query, total,
              chip,
              grouped: true,
              checks,
              busyName, onToggle,
              onEdit: (row) => setEditorRow(row),
              onSediment: (row) => setSedimentRow(row),
              onDelete,
              onOpenFolder: shellOpen,
              onCheck, onFix,
              onTags: (row) => setTagsRow(row),
              onMove: (row) => setMoveRow(row),
              selectMode,
              selected,
              onSelect: (row) => setSelected((prev) => { const next = new Set(prev); if (next.has(row.path)) next.delete(row.path); else next.add(row.path); return next; }),
              onRefresh: () => setTick((x) => x + 1),
            }),
            h('div', { className: 'sp-foot' },
              h('span', null, state === 'ready'
                ? t(query ? 'panel.count.searching' : 'panel.count', { n: shownCount, total })
                : ''),
              h('span', { className: 'sp-src' }, versionMsg || ''),
              h('button', { className: 'sp-btn', disabled: versionBusy, onClick: onVersion, title: t('panel.versionCheck') }, versionBusy ? '…' : t('panel.versionCheck')),
            ),
            h('div', { className: 'sp-trashbar' },
              h('button', { className: 'sp-trashbtn', onClick: openTrash },
                '\uD83D\uDDD1 ' + t('panel.trashTitle') + (Array.isArray(trashItems) && trashItems.length ? ' (' + trashItems.length + ')' : ''))),
            trashOpen ? h('div', { className: 'sp-modal-backdrop', onClick: () => setTrashOpen(false) },
              h('div', { className: 'sp-modal small sp-trash-modal', onClick: (e) => e.stopPropagation() },
                h('div', { className: 'sp-modal-title' },
                  t('panel.trashTitle')),
                h('div', { className: 'sp-trash-list' },
                  !Array.isArray(trashItems) ? h('div', { className: 'sp-empty' }, '...')
                    : trashItems.length === 0 ? h('div', { className: 'sp-empty' }, t('panel.trashEmpty'))
                    : trashItems.map((it) => h('div', { key: it.trashPath, className: 'sp-trash-row' },
                      h('div', { className: 'sp-trash-info' },
                        h('div', { className: 'sp-trash-name' }, '/' + (it.skillName || '?')),
                        h('div', { className: 'sp-trash-desc' },
                          (it.ts ? it.ts.slice(0,4) + '-' + it.ts.slice(4,6) + '-' + it.ts.slice(6,8) + ' ' : '')
                          + (it.description || ''))),
                      h('button', {
                        className: 'sp-restorebtn',
                        disabled: trashBusy === it.trashPath,
                        onClick: () => restoreTrash(it),
                      }, trashBusy === it.trashPath ? '...' : t('panel.trashRestore'))))),
                h('div', { className: 'sp-btnrow' },
                  h('button', { className: 'sp-btn-ghost', onClick: () => setTrashOpen(false) }, '\u5173\u95ed')))) : null,
            editorRow ? h(EditorModal, {
              row: editorRow, exec,
              onClose: () => setEditorRow(null),
              onSaved: () => { setEditorRow(null); setTick((x) => x + 1); },
            }) : null,
            sedimentRow ? h(SedimentModal, {
              row: sedimentRow, exec,
              onClose: () => setSedimentRow(null),
              onDone: () => { setSedimentRow(null); setTick((x) => x + 1); },
            }) : null,
            createOpen ? h(CreateModal, {
              exec, roots: userRoots,
              onClose: () => setCreateOpen(false),
              onDone: () => { setCreateOpen(false); setTick((x) => x + 1); },
            }) : null,
            importOpen ? h(ImportModal, {
              exec,
              onClose: () => setImportOpen(false),
              onDone: () => { setImportOpen(false); setTick((x) => x + 1); },
            }) : null,
            tagsRow ? h(TagsModal, {
              row: tagsRow, exec,
              onClose: () => setTagsRow(null),
              onDone: () => { setTagsRow(null); setTick((x) => x + 1); },
            }) : null,
            moveRow ? h(MoveModal, {
              row: moveRow, exec, roots: userRoots,
              onClose: () => setMoveRow(null),
              onDone: () => { setMoveRow(null); setTick((x) => x + 1); },
            }) : null,
          );
        }

        function SkillsIcon() {
          return h('svg', {
            width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
            stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
          },
            h('path', { d: 'M12 2l2.4 4.9L20 8l-4 3.9.9 5.6L12 14.8 7.1 17.5 8 11.9 4 8l5.6-1.1z' }));
        }

        // ---- registration ----
        const safeInject = (key, register) => {
          try { return ctx.slots.inject(key, register); }
          catch (e) { console.warn('[' + MOD_ID + '] slots.inject(' + key + ') failed', e); }
        };

        safeInject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, SkillsPage));

        safeInject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 40,
          label: () => t('panel'),
          locale: NS,
        }, SkillsIcon));

        console.info('[' + MOD_ID + '] panel v2 registered (skills)');
      }
    },
  });
})();
