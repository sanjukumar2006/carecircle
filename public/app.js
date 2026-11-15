'use strict';
/* CareCircle front end — plain JS, no build step. */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }, del: k => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } } };
let token = ls.get('ec_token'), S = null, tab = ls.get('ec_tab') || 'today', loginMode = 'in', timer = null;

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = {}; try { j = await r.json(); } catch (e) { /* empty */ }
  if (r.status === 401 && token && url !== '/api/login') { signOut(true); throw Object.assign(new Error(j.error), { handled: true }); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), j, { status: r.status });
  return j;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3200); }
const fail = e => { if (!e.handled) toast(e.message); };

/* ── formatting ── */
const fmtTime = t => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const fmtDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtDateLong = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const clock = iso => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: S.circle.timezone });
const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], DAYNAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ROLE = { elder: 'Elder', caretaker: 'Caretaker', family: 'Family' };
const nowEpoch = () => S.now.epoch;
const naive = (date, time) => { const [y, m, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number); return Date.UTC(y, m - 1, d, h, mi) / 60000; };

const ICON = {
  today: '<path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z"/>',
  meds: '<path d="M10.5 20.5a5 5 0 01-7-7l7-7a5 5 0 017 7l-7 7zM8.5 8.5l7 7"/>',
  visits: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/>',
  circle: '<path d="M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11a2.5 2.5 0 100-5M17 14c2.8 0 5 2.2 5 5"/>',
  health: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  heart: '<path d="M12 21s-8-5.5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.5-8 11-8 11z"/>',
};
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

/* ── session ── */
function signOut(expired) { if (token && !expired) api('POST', '/api/logout').catch(() => {}); token = null; S = null; ls.del('ec_token'); clearInterval(timer); render(); if (expired) toast('Please sign in again'); }
async function load(quiet) {
  try { S = await api('GET', '/api/state'); } catch (e) { if (!quiet) fail(e); return; }
  if (ls.get('ec_simple') === null) ls.set('ec_simple', S.me.role === 'elder' ? '1' : '0');
  document.documentElement.classList.toggle('simple', ls.get('ec_simple') === '1');
  if (!$('#dlg').open) render();
}
function startPolling() { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) load(true); }, 30000); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && token) load(true); });

/* ── dialogs ── */
const dlg = () => $('#dlg');
function openDlg(html) { dlg().innerHTML = `<div>${html}</div>`; if (!dlg().open) dlg().showModal(); }
function closeDlg() { if (dlg().open) dlg().close(); }
dlg().addEventListener('close', () => { if (S) render(); });
function confirmDlg(title, body, yes, onYes, danger) {
  openDlg(`<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="row"><button class="${danger ? 'danger' : 'primary'} grow" id="yes">${esc(yes)}</button><button class="grow" data-act="close">Cancel</button></div>`);
  $('#yes').onclick = () => { closeDlg(); onYes(); };
}
function passDlg(title, list) {
  openDlg(`<h2>${esc(title)}</h2><p class="muted">Write these down or share them privately. For safety they are shown only once; you can always make a new one.</p>
    <p><b>Circle code:</b> <span class="pass">${esc(S ? S.circle.code : list.code)}</span></p>
    ${list.items.map(p => `<div class="card"><b>${esc(p.name)}</b> <span class="chip">${ROLE[p.role]}</span><span class="pass">${esc(p.passcode)}</span></div>`).join('')}
    <div class="row"><button class="grow" data-act="copy" data-text="${esc(`Circle code: ${S ? S.circle.code : list.code}\n` + list.items.map(p => `${p.name}: ${p.passcode}`).join('\n'))}">Copy</button><button class="primary grow" data-act="close">Done</button></div>`);
}

/* ── rendering ── */
const LOGO = (c = 'var(--primary)') => `<svg class="logo" viewBox="0 0 28 28" aria-hidden="true" style="color:${c}"><rect width="28" height="28" rx="8" fill="currentColor" opacity=".14"/><path d="M14 21.5s-6.6-4.1-6.6-8.5a3.4 3.4 0 0 1 6.6-1.1 3.4 3.4 0 0 1 6.6 1.1c0 4.4-6.6 8.5-6.6 8.5z" fill="currentColor"/></svg>`;
function render() {
  const app = $('#app');
  if (!token || !S) { app.innerHTML = loginView(); return; }
  const views = { today: todayView, meds: medsView, visits: visitsView, circle: circleView, health: healthView };
  const tabsDef = [['today', 'Today'], ['meds', 'Medicines'], ['visits', 'Appointments'], ['circle', 'Care circle'], ['health', 'Health']];
  const simple = ls.get('ec_simple') === '1';
  const navBtn = ([k, l]) => `<button data-act="tab" data-tab="${k}" ${tab === k ? 'aria-current="page"' : ''}>${icon(k)}<span>${l}</span>${k === 'today' && S.proposals.length && canDecide() ? '<span class="sr-only"> (suggestions waiting)</span><span aria-hidden="true" class="chip warn">' + S.proposals.length + '</span>' : ''}</button>`;
  app.innerHTML = `<div class="shell">
    <header class="mtop only-mob"><div class="in"><span class="brand">${LOGO()}${esc(S.circle.elderName)}’s care</span>
      <span class="row"><button data-act="simple" aria-pressed="${simple}">${simple ? 'Smaller' : 'Larger'} text</button><button data-act="signout">Sign out</button></span></div></header>
    <aside class="side only-desk" aria-label="Sidebar">
      <div class="brand">${LOGO()}CareCircle</div>
      <nav aria-label="Main">${tabsDef.map(navBtn).join('')}</nav>
      <div class="side-foot"><div class="who"><b>${esc(S.me.name)}</b><span>${ROLE[S.me.role]} · ${esc(S.circle.elderName)}’s circle</span></div>
        <div class="row"><button data-act="simple" aria-pressed="${simple}">${simple ? 'Smaller' : 'Larger'} text</button><button data-act="signout">Sign out</button></div></div>
    </aside>
    <main class="wrap" id="main" tabindex="-1">${views[tab]()}</main>
    <nav class="tabs only-mob" aria-label="Main mobile">${tabsDef.map(navBtn).join('')}</nav>
  </div>`;
}

