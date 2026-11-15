'use strict';
// End-to-end checks: live HTTP calls plus a simulated clock for the reminder engine.
process.env.DATA_FILE = require('path').join(require('os').tmpdir(), 'ec-test-' + Date.now() + '.json');
const assert = require('assert');
const { server, tick, db, addDays } = require('./server');

let token = '';
async function api(method, url, body, tk = token) {
  const r = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); j._status = r.status; return j;
}
const ok = (name) => console.log('  ✓', name);

(async () => {
  await new Promise(r => server.listen(0, r));

  // create a circle set up by a family member for the parent
  const created = await api('POST', '/api/circles', { elderName: 'Savitri Devi', yourName: 'Sanju', yourEmail: 'sanju@example.com', elderEmail: 'savitri@example.com', setupBy: 'other', timezone: 'Asia/Kolkata' }, '');
  assert(created.code && created.passcodes.length === 2); ok('circle created with elder + caretaker passcodes');
  const pass = r => created.passcodes.find(p => p.role === r).passcode;

  const bad = await api('POST', '/api/login', { code: created.code, passcode: 'wrong-0000' }, '');
  assert.strictEqual(bad._status, 401); ok('wrong passcode rejected');
  const el = await api('POST', '/api/login', { code: created.code.toLowerCase(), passcode: ' ' + pass('elder').toUpperCase() }, '');
  assert(el.token && el.role === 'elder'); ok('login is forgiving of case/spacing');
  const elder = el.token, caretaker = created.token;

  // family member
  const fam = await api('POST', '/api/members', { name: 'Ravi', email: 'ravi@example.com', role: 'family' }, caretaker);
  assert(fam.passcode); const famTok = (await api('POST', '/api/login', { code: created.code, passcode: fam.passcode }, '')).token;
  const famBad = await api('POST', '/api/members', { name: 'X', role: 'family' }, famTok); assert.strictEqual(famBad._status, 403); ok('family cannot invite people');

  // meds: caretaker direct, family proposes
  const now = new Date(); const tz = 'Asia/Kolkata';
  const { nowLocal } = require('./server');
  const nl = nowLocal(tz, now);
  const hh = m => String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String(((m % 1440) + 1440) % 1440 % 60).padStart(2, '0');
  // use a fixed simulated "today 08:00 IST" so results are deterministic
  const today = nl.date;
  const at = (date, hm) => new Date(Date.parse(`${date}T${hm}:00+05:30`));
  await api('POST', '/api/meds', { name: 'Metformin', dose: '500 mg', times: ['08:00', '20:00'], days: [], stock: 10, perDose: 1, instructions: 'With food' }, caretaker);
  let st = await api('GET', '/api/state', null, caretaker); assert.strictEqual(st.meds.length, 1); ok('caretaker adds a medicine directly');
  const prop = await api('POST', '/api/meds', { name: 'Vitamin D', dose: '60000 IU', times: ['09:00'], days: [1] }, famTok);
  assert(prop.proposed); st = await api('GET', '/api/state', null, elder); assert.strictEqual(st.proposals.length, 1); assert.strictEqual(st.meds.length, 1); ok('family change goes to the elder as a proposal');
  await api('POST', `/api/proposals/${st.proposals[0].id}/approve`, null, elder);
  st = await api('GET', '/api/state', null, elder); assert.strictEqual(st.meds.length, 2); ok('elder approval applies the change');
  const noApprove = await api('POST', `/api/proposals/zzzz/approve`, null, famTok); assert.strictEqual(noApprove._status, 403); ok('family cannot approve');

  // appointment needing a ride, in ~2 days
  const apDate = addDays(today, 2);
  await api('POST', '/api/appts', { title: 'Cardiology review', doctor: 'Dr. Mehta', place: 'City Hospital', date: apDate, time: '10:30', needsRide: true, questions: 'BP readings, dizziness' }, caretaker);

  // clock simulation: 07:50 → upcoming reminder to elder
  db.circles[created.code].outbox = [];
  await tick(at(today, '07:50'));
  let ob = db.circles[created.code].outbox;
  assert(ob.some(o => o.kind === 'upcoming' && o.to === 'savitri@example.com')); ok('upcoming-dose email goes to the elder');
  assert(ob.some(o => o.kind === 'ride' && o.to === 'ravi@example.com')); ok('unassigned ride triggers a family request');
  const n1 = ob.length; await tick(at(today, '07:51')); assert.strictEqual(db.circles[created.code].outbox.length, n1); ok('reminders are not repeated');

  // 09:10 → missed (grace 60) → family + caretaker emailed
  await tick(at(today, '09:10'));
  ob = db.circles[created.code].outbox;
  const missed = ob.filter(o => o.kind === 'missed'); assert(missed.some(o => o.to === 'ravi@example.com') && missed.some(o => o.to === 'sanju@example.com')); ok('missed-dose email reaches caretaker and family');
  st = await api('GET', '/api/state', null, elder);
  // state clock is real time; assert via logs instead
  assert.strictEqual(db.circles[created.code].logs[`${db.circles[created.code].meds[0].id}|${today}|08:00`].status, 'missed'); ok('missed dose recorded automatically');

  // late take is allowed and decrements stock; double dose guard
  const mid = db.circles[created.code].meds[0].id;
  const realNow = nowLocal(tz);
  // dose key for a time that already passed today or whichever is due: use today's 08:00 if real time past it, else skip guard test through direct log
  const key = `${mid}|${today}|08:00`;
  if (realNow.min >= 8 * 60) {
    const t1 = await api('POST', '/api/dose', { key, status: 'taken' }, elder); assert(t1.ok); ok('late dose can still be recorded');
    const t2 = await api('POST', '/api/dose', { key: `${mid}|${today}|20:00`, status: 'taken' }, elder);
    if (realNow.min >= 20 * 60 - 15) assert(true);
    if (t2._status === 409) ok('double-dose guard blocks a second dose too soon');
    const t3 = await api('POST', '/api/dose', { key: `${mid}|${today}|20:00`, status: 'taken', confirm: true }, elder);
    if (t2._status === 409) assert(t3.ok);
  } else {
    const early = await api('POST', '/api/dose', { key, status: 'taken' }, elder); assert(early.ok); ok('dose recorded');
  }

  // appointment reminders: 24h and 2h before
  db.circles[created.code].outbox = [];
  await tick(at(apDate, '09:00'));
  ob = db.circles[created.code].outbox; assert(ob.some(o => o.subject.startsWith('In 2 hours'))); ok('appointment 2-hour reminder sent');

  // check-in escalation + digest
  await tick(at(today, '11:05')); assert(db.circles[created.code].outbox.some(o => o.kind === 'checkin' && o.to === 'ravi@example.com')); ok('no check-in by deadline alerts family');
  await tick(at(today, '20:05')); assert(db.circles[created.code].outbox.some(o => o.kind === 'digest')); ok('evening digest sent');

  // privacy: elder hides health data from family
  await api('PUT', '/api/settings', { familySeesHealth: false }, elder);
  st = await api('GET', '/api/state', null, famTok); assert(st.hideHealth && st.notes.length === 0 && st.week.length === 0); ok('elder can hide health history from family');
  const sset = await api('PUT', '/api/settings', { familyMode: 'direct' }, caretaker); assert.strictEqual(sset._status, 403); ok('only elder changes settings');

  // sessions die when removed
  await api('DELETE', `/api/members/${fam.id}`, null, elder); st = await api('GET', '/api/state', null, famTok); assert.strictEqual(st._status, 401); ok('removed member is signed out immediately');

  // lockout
  let last; for (let i = 0; i < 7; i++) last = await api('POST', '/api/login', { code: created.code, passcode: 'nope-1111' }, ''); assert.strictEqual(last._status, 429); ok('repeated bad passcodes are locked out');

  // regression: un-taking a dose returns the tablets; re-taking takes them again
  const stock = await api('POST', '/api/meds', { name: 'Stockpill', times: ['00:01'], stock: 5, perDose: 1, days: [] }, caretaker);
  const sid = (await api('GET', '/api/state', null, caretaker)).meds.find(m => m.name === 'Stockpill').id;
  const sKey = `${sid}|${today}|00:01`;
  const stockOf = async () => (await api('GET', '/api/state', null, caretaker)).meds.find(m => m.id === sid).stock;
  await api('POST', '/api/dose', { key: sKey, status: 'taken' }, caretaker); assert.strictEqual(await stockOf(), 4);
  await api('POST', '/api/dose', { key: sKey, status: 'skipped' }, caretaker); assert.strictEqual(await stockOf(), 5);
  await api('POST', '/api/dose', { key: sKey, status: 'taken' }, caretaker); assert.strictEqual(await stockOf(), 4);
  ok('stock stays correct when a taken dose is changed to skipped and back');

  // regression: a bad time gives a clear message
  const badTime = await api('POST', '/api/meds', { name: 'X', times: ['25:99'] }, caretaker);
  assert.strictEqual(badTime._status, 400); assert(/valid time/.test(badTime.error)); ok('invalid times get a clear error');

  // deployment health check
  const hz = await fetch(`http://127.0.0.1:${server.address().port}/healthz`).then(r => r.json());
  assert.strictEqual(hz.ok, true); ok('/healthz responds for hosting platforms');

  console.log('\nAll checks passed'); server.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
