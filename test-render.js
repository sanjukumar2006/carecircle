process.env.DATA_FILE = require('path').join(require('os').tmpdir(), 'render-' + Date.now() + '.json');
const vm = require('vm'), fs = require('fs');
const { server } = require('./server');
const base = () => `http://127.0.0.1:${server.address().port}`;
async function api(m, u, b, t) {
  const r = await fetch(base() + u, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (t || '') }, body: b ? JSON.stringify(b) : undefined });
  return r.json();
}
function makeEl() { return { innerHTML: '', textContent: '', classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, dataset: {}, style: {}, open: false, showModal() {}, close() {}, querySelector() { return null; }, querySelectorAll() { return []; }, setAttribute() {}, remove() {} }; }
(async () => {
  await new Promise(r => server.listen(0, r));
  const created = await api('POST', '/api/circles', { elderName: 'Savitri Devi', yourName: 'Sanju', yourEmail: 's@x.com', setupBy: 'other', timezone: 'Asia/Kolkata' });
  await api('POST', '/api/meds', { name: 'Metformin', dose: '500 mg', times: ['00:01', '23:59'], stock: 3, perDose: 1 }, created.token);
  await api('POST', '/api/appts', { title: 'Cardiology', date: '2030-01-02', time: '10:30', needsRide: true }, created.token);
  const fam = await api('POST', '/api/members', { name: 'Ravi', role: 'family', email: 'r@x.com' }, created.token);
  const famTok = (await api('POST', '/api/login', { code: created.code, passcode: fam.passcode })).token;
  const elderTok = created.token;
  const stateFor = t => api('GET', '/api/state', null, t);

  const els = {};
  const document = { hidden: false, documentElement: makeEl(), addEventListener() {}, querySelector: s => (els[s] = els[s] || makeEl()), };
  const sandbox = { document, window: { setupBy: 'other', scrollTo() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch, console, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Intl, matchMedia: () => ({ matches: false }), navigator: {}, URL, Date, Math, JSON, Object, Array, String, Number, Promise };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  // Pre-create the dialog and app containers so $('#app') etc resolve
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('./public/app.js', 'utf8').replace(/if \(token\) \{ load\(\)[^\n]*\n/, '').replace(/^.*document\.addEventListener\('visibilitychange'.*$/m, ''), ctx);
  // install a stub for each container id used
  vm.runInContext(`const __els = {}; document.querySelector = s => (__els[s] = __els[s] || {innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},addEventListener(){},dataset:{},style:{},open:false,showModal(){},close(){},querySelector(){return null},querySelectorAll(){return []}});`, ctx);

  const results = [];
  const run = (label, fn) => { try { fn(); results.push(['ok', label]); } catch (e) { results.push(['FAIL', label, e.message]); } };
  const checks = [];
  const tryAll = (who, tokn, state) => {
    vm.runInContext(`token = ${JSON.stringify(tokn)}; S = ${JSON.stringify(state)}; loginMode='in'; tab='today';`, ctx);
    for (const t of ['today', 'meds', 'visits', 'circle', 'health']) {
      run(`${who} view ${t}`, () => { vm.runInContext(`tab = '${t}'; render();`, ctx); const html = vm.runInContext(`document.querySelector('#app').innerHTML`, ctx); if (!html.includes('class="shell"')) throw new Error('no shell'); if (/undefined|NaN|\[object/.test(html)) throw new Error('bad interpolation in ' + t); if (t === 'today' && state.hideHealth === false && !html.includes('summary')) throw new Error('no summary'); });
    }
  };
  tryAll('elder', elderTok, await stateFor(elderTok));
  tryAll('family', famTok, await stateFor(famTok));
  run('signed-out login view renders', () => { vm.runInContext(`token = null; S = null; loginMode='in'; render();`, ctx); const h = vm.runInContext(`document.querySelector('#app').innerHTML`, ctx); if (!h.includes('auth-side') || !h.includes('data-form="login"')) throw new Error('login markup missing'); });
  run('create-circle login mode renders', () => { vm.runInContext(`loginMode='new'; render();`, ctx); const h = vm.runInContext(`document.querySelector('#app').innerHTML`, ctx); if (!h.includes('data-form="create"')) throw new Error('create form missing'); });
  results.forEach(r => console.log(r[0] === 'ok' ? '  ✓ ' + r[1] : '  ✗ ' + r[1] + ' — ' + r[2]));
  const fails = results.filter(r => r[0] === 'FAIL').length;
  console.log(fails ? `\n${fails} FAILED` : '\nAll render checks passed'); server.close(); process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