const canDecide = () => S.me.role === 'elder' || (S.me.role === 'caretaker' && S.circle.settings.caretakerApproves);
const manage = () => S.me.role !== 'family';

/* ── login ── */
function loginView() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  const setup = window.setupBy || 'other';
  const signIn = loginMode === 'in';
  const form = signIn
    ? `<form class="card" data-form="login"><label>Circle code<input name="code" autocomplete="off" autocapitalize="characters" placeholder="e.g. K7M2QX" required value="${esc(ls.get('ec_code') || '')}"></label>
    <label>Your passcode<input name="passcode" autocomplete="off" autocapitalize="none" placeholder="e.g. maple-4821" required></label>
    <button class="primary big" type="submit">Sign in</button><p class="muted small">Ask the person who set up the circle for your code and passcode. Each person has their own.</p></form>`
    : `<form class="card" data-form="create"><div class="seg" role="group" aria-label="Who is this for"><button type="button" data-act="setup" data-v="self" aria-pressed="${setup === 'self'}">It's for me</button><button type="button" data-act="setup" data-v="other" aria-pressed="${setup === 'other'}">For someone I care for</button></div>
    <label>Name of the person being cared for<input name="elderName" required maxlength="60" placeholder="e.g. Savitri Devi"></label>
    ${setup === 'other' ? `<label>Your name<input name="yourName" required maxlength="60"></label>` : ''}
    <label>Your email (for reminders)<input name="yourEmail" type="email" autocomplete="email" placeholder="you@example.com"></label>
    ${setup === 'other' ? `<label>Their email (optional)<input name="elderEmail" type="email" placeholder="So they get dose reminders too"></label>` : ''}
    <label>Time zone<input name="timezone" value="${esc(tz)}" required></label>
    <button class="primary big" type="submit">Create circle</button></form>`;
  return `<div class="auth">
    <aside class="auth-side" aria-label="About CareCircle">
      <div class="brand" style="color:#fff;font-size:1.1rem">${LOGO('#8fd3ad')}CareCircle</div>
      <div>
        <h2>Medicines, appointments and peace of mind, shared by the whole family.</h2>
        <p>One calm place for the people who look after someone. The elder stays in charge of their own care.</p>
        <ul>
          <li>The elder decides who can change the care plan, and what family can see.</li>
          <li>Reminders reach the people who need them, once, at the right time.</li>
          <li>A missed dose is noticed and shared with the circle, not left to chance.</li>
        </ul>
      </div>
      <p class="small" style="opacity:.6">Organises care. Not medical advice.</p>
    </aside>
    <section class="auth-main">
      <div class="auth-card">
        <div class="auth-mobile-brand">${LOGO()}CareCircle</div>
        <div class="auth-head">
          <h1>${signIn ? 'Welcome back' : 'Start a care circle'}</h1>
          <p>${signIn ? 'Sign in with your circle code and your personal passcode.' : 'Set up a circle for the person you care for. Each person gets their own passcode.'}</p>
        </div>
        <div class="seg" role="group" aria-label="Choose"><button data-act="lmode" data-m="in" aria-pressed="${signIn}">Sign in</button><button data-act="lmode" data-m="new" aria-pressed="${!signIn}">Start a care circle</button></div>
        <div class="auth-form">${form}</div>
        <p class="auth-foot">Passcodes are stored hashed. Sign-in locks for 10 minutes after repeated wrong tries.</p>
      </div>
    </section>
  </div>`;
}

