// Smoke test: the bundle must load in a Web client and a Host context without throwing,
// and it must register its panel slots and its host commands.
//
// Run: node tests/smoke.test.js
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${pass ? '' : ` — ${detail}`}`);
};
const equal = (label, actual, expected) => check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

// ---------------------------------------------------------------- client half
const clientSource = readFileSync(join(PKG_DIR, 'client.js'), 'utf8');
let clientFactory = null;
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
  document: {
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } }),
    body: { appendChild() {}, removeChild() {}, contains: () => false },
    documentElement: { appendChild() {} },
  },
  window: {
    __ModuleLoader__: {
      load(entry) {
        clientFactory = entry.factory;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    localStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    innerWidth: 1400,
    innerHeight: 900,
  },
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);

let loadError = null;
try {
  vm.runInContext(clientSource, sandbox, { filename: 'client.js' });
} catch (error) {
  loadError = error;
}
check('client.js evaluates without throwing', loadError === null, loadError && loadError.message);
check('client.js registered a module factory', typeof clientFactory === 'function');

// Minimal React stand-in: the panel components only need element creation and hooks to survive a load.
const hooks = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children }, children }),
  Fragment: 'Fragment',
  useState: (initial) => {
    const slot = { value: typeof initial === 'function' ? initial() : initial };
    hooks.push(slot);
    return [slot.value, (next) => {
      slot.value = typeof next === 'function' ? next(slot.value) : next;
    }];
  },
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useContext: () => ({}),
  useReducer: (reducer, initial) => [initial, () => {}],
};
let moduleValue = null;
try {
  moduleValue = clientFactory((name) => {
    if (name === 'react') return React;
    if (name === 'react-dom') return { createPortal: (node) => node };
    throw new Error(`unexpected require: ${name}`);
  });
} catch (error) {
  check('client factory runs', false, error.message);
}
check('client factory runs', moduleValue !== null);
check('client exports an apply function', typeof moduleValue?.default?.apply === 'function' || typeof moduleValue?.apply === 'function', JSON.stringify(Object.keys(moduleValue || {})));

// ---------------------------------------------------------------- host half
const host = await import(new URL('../index.js', import.meta.url).href);
check('host module imports', host !== null && typeof host === 'object');
check('host declares service dependencies', Array.isArray(host.inject) && host.inject.includes('commands'), JSON.stringify(host.inject));
check('host exports apply', typeof host.apply === 'function');

const registered = [];
const fakeCommands = { register(definition) { registered.push(definition); } };
let disposed = 0;
const hostCtx = {
  commands: fakeCommands,
  skills: { snapshot: () => [] },
  workingDirectory: process.cwd(),
  get(name) {
    if (name === 'commands') return fakeCommands;
    if (name === 'skills') return { snapshot: () => [] };
    return undefined;
  },
  effect(fn) {
    const result = typeof fn === 'function' ? fn() : fn;
    return () => {
      disposed += 1;
      if (typeof result === 'function') result();
    };
  },
};
let applyError = null;
try {
  host.apply(hostCtx);
} catch (error) {
  applyError = error;
}
check('host apply does not throw', applyError === null, applyError && applyError.message);
check('host registered its commands', registered.length >= 2, `count=${registered.length}`);

const expected = ['skills-panel-list', 'skills-panel-set'];
for (const name of expected) {
  const found = registered.find((definition) => definition.name === name);
  check(`command "${name}" is registered`, Boolean(found));
  if (found) {
    check(`command "${name}" is not recorded in the transcript`, found.recordInput === false);
    check(`command "${name}" has a handler`, typeof found.handler === 'function');
  }
}

// --------------------------------------------------------------- packaging
const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
check('package declares dsh.bundle.patch', Boolean(pkg.dsh?.bundle?.patch));
check('package declares dsh.client', Boolean(pkg.dsh?.client));
check('package has an icon', typeof pkg.icon === 'string' && pkg.icon.length > 0);
check('files ships the host and client entries', Array.isArray(pkg.files) && pkg.files.includes('index.js') && pkg.files.includes('client.js'));
check('files ships both locale files', Array.isArray(pkg.files) && pkg.files.includes('locale/en.json') && pkg.files.includes('locale/zh.json'));

const en = JSON.parse(readFileSync(join(PKG_DIR, 'locale', 'en.json'), 'utf8'));
const zh = JSON.parse(readFileSync(join(PKG_DIR, 'locale', 'zh.json'), 'utf8'));
check('locale meta.title is set', Boolean(en['meta.title'] && zh['meta.title']));
check('locale meta.description is set', Boolean(en['meta.description'] && zh['meta.description']));
check('locale meta.detail points at a doc', typeof en['meta.detail'] === 'string' && en['meta.detail'].length > 0);
const enOnly = Object.keys(en).filter((key) => !(key in zh));
const zhOnly = Object.keys(zh).filter((key) => !(key in en));
check('locale key sets match', enOnly.length === 0 && zhOnly.length === 0, `en-only=${enOnly.join(',')} zh-only=${zhOnly.join(',')}`);

// --------------------------------------------------- market detail contract
for (const [lang, doc] of [['en', 'docs/DETAIL.md'], ['zh', 'docs/DETAIL.zh.md']]) {
  const text = readFileSync(join(PKG_DIR, doc), 'utf8').trim();
  const lines = text.split(/\r?\n/);
  check(`${lang} detail doc is exactly one image line (${doc})`, lines.length === 1 && /^!\[[^\]]*\]\(preview\.svg\)$/.test(lines[0]), text.slice(0, 80));
}
check('preview.svg exists', existsSync(join(PKG_DIR, 'preview.svg')));
const preview = readFileSync(join(PKG_DIR, 'preview.svg'), 'utf8');
check('preview.svg is sized 640x300', preview.includes('width="640"') && preview.includes('height="300"'));
check('preview.svg has no script or external reference', !/<script/i.test(preview) && !/https?:\/\/.*?href/i.test(preview));
const iconPng = readFileSync(join(PKG_DIR, 'icon.png'));
check('icon.png exists and is under 256 KiB', iconPng.length > 0 && iconPng.length <= 256 * 1024, `bytes=${iconPng.length}`);
check('README and LICENSE ship', existsSync(join(PKG_DIR, 'README.md')) && existsSync(join(PKG_DIR, 'README.zh.md')) && existsSync(join(PKG_DIR, 'LICENSE')));
check('files lists the detail docs and preview', ['docs/DETAIL.md', 'docs/DETAIL.zh.md', 'preview.svg'].every((item) => pkg.files.includes(item)), JSON.stringify(pkg.files));
check('files lists the icon and readme', pkg.files.includes('icon.png') && pkg.files.includes('README.md') && pkg.files.includes('LICENSE'), JSON.stringify(pkg.files));

const failed = results.filter((item) => !item.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  process.exitCode = 1;
}