/* ── today ── */
function todayView() {
  const h = Math.floor(S.now.min / 60), greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const first = S.me.name.split(' ')[0];
  const open = S.today.filter(d => ['due', 'missed', 'upcoming'].includes(d.status));
  const next = S.appts.find(a => naive(a.date, a.time) >= nowEpoch());
  const nextDose = S.today.find(d => d.status === 'due' || d.status === 'upcoming');
  const pend = canDecide() ? S.proposals : [];
  const done = S.today.filter(d => d.status === 'taken').length, total = S.today.length;
  const C = 2 * Math.PI * 40;
  const ring = total && !S.hideHealth ? `<svg class="ring" viewBox="0 0 100 100" role="img" aria-label="${done} of ${total} doses taken today"><circle class="track" cx="50" cy="50" r="40"/><circle class="bar" cx="50" cy="50" r="40" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - done / total)).toFixed(1)}"/><text x="50" y="50">${Math.round(done / total * 100)}%</text></svg>` : '';
  const summary = `<section class="summary" aria-label="Today at a glance">
    ${S.hideHealth ? '' : `<div class="card ring-card">${ring || '<div class="kpi"><span class="label">Medicines</span><b>None today</b></div>'}
      ${total ? `<div class="kpi"><span class="label">Today's doses</span><b>${done} of ${total} taken</b>${open.length ? `<span class="muted small">${open.length} still to go</span>` : '<span class="muted small">All done</span>'}</div>` : ''}</div>
    <div class="card kpi"><span class="label">Next dose</span>${nextDose && !S.hideHealth ? `<b>${esc(nextDose.name)}</b><span class="muted small">${fmtTime(nextDose.time)}${nextDose.status === 'due' ? ' · due now' : ''}</span>` : '<b>No doses due</b><span class="muted small">Reminders run automatically</span>'}</div>`}
    <div class="card kpi"><span class="label">Next appointment</span>${next ? `<b>${esc(next.title)}</b><span class="muted small">${fmtDate(next.date)} · ${fmtTime(next.time)}</span>` : '<b>None scheduled</b><span class="muted small">Add one under Appointments</span>'}</div>
  </section>`;
  return `<div class="hello"><h1>${greet}, ${esc(first)}</h1><p>${fmtDateLong(S.now.date)}${S.me.role !== 'elder' ? ` · Caring for ${esc(S.circle.elderName)}` : ''}</p></div>
  ${summary}
  ${pend.map(p => `<div class="banner"><div><b>${esc(p.byName)}</b> suggests: ${esc(p.summary)}</div><div class="row"><button class="primary small" data-act="decide" data-id="${p.id}" data-v="approve">Approve</button><button class="small" data-act="decide" data-id="${p.id}" data-v="reject">Decline</button></div></div>`).join('')}
  ${S.lowStock.map(l => `<div class="banner bad" role="status">${esc(l.name)} is running low: about ${l.daysLeft} day(s) left (${l.stock} on hand).</div>`).join('')}
  ${checkinCard()}
  <section aria-labelledby="meds-h" style="display:grid;gap:12px">
    <div class="row between"><h2 id="meds-h">Today's medicines</h2><span class="muted small">${total ? `${done} of ${total} taken` : ''}</span></div>
    ${total ? S.today.map(doseCard).join('') : `<div class="card"><p>No medicines scheduled today.</p>${manage() ? `<div><button data-act="tab" data-tab="meds">Add a medicine</button></div>` : ''}</div>`}
    ${!open.length && total && !S.hideHealth ? `<div class="banner ok">All of today's doses are done. Well done.</div>` : ''}
  </section>
  ${next ? `<section style="display:grid;gap:12px"><h2>Next appointment</h2>${apptCard(next, true)}</section>` : ''}
  ${!S.hideHealth && S.activity.length ? `<section class="card"><h2>Family activity</h2><ul class="feed">${S.activity.slice(0, 5).map(a => `<li><div><b>${esc(a.who)}</b> ${esc(a.text)}<div class="meta">${ago(a.at)}</div></div></li>`).join('')}</ul></section>` : ''}`;
}
function checkinCard() {
  const c = S.checkin;
  if (c) return `<div class="card"><div class="row between"><b>Today's check-in</b><span class="chip ${c.feeling === 'Not well' ? 'bad' : 'good'}">${esc(c.feeling)}</span></div><p class="muted small">${esc(c.by)} at ${clock(c.at)}</p></div>`;
  return `<div class="card"><h3>${S.me.role === 'elder' ? 'How are you feeling today?' : `Check in for ${esc(S.circle.elderName)}`}</h3>
    <div class="mood"><button class="primary" data-act="checkin" data-f="Great">Great</button><button data-act="checkin" data-f="Okay">Okay</button><button class="danger" data-act="checkin" data-f="Not well">Not well</button></div>
    <p class="muted small">Family is told if there is no check-in by ${fmtTime(S.circle.settings.checkinDeadline)}, or right away if you tap “Not well”.</p></div>`;
}
function doseCard(d) {
  const label = `${esc(d.name)}${d.dose ? ' · ' + esc(d.dose) : ''}`;
  const meta = [d.instructions, d.purpose && 'For ' + d.purpose].filter(Boolean).map(esc).join(' · ');
  const stat = { taken: `<span class="chip good">Taken at ${clock(d.takenAt)}${d.by && d.by !== S.circle.elderName ? ' · by ' + esc(d.by) : ''}${d.late ? ' (late)' : ''}</span>`, skipped: `<span class="chip gray">Skipped</span>`, missed: `<span class="chip bad">Missed</span>`, due: `<span class="chip warn">Due now</span>`, upcoming: `<span class="chip gray">${d.minsUntil < 60 ? 'In ' + d.minsUntil + ' min' : 'Later today'}</span>`, hidden: `<span class="chip gray">Private</span>` }[d.status];
  const act = d.status === 'due' || d.status === 'missed'
    ? `<div class="row"><button class="primary big" data-act="dose" data-key="${esc(d.key)}" data-s="taken">${S.me.role === 'elder' ? 'I took it' : 'Mark as taken'}</button><button data-act="dose" data-key="${esc(d.key)}" data-s="skipped">Skip</button></div>`
    : d.status === 'upcoming' ? `<div class="row"><button class="small" data-act="dose" data-key="${esc(d.key)}" data-s="taken">Took it early</button></div>`
    : (d.status === 'taken' || d.status === 'skipped') ? `<div class="row"><button class="ghost small" data-act="dose" data-key="${esc(d.key)}" data-s="undo">Undo</button></div>` : '';
  return `<article class="dose ${d.status}"><div class="row between"><span class="time">${fmtTime(d.time)}</span>${stat}</div><div class="name">${label}</div>${meta ? `<p class="muted">${meta}</p>` : ''}${act}</article>`;
}

/* ── medicines ── */
const modeWord = () => S.me.mode === 'direct' ? ['Add', 'Save'] : ['Suggest', 'Send suggestion'];
function medsView() {
  const [verb] = modeWord(), can = S.me.mode !== 'none';
  return `<div class="row between"><h1>Medicines</h1>${can ? `<button class="primary" data-act="medform">${verb} medicine</button>` : ''}</div>
  ${S.me.mode === 'propose' ? `<p class="banner">${esc(S.circle.elderName)} approves changes. Your edits are sent as suggestions.</p>` : ''}
  ${S.me.mode === 'none' ? `<p class="banner">You have view-only access to this circle.</p>` : ''}
  ${S.meds.length ? `<div class="card flat">${S.meds.map(m => `<div class="item"><div class="row between"><b>${esc(m.name)} ${esc(m.dose)}</b>${m.paused ? '<span class="chip gray">Paused</span>' : ''}</div>
    <p>${m.times.map(fmtTime).join(' · ')} · ${m.days.length ? m.days.map(d => DAYNAMES[d]).join(', ') : 'Every day'}</p>
    <p class="muted small">${[m.form, m.instructions, m.purpose && 'For ' + m.purpose, m.endDate && 'Until ' + fmtDate(m.endDate)].filter(Boolean).map(esc).join(' · ')}</p>
    ${m.stock != null ? `<p class="small ${S.lowStock.some(l => l.medId === m.id) ? 'chip bad' : 'muted'}">${m.stock} left in stock</p>` : ''}
    ${can ? `<div class="row"><button class="small" data-act="medform" data-id="${m.id}">Edit</button><button class="small danger" data-act="meddel" data-id="${m.id}">${S.me.mode === 'direct' ? 'Remove' : 'Suggest removal'}</button></div>` : ''}</div>`).join('')}</div>` : `<div class="card"><p>No medicines yet. Add the first one and reminders start automatically.</p></div>`}`;
}
let mf = null;
function medFormHtml() {
  const m = mf, [, saveWord] = modeWord();
  return `<h2>${m.id ? 'Edit' : 'New'} medicine</h2><form data-form="med" class="grid2" style="grid-template-columns:1fr">
  <label>Name<input name="name" required maxlength="80" value="${esc(m.name)}" placeholder="e.g. Metformin"></label>
  <div class="grid2"><label>Strength / dose<input name="dose" maxlength="60" value="${esc(m.dose)}" placeholder="500 mg"></label>
  <label>Form<select name="form">${['', 'Tablet', 'Capsule', 'Syrup', 'Drops', 'Injection', 'Inhaler', 'Cream'].map(f => `<option ${m.form === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label></div>
  <div><b class="small">Times each day</b><div class="row" style="margin-top:6px">${m.times.map(t => `<span class="chip">${fmtTime(t)} <button type="button" class="ghost small" style="min-height:24px;padding:0 4px" aria-label="Remove ${fmtTime(t)}" data-act="rmtime" data-t="${t}">✕</button></span>`).join('')}
  <label class="sr-only" for="newtime">New dose time</label><input type="time" id="newtime" style="width:auto"><button type="button" class="small" data-act="addtime">Add time</button></div></div>
  <div><b class="small">Days</b> <span class="muted small">(none selected = every day)</span><div class="days" style="margin-top:6px">${DAYS.map((d, i) => `<label><input type="checkbox" name="day" value="${i}" ${m.days.includes(i) ? 'checked' : ''} aria-label="${DAYNAMES[i]}"><span>${DAYNAMES[i]}</span></label>`).join('')}</div></div>
  <label>Instructions<input name="instructions" maxlength="200" value="${esc(m.instructions)}" placeholder="With food, after meals…"></label>
  <label>What it's for<input name="purpose" maxlength="100" value="${esc(m.purpose)}" placeholder="Blood sugar"></label>
  <div class="grid2"><label>Tablets in stock<input name="stock" type="number" min="0" value="${m.stock ?? ''}" placeholder="Optional"></label>
  <label>Taken per dose<input name="perDose" type="number" min="0.25" step="0.25" value="${m.perDose}"></label></div>
  <div class="grid2"><label>Start date<input name="startDate" type="date" value="${esc(m.startDate)}"></label><label>Stop date (optional)<input name="endDate" type="date" value="${esc(m.endDate || '')}"></label></div>
  <label>Minimum hours between doses<input name="minGapHours" type="number" min="0" max="24" step="0.5" value="${m.minGapHours}"></label>
  <label class="check"><input type="checkbox" name="paused" ${m.paused ? 'checked' : ''}> Pause this medicine (no reminders)</label>
  <div class="row"><button class="primary grow" type="submit">${saveWord}</button><button type="button" class="grow" data-act="close">Cancel</button></div></form>`;
}
function readMedForm() {
  const f = $('#dlg form'); if (!f) return;
  const g = n => f.elements[n];
  Object.assign(mf, { name: g('name').value, dose: g('dose').value, form: g('form').value, instructions: g('instructions').value, purpose: g('purpose').value, stock: g('stock').value, perDose: g('perDose').value, startDate: g('startDate').value, endDate: g('endDate').value, minGapHours: g('minGapHours').value, paused: g('paused').checked, days: [...f.querySelectorAll('[name=day]:checked')].map(x => +x.value) });
}

/* ── appointments ── */
function apptCard(a, compact) {
  const mine = a.volunteers.some(v => v.id === S.me.id), past = naive(a.date, a.time) < nowEpoch();
  return `<article class="card"><div class="row between"><h3>${esc(a.title)}</h3><span class="chip ${past ? 'gray' : ''}">${fmtDate(a.date)} · ${fmtTime(a.time)}</span></div>
  <p>${[a.doctor, a.place].filter(Boolean).map(esc).join(' · ')}</p>
  ${a.notes ? `<p class="muted">${esc(a.notes)}</p>` : ''}${a.questions ? `<p><b class="small">Questions to ask:</b> ${esc(a.questions)}</p>` : ''}
  <div class="row"><span class="chip ${a.volunteers.length ? 'good' : a.needsRide ? 'warn' : 'gray'}">${a.volunteers.length ? 'Going along: ' + a.volunteers.map(v => esc(v.name)).join(', ') : a.needsRide ? 'Needs someone to go along' : 'No companion needed'}</span></div>
  ${!past && S.me.role !== 'elder' ? `<button class="${mine ? '' : 'primary'}" data-act="volunteer" data-id="${a.id}">${mine ? 'I can’t go after all' : 'I’ll go along'}</button>` : ''}
  ${!compact && S.me.mode !== 'none' ? `<div class="row"><button class="small" data-act="apptform" data-id="${a.id}">Edit</button><button class="small danger" data-act="apptdel" data-id="${a.id}">${S.me.mode === 'direct' ? 'Cancel appointment' : 'Suggest cancelling'}</button></div>` : ''}</article>`;
}
function visitsView() {
  const up = S.appts.filter(a => naive(a.date, a.time) >= nowEpoch()), past = S.appts.filter(a => naive(a.date, a.time) < nowEpoch()).reverse().slice(0, 5);
  return `<div class="row between"><h1>Appointments</h1>${S.me.mode !== 'none' ? `<button class="primary" data-act="apptform">${modeWord()[0]} appointment</button>` : ''}</div>
  ${up.length ? up.map(a => apptCard(a)).join('') : `<div class="card"><p>No upcoming appointments.</p></div>`}
  ${past.length ? `<h2>Recent</h2>${past.map(a => apptCard(a, true)).join('')}` : ''}`;
}
function apptFormHtml(a) {
  return `<h2>${a.id ? 'Edit' : 'New'} appointment</h2><form data-form="appt" style="display:grid;gap:12px">
  <label>What is it?<input name="title" required maxlength="100" value="${esc(a.title)}" placeholder="Eye check-up"></label>
  <div class="grid2"><label>Doctor<input name="doctor" maxlength="80" value="${esc(a.doctor)}"></label><label>Place<input name="place" maxlength="120" value="${esc(a.place)}"></label></div>
  <div class="grid2"><label>Date<input name="date" type="date" required value="${esc(a.date)}"></label><label>Time<input name="time" type="time" required value="${esc(a.time)}"></label></div>
  <label>Notes<textarea name="notes" maxlength="400">${esc(a.notes)}</textarea></label>
  <label>Questions to ask the doctor<textarea name="questions" maxlength="400">${esc(a.questions)}</textarea></label>
  <label class="check"><input type="checkbox" name="needsRide" ${a.needsRide ? 'checked' : ''}> Someone should go along (family is asked 3 days before if nobody has offered)</label>
  <div class="row"><button class="primary grow" type="submit">${modeWord()[1]}</button><button type="button" class="grow" data-act="close">Cancel</button></div></form>`;
}

/* ── circle ── */
function idCard() {
  const who = S.me.role === 'elder' ? 'Your care circle' : `Caring for ${esc(S.circle.elderName)}`;
  return `<div class="idwrap"><article class="idcard" aria-label="Care circle ID for ${esc(S.me.name)}">
    <div class="id-top"><span>CareCircle</span><span>${ROLE[S.me.role]}</span></div>
    <div><div class="id-name">${esc(S.me.name)}</div><div style="opacity:.8">${who}</div></div>
    <div class="id-meta"><span>Circle code <b class="id-pass">${esc(S.circle.code)}</b></span><span>${S.me.role === 'elder' ? 'You decide' : 'Shared care'}</span></div>
  </article></div>`;
}
/* gentle tilt for the ID card; skipped for reduced motion and touch-only devices */
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
document.addEventListener('pointermove', ev => {
  const card = ev.target.closest && ev.target.closest('.idcard'); if (!card || reduceMotion()) return;
  const r = card.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width - .5, y = (ev.clientY - r.top) / r.height - .5;
  card.style.setProperty('--ry', (x * 12).toFixed(2) + 'deg'); card.style.setProperty('--rx', (-y * 10).toFixed(2) + 'deg');
});
document.addEventListener('pointerout', ev => {
  const card = ev.target.closest && ev.target.closest('.idcard');
  if (card && !(ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('.idcard'))) { card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); }
});
function circleView() {
  const s = S.circle.settings, me = S.me;
  return `<h1>Care circle</h1>${idCard()}<p class="muted">Circle code <span class="pass" style="font-size:1rem">${esc(S.circle.code)}</span></p>
  <section class="card flat"><div class="item row between"><h2>People</h2>${manage() ? `<button class="primary small" data-act="invite">Invite</button>` : ''}</div>
  ${S.members.map(m => `<div class="item"><div class="row between"><span><b>${esc(m.name)}</b>${m.id === me.id ? ' (you)' : ''}</span><span class="chip">${ROLE[m.role]}</span></div>
    <p class="muted small">${m.email ? esc(m.email) : 'No email: gets no reminders'}</p>
    ${manage() && m.id !== me.id && (me.role === 'elder' || m.role === 'family') ? `<div class="row"><button class="small" data-act="reset" data-id="${m.id}">New passcode</button>${me.role === 'elder' && m.role !== 'elder' ? `<button class="small danger" data-act="remove" data-id="${m.id}">Remove</button>` : ''}</div>` : ''}</div>`).join('')}</section>

  <form class="card" data-form="prefs"><h2>My reminders</h2>
    <label>My email<input name="email" type="email" value="${esc(me.email)}" placeholder="you@example.com"></label>
    ${[['upcoming', 'A dose is coming up'], ['missed', 'A dose is missed'], ['appts', 'Appointment reminders'], ['lowStock', 'Medicine running low'], ['digest', 'Evening summary'], ['checkin', 'Check-in alerts and symptoms']].map(([k, l]) => `<label class="check"><input type="checkbox" name="${k}" ${me.prefs[k] ? 'checked' : ''}> ${l}</label>`).join('')}
    <div class="row"><button class="primary" type="submit">Save</button><button type="button" data-act="testmail">Send a test email</button></div>
    <p class="small ${S.mail === 'demo' ? 'banner' : 'muted'}">${S.mail === 'demo' ? 'Email is in demo mode: messages appear in the Outbox below but are not delivered. Add SMTP settings on the server to send real email (see README).' : 'Email delivery is on.'}</p></form>

  ${me.role === 'elder' ? `<form class="card" data-form="settings"><h2>My rules</h2><p class="muted small">You decide who can change your care plan and what family can see.</p>
    <label>When family edits medicines or appointments<select name="familyMode"><option value="propose" ${s.familyMode === 'propose' ? 'selected' : ''}>They suggest, I approve</option><option value="direct" ${s.familyMode === 'direct' ? 'selected' : ''}>They can change directly</option><option value="view" ${s.familyMode === 'view' ? 'selected' : ''}>View only</option></select></label>
    <label>When caretakers edit<select name="caretakerMode"><option value="direct" ${s.caretakerMode === 'direct' ? 'selected' : ''}>They can change directly</option><option value="propose" ${s.caretakerMode === 'propose' ? 'selected' : ''}>They suggest, I approve</option></select></label>
    <label class="check"><input type="checkbox" name="caretakerApproves" ${s.caretakerApproves ? 'checked' : ''}> Caretakers may approve family suggestions for me</label>
    <label class="check"><input type="checkbox" name="familySeesHealth" ${s.familySeesHealth ? 'checked' : ''}> Family can see dose history, notes and activity</label>
    <div class="grid2"><label>Counts as missed after (minutes)<input name="graceMin" type="number" min="15" max="240" value="${s.graceMin}"></label><label>Remind me before a dose (minutes)<input name="leadMin" type="number" min="0" max="60" value="${s.leadMin}"></label>
    <label>Expect my check-in by<input name="checkinDeadline" type="time" value="${s.checkinDeadline}"></label><label>Evening summary at<input name="digestTime" type="time" value="${s.digestTime}"></label>
    <label>Refill warning (days left)<input name="lowStockDays" type="number" min="1" max="30" value="${s.lowStockDays}"></label></div>
    <button class="primary" type="submit">Save rules</button></form>` : ''}

  ${S.hideHealth ? `<div class="card"><p class="muted">${esc(S.circle.elderName)} keeps notes and history private from family.</p></div>` : `
  <form class="card" data-form="note"><h2>Care notes</h2><label>Share an update<textarea name="text" maxlength="500" placeholder="Dizzy after lunch, BP 140/90…"></textarea></label>
    <label class="check"><input type="checkbox" name="symptom"> This is a symptom (alert the caretakers and family)</label><button class="primary" type="submit">Post note</button></form>
  ${S.notes.length ? `<div class="card flat">${S.notes.map(n => `<div class="item"><div class="note ${n.kind}"><p>${esc(n.text)}</p><p class="muted small">${esc(n.by)} · ${ago(n.at)}${n.kind === 'symptom' ? ' · symptom' : ''}${n.by === me.name || me.role === 'elder' ? ` · <button class="ghost small" style="min-height:24px;padding:0 4px" data-act="delnote" data-id="${n.id}">remove</button>` : ''}</p></div></div>`).join('')}</div>` : ''}
  <details class="card"><summary><b>Who did what</b></summary><div style="display:grid;gap:8px;margin-top:10px">${S.activity.map(a => `<p class="small"><span class="muted">${ago(a.at)}</span> <b>${esc(a.who)}</b> ${esc(a.text)}</p>`).join('') || '<p class="muted">Nothing yet.</p>'}</div></details>`}

  ${manage() ? `<details class="card"><summary><b>Email outbox</b> <span class="muted small">(${S.mail === 'demo' ? 'demo mode' : 'live'})</span></summary><div style="display:grid;gap:10px;margin-top:10px">${S.outbox.map(o => `<div class="small"><span class="chip ${o.status === 'sent' ? 'good' : o.status === 'failed' ? 'bad' : 'gray'}">${o.status}</span> <b>${esc(o.subject)}</b> to ${esc(o.toName)} · ${ago(o.at)}<br><span class="muted">${esc(o.body)}</span></div>`).join('') || '<p class="muted">No emails yet.</p>'}</div></details>` : ''}`;
}

/* ── health ── */
function healthView() {
  const e = S.circle.emergency, max = Math.max(1, ...S.week.map(w => w.scheduled));
  const card = `<section class="card"><div class="row between"><h2>Health card</h2>${manage() ? `<button class="small" data-act="cardform">Edit</button>` : ''}</div>
    <div class="grid2"><div><span class="muted small">Blood group</span><p><b>${esc(e.bloodGroup) || '—'}</b></p></div><div><span class="muted small">Allergies</span><p><b>${esc(e.allergies) || '—'}</b></p></div></div>
    <div><span class="muted small">Conditions</span><p>${esc(e.conditions) || '—'}</p></div>
    <div><span class="muted small">Current medicines</span><p>${S.meds.filter(m => !m.paused).map(m => `${esc(m.name)} ${esc(m.dose)} (${m.times.map(fmtTime).join(', ')})`).join('; ') || '—'}</p></div>
    <div><span class="muted small">Doctors</span>${e.doctors.map(d => `<p>${esc(d.name)} ${d.detail ? '· ' + esc(d.detail) : ''} <b>${esc(d.phone)}</b></p>`).join('') || '<p>—</p>'}</div>
    <div><span class="muted small">Emergency contacts</span>${e.contacts.map(d => `<p>${esc(d.name)} ${d.detail ? '· ' + esc(d.detail) : ''} <b>${esc(d.phone)}</b></p>`).join('') || '<p>—</p>'}</div>
    ${e.notes ? `<div><span class="muted small">Notes for paramedics or hospital</span><p>${esc(e.notes)}</p></div>` : ''}
    <button data-act="print">Print this card</button></section>`;
  if (S.hideHealth) return `<h1>Health</h1><div class="card"><p class="muted">${esc(S.circle.elderName)} keeps dose history private from family.</p></div>${card}`;
  return `<h1>Health</h1><section class="card"><h2>This week</h2>
    <div class="stats"><div class="stat"><b>${S.pct == null ? '—' : S.pct + '%'}</b><span class="muted small">doses taken, last 7 days</span></div><div class="stat"><b>${S.streak}</b><span class="muted small">day streak, every dose taken</span></div></div>
    <div class="bars" role="img" aria-label="Doses per day for the last 7 days">${S.week.map(w => `<div><div class="bar" style="height:${Math.max(6, Math.round(w.scheduled / max * 100))}px" title="${w.taken} taken, ${w.skipped} skipped, ${w.missed} missed of ${w.scheduled}">
      <i class="t" style="height:${w.scheduled ? w.taken / w.scheduled * 100 : 0}%"></i><i class="s" style="height:${w.scheduled ? w.skipped / w.scheduled * 100 : 0}%"></i><i class="m" style="height:${w.scheduled ? w.missed / w.scheduled * 100 : 0}%"></i></div>${DAYNAMES[new Date(w.date + 'T00:00:00Z').getUTCDay()]}</div>`).join('')}</div>
    <p class="small muted"><span class="chip good">taken</span> <span class="chip warn">skipped</span> <span class="chip bad">missed</span></p></section>${card}`;
}
let cf = null;
function cardFormHtml() {
  const lines = a => a.map(x => [x.name, x.detail, x.phone].filter(v => v !== undefined).join(' | ')).join('\n');
  return `<h2>Edit health card</h2><form data-form="card" style="display:grid;gap:12px">
  <div class="grid2"><label>Blood group<input name="bloodGroup" maxlength="400" value="${esc(cf.bloodGroup)}"></label><label>Allergies<input name="allergies" maxlength="400" value="${esc(cf.allergies)}"></label></div>
  <label>Conditions<textarea name="conditions">${esc(cf.conditions)}</textarea></label>
  <label>Doctors <span class="muted small">(one per line: Name | Speciality | Phone)</span><textarea name="doctors">${esc(lines(cf.doctors))}</textarea></label>
  <label>Emergency contacts <span class="muted small">(Name | Relation | Phone)</span><textarea name="contacts">${esc(lines(cf.contacts))}</textarea></label>
  <label>Notes for paramedics<textarea name="notes">${esc(cf.notes)}</textarea></label>
  <div class="row"><button class="primary grow" type="submit">Save</button><button type="button" class="grow" data-act="close">Cancel</button></div></form>`;
}
const parseLines = t => t.split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p[0]).map(p => ({ name: p[0], detail: p.length > 2 ? p[1] : '', phone: p.length > 2 ? p[2] : (p[1] || '') }));

/* ── actions ── */
const emptyMed = () => ({ name: '', dose: '', form: '', times: ['08:00'], days: [], instructions: '', purpose: '', stock: '', perDose: 1, startDate: S.now.date, endDate: '', minGapHours: 3, paused: false });
const emptyAppt = () => ({ title: '', doctor: '', place: '', date: S.now.date, time: '10:00', notes: '', questions: '', needsRide: false });
let editId = null, apptDraft = null;

async function doseAction(key, status, confirm) {
  try { await api('POST', '/api/dose', { key, status, confirm }); await load(); if (status === 'taken') toast('Recorded. Family can see you took it.'); }
  catch (e) { if (e.needsConfirm) confirmDlg('Careful: second dose?', e.message, 'Yes, I need to record it', () => doseAction(key, status, true), true); else fail(e); }
}
async function submitChange(method, url, body, doneMsg) {
  const r = await api(method, url, body); closeDlg(); await load(); toast(r.proposed ? 'Suggestion sent for approval' : doneMsg);
}

document.addEventListener('click', async ev => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, d = el.dataset;
  try {
    switch (a) {
      case 'tab': tab = d.tab; ls.set('ec_tab', tab); render(); window.scrollTo(0, 0); break;
      case 'close': closeDlg(); break;
      case 'copy': try { await navigator.clipboard.writeText(d.text); toast('Copied'); } catch (e) { toast('Select the text and copy it'); } break;
      case 'print': window.print(); break;
      case 'signout': signOut(); break;
      case 'simple': ls.set('ec_simple', ls.get('ec_simple') === '1' ? '0' : '1'); document.documentElement.classList.toggle('simple', ls.get('ec_simple') === '1'); render(); break;
      case 'lmode': loginMode = d.m; render(); break;
      case 'setup': window.setupBy = d.v; render(); break;
      case 'dose': await doseAction(d.key, d.s); break;
      case 'checkin': await api('POST', '/api/checkin', { feeling: d.f }); await load(); toast(d.f === 'Not well' ? 'Family has been told. Take care.' : 'Thanks for checking in'); break;
      case 'decide': await api('POST', `/api/proposals/${d.id}/${d.v}`); await load(); toast(d.v === 'approve' ? 'Approved' : 'Declined'); break;
      case 'volunteer': await api('POST', `/api/appts/${d.id}/volunteer`); await load(); break;
      case 'medform': editId = d.id || null; mf = d.id ? { ...S.meds.find(m => m.id === d.id) } : emptyMed(); openDlg(medFormHtml()); break;
      case 'addtime': { readMedForm(); const v = $('#newtime').value; if (v && !mf.times.includes(v)) mf.times = [...mf.times, v].sort(); dlg().innerHTML = `<div>${medFormHtml()}</div>`; break; }
      case 'rmtime': readMedForm(); mf.times = mf.times.filter(t => t !== d.t); dlg().innerHTML = `<div>${medFormHtml()}</div>`; break;
      case 'meddel': confirmDlg(S.me.mode === 'direct' ? 'Remove this medicine?' : 'Suggest removal?', S.meds.find(m => m.id === d.id).name, S.me.mode === 'direct' ? 'Remove' : 'Send suggestion', () => submitChange('DELETE', `/api/meds/${d.id}`, null, 'Removed').catch(fail), true); break;
      case 'apptform': editId = d.id || null; apptDraft = d.id ? { ...S.appts.find(x => x.id === d.id) } : emptyAppt(); openDlg(apptFormHtml(apptDraft)); break;
      case 'apptdel': confirmDlg(S.me.mode === 'direct' ? 'Cancel this appointment?' : 'Suggest cancelling?', S.appts.find(x => x.id === d.id).title, 'Yes', () => submitChange('DELETE', `/api/appts/${d.id}`, null, 'Cancelled').catch(fail), true); break;
      case 'invite': openDlg(`<h2>Invite someone</h2><form data-form="invite" style="display:grid;gap:12px"><label>Name<input name="name" required maxlength="60"></label><label>Email (for reminders)<input name="email" type="email"></label>
        <label>Role<select name="role"><option value="family">Family: can view and help</option>${S.me.role === 'elder' ? '<option value="caretaker">Caretaker: manages day to day</option>' : ''}</select></label>
        <div class="row"><button class="primary grow" type="submit">Create passcode</button><button type="button" class="grow" data-act="close">Cancel</button></div></form>`); break;
      case 'reset': confirmDlg('Make a new passcode?', 'The old passcode stops working and they are signed out.', 'Make new passcode', async () => { try { const r = await api('POST', `/api/members/${d.id}/reset`); passDlg('New passcode', { items: [{ name: r.name, role: S.members.find(m => m.id === d.id).role, passcode: r.passcode }] }); } catch (e) { fail(e); } }); break;
      case 'remove': confirmDlg('Remove from the circle?', S.members.find(m => m.id === d.id).name + ' will be signed out immediately.', 'Remove', async () => { try { await api('DELETE', `/api/members/${d.id}`); await load(); toast('Removed'); } catch (e) { fail(e); } }, true); break;
      case 'delnote': await api('DELETE', `/api/notes/${d.id}`); await load(); break;
      case 'testmail': { const r = await api('POST', '/api/test-email'); await load(); toast(r.mode === 'demo' ? 'Demo mode: see the Email outbox' : 'Test email sent'); break; }
      case 'cardform': cf = JSON.parse(JSON.stringify(S.circle.emergency)); openDlg(cardFormHtml()); break;
    }
  } catch (e) { fail(e); }
});

document.addEventListener('submit', async ev => {
  const f = ev.target.closest('[data-form]'); if (!f) return; ev.preventDefault();
  const fd = new FormData(f), v = Object.fromEntries(fd.entries()), kind = f.dataset.form;
  try {
    if (kind === 'login') { const r = await api('POST', '/api/login', v); token = r.token; ls.set('ec_token', token); ls.set('ec_code', v.code.toUpperCase()); ls.del('ec_simple'); await load(); startPolling(); }
    else if (kind === 'create') {
      const r = await api('POST', '/api/circles', { ...v, setupBy: window.setupBy || 'other' }); token = r.token; ls.set('ec_token', token); ls.set('ec_code', r.code); ls.del('ec_simple'); await load(); startPolling();
      passDlg('Your care circle is ready', { code: r.code, items: r.passcodes });
    }
    else if (kind === 'med') {
      readMedForm(); const body = { ...mf, days: mf.days };
      if (editId) await submitChange('PUT', `/api/meds/${editId}`, body, 'Saved'); else await submitChange('POST', '/api/meds', body, 'Medicine added');
    }
    else if (kind === 'appt') { const body = { ...v, needsRide: fd.has('needsRide') }; if (editId) await submitChange('PUT', `/api/appts/${editId}`, body, 'Saved'); else await submitChange('POST', '/api/appts', body, 'Appointment added'); }
    else if (kind === 'prefs') { const prefs = {}; for (const k of ['upcoming', 'missed', 'appts', 'lowStock', 'digest', 'checkin']) prefs[k] = fd.has(k); await api('PUT', `/api/members/${S.me.id}/prefs`, { email: v.email, prefs }); await load(); toast('Saved'); }
    else if (kind === 'settings') { await api('PUT', '/api/settings', { ...v, caretakerApproves: fd.has('caretakerApproves'), familySeesHealth: fd.has('familySeesHealth') }); await load(); toast('Rules saved'); }
    else if (kind === 'note') { await api('POST', '/api/notes', { text: v.text, kind: fd.has('symptom') ? 'symptom' : 'note' }); await load(); toast(fd.has('symptom') ? 'Posted. Caretakers and family were alerted.' : 'Posted'); }
    else if (kind === 'invite') { const r = await api('POST', '/api/members', v); await load(true); passDlg(`Passcode for ${r.name}`, { items: [r] }); }
    else if (kind === 'card') { await api('PUT', '/api/emergency', { bloodGroup: v.bloodGroup, allergies: v.allergies, conditions: v.conditions, notes: v.notes, doctors: parseLines(v.doctors), contacts: parseLines(v.contacts) }); closeDlg(); await load(); toast('Health card saved'); }
  } catch (e) { fail(e); }
});

/* ── boot ── */
if (token) { load().then(() => { if (S) startPolling(); }); } else render();
