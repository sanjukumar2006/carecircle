'use strict';
/*
  CareCircle — a shared medication & appointment platform for an elderly person,
  their caretakers and family. Zero required dependencies (nodemailer is optional:
  without SMTP settings, emails are recorded in the in-app Outbox as "demo").
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) { /* optional */ }

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
const PUBLIC = path.join(__dirname, 'public');

/* ───────────────────────── storage ───────────────────────── */
let db = { circles: {}, sessions: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { /* first run */ }
db.circles = db.circles || {}; db.sessions = db.sessions || {};
function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}

/* ───────────────────────── helpers ───────────────────────── */
const uid = (n = 6) => crypto.randomBytes(n).toString('hex');
const WORDS = ['maple','river','sunny','cedar','amber','lotus','pearl','coral','olive','honey','daisy','mango',
  'tulip','robin','cloud','brook','sandy','lemon','peach','willow','jasmine','garden','breeze','meadow',
  'orchid','pepper','saffron','silver','velvet','walnut','almond','cotton','ginger','harbor','island','jungle',
  'kitten','lilac','marble','nectar','oasis','petal','quilt','rocket','spring','thistle','umber','violet'];
function makePasscode() { return WORDS[crypto.randomInt(WORDS.length)] + '-' + String(crypto.randomInt(10000)).padStart(4, '0'); }
function makeCode() { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += A[crypto.randomInt(A.length)]; return s; }
function hashPass(p) { const salt = crypto.randomBytes(12).toString('hex'); return salt + ':' + crypto.scryptSync(normPass(p), salt, 32).toString('hex'); }
function checkPass(p, h) {
  const [salt, hex] = h.split(':');
  const a = crypto.scryptSync(normPass(p), salt, 32), b = Buffer.from(hex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const normPass = p => String(p || '').trim().toLowerCase().replace(/\s+/g, '');
const clean = (s, n = 200) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z'));
const isTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s || '');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Times: everything is evaluated on the elder's own wall clock ("naive local" minutes). */
function nowLocal(tz, d = new Date()) {
  const o = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach(p => { o[p.type] = p.value; });
  const date = `${o.year}-${o.month}-${o.day}`;
  return { date, min: +o.hour * 60 + +o.minute, epoch: Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute) / 60000 };
}
function naive(date, time) { const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return Date.UTC(y, m - 1, d, h, mi) / 60000; }
function addDays(date, n) { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
const dow = date => new Date(date + 'T00:00:00Z').getUTCDay();
const fmtTime = t => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const fmtDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/* ───────────────────────── model ───────────────────────── */
const DEFAULT_SETTINGS = {
  graceMin: 60,            // minutes after a dose is due before it counts as missed
  leadMin: 15,             // minutes before a dose to send the "coming up" email
  familyMode: 'propose',   // direct | propose | view
  caretakerMode: 'direct', // direct | propose
  caretakerApproves: true, // caretakers may approve family proposals
  familySeesHealth: true,  // elder controls whether family can see dose history & notes
  checkinDeadline: '11:00',
  digestTime: '20:00',
  lowStockDays: 5,
};
const DEFAULT_PREFS = {
  elder:     { upcoming: true,  missed: true,  appts: true,  lowStock: false, digest: false, checkin: false },
  caretaker: { upcoming: false, missed: true,  appts: true,  lowStock: true,  digest: true,  checkin: true },
  family:    { upcoming: false, missed: true,  appts: true,  lowStock: false, digest: true,  checkin: true },
};
function newMember(name, role, email) {
  const passcode = makePasscode();
  return { member: { id: uid(4), name: clean(name, 60), role, email: isEmail(email) ? email : '', passHash: hashPass(passcode), prefs: { ...DEFAULT_PREFS[role] }, createdAt: new Date().toISOString() }, passcode };
}
function modeFor(c, m) {
  if (m.role === 'elder') return 'direct';
  if (m.role === 'caretaker') return c.settings.caretakerMode === 'propose' ? 'propose' : 'direct';
  return c.settings.familyMode === 'direct' ? 'direct' : c.settings.familyMode === 'view' ? 'none' : 'propose';
}
const canManage = m => m.role === 'elder' || m.role === 'caretaker';
function log(c, who, text) { c.activity.unshift({ at: new Date().toISOString(), who, text }); c.activity.length = Math.min(c.activity.length, 150); }

function sanitizeMed(p, c, existing) {
  const out = existing ? { ...existing } : { id: uid(4), createdAt: new Date().toISOString() };
  const name = clean(p.name, 80); if (!name) throw httpErr(400, 'Medicine name is required');
  const times = [...new Set((Array.isArray(p.times) ? p.times : []).filter(isTime))].sort();
  if (!times.length) throw httpErr(400, 'Add at least one valid time of day (for example 08:00)');
  out.name = name; out.dose = clean(p.dose, 60); out.form = clean(p.form, 30);
  out.times = times.slice(0, 8);
  out.days = [...new Set((Array.isArray(p.days) ? p.days : []).map(Number).filter(n => n >= 0 && n <= 6))].sort();
  out.startDate = isDate(p.startDate) ? p.startDate : (out.startDate || nowLocal(c.timezone).date);
  out.endDate = isDate(p.endDate) ? p.endDate : null;
  out.instructions = clean(p.instructions, 200); out.purpose = clean(p.purpose, 100);
  out.stock = p.stock === '' || p.stock == null ? null : Math.max(0, Math.floor(Number(p.stock)) || 0);
  out.perDose = Math.min(20, Math.max(0.25, Number(p.perDose) || 1));
  out.minGapHours = Math.min(24, Math.max(0, p.minGapHours === '' || p.minGapHours == null ? 3 : Number(p.minGapHours) || 0));
  out.paused = !!p.paused;
  return out;
}
function sanitizeAppt(p, c, existing) {
  const out = existing ? { ...existing } : { id: uid(4), volunteers: [], createdAt: new Date().toISOString() };
  const title = clean(p.title, 100); if (!title) throw httpErr(400, 'Give the appointment a title');
  if (!isDate(p.date) || !isTime(p.time)) throw httpErr(400, 'Pick a valid date and time');
  out.title = title; out.doctor = clean(p.doctor, 80); out.place = clean(p.place, 120);
  out.date = p.date; out.time = p.time; out.notes = clean(p.notes, 400);
  out.questions = clean(p.questions, 400); out.needsRide = !!p.needsRide;
  return out;
}
function httpErr(status, message, extra) { const e = new Error(message); e.status = status; e.extra = extra; return e; }

function describe(type, p, c) {
  const med = p.targetId && c.meds.find(m => m.id === p.targetId), ap = p.targetId && c.appts.find(a => a.id === p.targetId);
  switch (type) {
    case 'med.create': return `Add medicine ${clean(p.name, 80)} ${clean(p.dose, 60)} at ${(p.times || []).map(t => isTime(t) ? fmtTime(t) : '').join(', ')}`;
    case 'med.update': return `Change medicine ${med ? med.name : ''} → ${clean(p.name, 80)} ${clean(p.dose, 60)} at ${(p.times || []).map(t => isTime(t) ? fmtTime(t) : '').join(', ')}`;
    case 'med.delete': return `Remove medicine ${med ? med.name : ''}`;
    case 'appt.create': return `Add appointment “${clean(p.title, 100)}” on ${p.date} at ${isTime(p.time) ? fmtTime(p.time) : ''}`;
    case 'appt.update': return `Change appointment “${ap ? ap.title : ''}” → ${p.date} ${isTime(p.time) ? fmtTime(p.time) : ''}`;
    case 'appt.delete': return `Cancel appointment “${ap ? ap.title : ''}”`;
  }
  return type;
}
function applyAction(c, type, p, who) {
  switch (type) {
    case 'med.create': { const m = sanitizeMed(p, c); c.meds.push(m); log(c, who, `added medicine ${m.name}`); return; }
    case 'med.update': { const i = c.meds.findIndex(m => m.id === p.targetId); if (i < 0) throw httpErr(404, 'Medicine not found'); c.meds[i] = sanitizeMed(p, c, c.meds[i]); log(c, who, `updated ${c.meds[i].name}`); return; }
    case 'med.delete': { const m = c.meds.find(m => m.id === p.targetId); if (!m) throw httpErr(404, 'Medicine not found'); c.meds = c.meds.filter(x => x !== m); log(c, who, `removed medicine ${m.name}`); return; }
    case 'appt.create': { const a = sanitizeAppt(p, c); c.appts.push(a); log(c, who, `added appointment ${a.title}`); return; }
    case 'appt.update': { const i = c.appts.findIndex(a => a.id === p.targetId); if (i < 0) throw httpErr(404, 'Appointment not found'); c.appts[i] = sanitizeAppt(p, c, c.appts[i]); log(c, who, `updated appointment ${c.appts[i].title}`); return; }
    case 'appt.delete': { const a = c.appts.find(a => a.id === p.targetId); if (!a) throw httpErr(404, 'Appointment not found'); c.appts = c.appts.filter(x => x !== a); log(c, who, `cancelled appointment ${a.title}`); return; }
  }
  throw httpErr(400, 'Unknown action');
}

/* ───────────────────────── schedule & adherence ───────────────────────── */
function medActiveOn(m, date) {
  if (m.paused) return false;
  if (m.startDate > date) return false;
  if (m.endDate && m.endDate < date) return false;
  return !m.days.length || m.days.includes(dow(date));
}
function dosesOn(c, date) {
  const out = [];
  for (const m of c.meds) if (medActiveOn(m, date)) for (const t of m.times) out.push({ key: `${m.id}|${date}|${t}`, med: m, date, time: t });
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.med.name.localeCompare(b.med.name));
}
function doseStatus(c, d, now) {
  const l = c.logs[d.key], due = naive(d.date, d.time);
  if (l && l.status !== 'missed') return l.status;                          // taken | skipped
  if (now.epoch >= due + c.settings.graceMin) return 'missed';
  if (now.epoch >= due - c.settings.leadMin) return 'due';
  return 'upcoming';
}
function adherence(c, now) {
  const week = []; let streak = 0, streakOpen = true, tTaken = 0, tPast = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(now.date, -i), ds = dosesOn(c, date);
    const r = { date, scheduled: ds.length, taken: 0, skipped: 0, missed: 0, pending: 0 };
    for (const d of ds) { const s = doseStatus(c, d, now); if (s === 'taken') r.taken++; else if (s === 'skipped') r.skipped++; else if (s === 'missed') r.missed++; else r.pending++; }
    week.unshift(r);
    const past = r.scheduled - r.pending;
    tTaken += r.taken; tPast += past;
    if (streakOpen) { if (past === 0) { if (i > 0 && r.scheduled === 0) { /* rest day keeps the streak */ } } else if (r.taken === past) streak++; else streakOpen = false; }
  }
  return { week, streak, pct: tPast ? Math.round(tTaken / tPast * 100) : null };
}

/* ───────────────────────── email ───────────────────────── */
const smtp = nodemailer && process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 587, secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
}) : null;
const mailMode = () => smtp ? 'smtp' : 'demo';
async function sendMail(c, recipients, subject, lines, kind) {
  const list = recipients.filter(m => isEmail(m.email));
  if (!list.length) return 0;
  const body = Array.isArray(lines) ? lines : [lines];
  const text = body.join('\n') + `\n\n— CareCircle for ${c.elderName}\nOpen the app: ${APP_URL}  (circle code ${c.code})`;
  const html = `<div style="font:16px/1.5 Arial,sans-serif;color:#1a2b2a;max-width:520px"><h2 style="margin:0 0 12px;color:#0b6e69">${esc(subject)}</h2>${body.map(l => `<p style="margin:0 0 10px">${esc(l)}</p>`).join('')}<p style="margin-top:20px;color:#5b6b6a;font-size:14px">CareCircle for ${esc(c.elderName)} · <a href="${esc(APP_URL)}">Open the app</a> · circle code ${esc(c.code)}</p></div>`;
  for (const m of list) {
    const rec = { id: uid(4), at: new Date().toISOString(), to: m.email, toName: m.name, subject, kind, body: body.join(' '), status: 'demo' };
    if (smtp) {
      try { await smtp.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: m.email, subject, text, html }); rec.status = 'sent'; }
      catch (e) { rec.status = 'failed'; rec.error = String(e.message).slice(0, 120); }
    }
    c.outbox.unshift(rec); c.outbox.length = Math.min(c.outbox.length, 120);
  }
  return list.length;
}
const wants = (c, pref, extra) => c.members.filter(m => m.prefs[pref] && (!extra || extra(m)));

/* ───────────────────────── reminder engine ───────────────────────── */
async function tickCircle(c, d = new Date()) {
  const now = nowLocal(c.timezone, d); let dirty = false;
  const once = key => { if (c.sent[key]) return false; c.sent[key] = now.date; dirty = true; return true; };
  const elder = c.elderName;

  for (const date of [addDays(now.date, -1), now.date]) {
    for (const ds of dosesOn(c, date)) {
      const due = naive(date, ds.time), l = c.logs[ds.key];
      if (l && l.status !== 'missed') continue;
      const label = `${ds.med.name}${ds.med.dose ? ' ' + ds.med.dose : ''}`;
      if (now.epoch >= due - c.settings.leadMin && now.epoch < due + c.settings.graceMin && once('up|' + ds.key)) {
        await sendMail(c, wants(c, 'upcoming'), `Time for ${ds.med.name} at ${fmtTime(ds.time)}`,
          [`${elder}, it's almost time for ${label}.`, ds.med.instructions ? `Remember: ${ds.med.instructions}` : '', `Open the app and tap “I took it” afterwards.`].filter(Boolean), 'upcoming');
      }
      if (now.epoch >= due + c.settings.graceMin) {
        if (!l) { c.logs[ds.key] = { status: 'missed', at: new Date().toISOString(), by: 'system', auto: true }; dirty = true; log(c, 'System', `${label} at ${fmtTime(ds.time)} was not recorded (missed)`); }
        if (once('miss|' + ds.key)) {
          const missed7 = adherence(c, now).week.reduce((s, w) => s + w.missed, 0);
          await sendMail(c, wants(c, 'missed'), `Missed dose: ${elder} — ${ds.med.name}`,
            [`${label} scheduled for ${fmtTime(ds.time)} on ${fmtDate(date)} has not been marked as taken.`,
             `Please check in with ${elder}. Missed doses in the last 7 days: ${missed7}.`,
             'If it was taken, open the app and mark it so everyone stays informed.'], 'missed');
        }
      }
    }
  }

  // refill forecast (once a day)
  for (const m of c.meds) {
    if (m.stock == null || m.paused) continue;
    const perDay = m.times.length * m.perDose * (m.days.length ? m.days.length / 7 : 1);
    const daysLeft = perDay ? m.stock / perDay : 99;
    if (daysLeft <= c.settings.lowStockDays && now.min >= 9 * 60 && once(`stock|${m.id}|${now.date}`))
      await sendMail(c, wants(c, 'lowStock'), `Refill soon: ${m.name}`, [`${m.name} will run out in about ${Math.max(0, Math.floor(daysLeft))} day(s) (${m.stock} left).`, 'Please arrange a refill.'], 'stock');
  }

  // appointments
  for (const a of c.appts) {
    const at = naive(a.date, a.time), left = at - now.epoch;
    if (left < 0) continue;
    const when = `${a.title}${a.doctor ? ' with ' + a.doctor : ''} on ${fmtDate(a.date)} at ${fmtTime(a.time)}${a.place ? ', ' + a.place : ''}`;
    const who = a.volunteers.length ? `Going with ${elder}: ${a.volunteers.map(v => v.name).join(', ')}.` : 'Nobody has said they will go along yet.';
    if (left <= 1440 && once(`ap24|${a.id}`)) await sendMail(c, wants(c, 'appts'), `Tomorrow: ${a.title}`, [`Reminder: ${when}.`, who, a.questions ? `Questions to ask: ${a.questions}` : ''].filter(Boolean), 'appointment');
    if (left <= 120 && once(`ap2|${a.id}`)) await sendMail(c, wants(c, 'appts'), `In 2 hours: ${a.title}`, [`${when}.`, who, a.notes ? `Notes: ${a.notes}` : ''].filter(Boolean), 'appointment');
    if (a.needsRide && !a.volunteers.length && left <= 4320 && once(`ride|${a.id}`))
      await sendMail(c, c.members.filter(m => m.role !== 'elder' && m.prefs.appts), `Can someone go with ${elder}?`, [`${when} still needs someone to accompany ${elder}.`, 'Open the app and tap “I’ll go along” on the appointment.'], 'ride');
  }

  // daily check-in (elder's "I'm okay" tap)
  const ci = c.checkins[now.date];
  if (!ci && now.min >= (c.settings.checkinDeadline.split(':')[0] * 60 + +c.settings.checkinDeadline.split(':')[1]) && once('ci|' + now.date))
    await sendMail(c, wants(c, 'checkin'), `${elder} hasn't checked in today`, [`${elder} has not tapped “I'm okay” today (expected by ${fmtTime(c.settings.checkinDeadline)}).`, 'A quick call might be a good idea.'], 'checkin');

  // evening digest
  const dt = c.settings.digestTime.split(':');
  if (now.min >= +dt[0] * 60 + +dt[1] && once('dg|' + now.date)) {
    const ds = dosesOn(c, now.date), st = ds.map(x => ({ x, s: doseStatus(c, x, now) }));
    const taken = st.filter(s => s.s === 'taken').length, missed = st.filter(s => s.s === 'missed'), later = st.filter(s => s.s === 'upcoming' || s.s === 'due').length;
    const next = c.appts.filter(a => naive(a.date, a.time) > now.epoch).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
    await sendMail(c, wants(c, 'digest'), `Today for ${elder}: ${taken}/${ds.length} doses taken`, [
      `${taken} of ${ds.length} doses taken today.${missed.length ? ' Missed: ' + missed.map(s => `${s.x.med.name} ${fmtTime(s.x.time)}`).join(', ') + '.' : ' Nothing missed.'}${later ? ` ${later} still to come.` : ''}`,
      ci ? `Check-in: ${ci.feeling} at ${ci.by}.` : 'No check-in today.',
      next ? `Next appointment: ${next.title} on ${fmtDate(next.date)} at ${fmtTime(next.time)}.` : 'No upcoming appointments.'], 'digest');
  }

  // forget old dedupe keys
  const cutoff = addDays(now.date, -10);
  for (const k of Object.keys(c.sent)) if (c.sent[k] < cutoff) { delete c.sent[k]; dirty = true; }
  if (dirty) save();
}
async function tick(d) { for (const c of Object.values(db.circles)) { try { await tickCircle(c, d); } catch (e) { console.error('tick', c.code, e.message); } } }

/* ───────────────────────── views ───────────────────────── */
function stateFor(c, me) {
  const now = nowLocal(c.timezone), manage = canManage(me);
  const hideHealth = me.role === 'family' && !c.settings.familySeesHealth;
  const today = dosesOn(c, now.date).map(d => {
    const l = c.logs[d.key], status = doseStatus(c, d, now);
    return { key: d.key, medId: d.med.id, name: d.med.name, dose: d.med.dose, form: d.med.form, instructions: d.med.instructions, purpose: d.med.purpose, time: d.time,
      status: hideHealth && status !== 'upcoming' ? 'hidden' : status, takenAt: l && l.at, by: l && l.by, late: !!(l && l.late), minsUntil: naive(d.date, d.time) - now.epoch };
  });
  const adh = adherence(c, now);
  const lowStock = c.meds.filter(m => m.stock != null && !m.paused).map(m => {
    const perDay = m.times.length * m.perDose * (m.days.length ? m.days.length / 7 : 1); return { medId: m.id, name: m.name, stock: m.stock, daysLeft: perDay ? Math.floor(m.stock / perDay) : 99 };
  }).filter(x => x.daysLeft <= c.settings.lowStockDays);
  return {
    me: { id: me.id, name: me.name, role: me.role, email: me.email, prefs: me.prefs, mode: modeFor(c, me) },
    circle: { code: c.code, elderName: c.elderName, timezone: c.timezone, settings: c.settings, emergency: c.emergency },
    mail: mailMode(), now,
    members: c.members.map(m => ({ id: m.id, name: m.name, role: m.role, email: manage || m.id === me.id ? m.email : '', prefs: manage || m.id === me.id ? m.prefs : undefined })),
    meds: c.meds, today,
    appts: c.appts.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
    week: hideHealth ? [] : adh.week, streak: hideHealth ? 0 : adh.streak, pct: hideHealth ? null : adh.pct, lowStock: hideHealth ? [] : lowStock,
    proposals: c.proposals.filter(p => p.status === 'pending'),
    notes: hideHealth ? [] : c.notes.slice(0, 60), activity: hideHealth ? [] : c.activity.slice(0, 50),
    checkin: c.checkins[now.date] || null, hideHealth,
    outbox: manage ? c.outbox.slice(0, 40) : [],
  };
}

/* ───────────────────────── API ───────────────────────── */
const routes = [];
const route = (method, pattern, auth, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), auth, fn });
const need = (cond, msg = 'Not allowed') => { if (!cond) throw httpErr(403, msg); };

route('POST', '/api/circles', false, async ({ body, ip }) => {
  const elderName = clean(body.elderName, 60), yourName = clean(body.yourName, 60) || elderName;
  if (!elderName) throw httpErr(400, 'Enter the name of the person being cared for');
  const tz = clean(body.timezone, 60) || 'Asia/Kolkata';
  try { nowLocal(tz); } catch (e) { throw httpErr(400, 'Unknown time zone'); }
  let code; do { code = makeCode(); } while (db.circles[code]);
  const c = { code, elderName, timezone: tz, createdAt: new Date().toISOString(), settings: { ...DEFAULT_SETTINGS }, members: [], meds: [], appts: [], logs: {}, notes: [], activity: [], proposals: [], outbox: [], sent: {}, checkins: {},
    emergency: { bloodGroup: '', conditions: '', allergies: '', doctors: [], contacts: [], notes: '' } };
  const passes = [];
  const forSelf = body.setupBy !== 'other';
  const e = newMember(elderName, 'elder', forSelf ? body.yourEmail : body.elderEmail); c.members.push(e.member); passes.push({ id: e.member.id, name: e.member.name, role: 'elder', passcode: e.passcode });
  let creator = e;
  if (!forSelf) { creator = newMember(yourName, 'caretaker', body.yourEmail); c.members.push(creator.member); passes.push({ id: creator.member.id, name: creator.member.name, role: 'caretaker', passcode: creator.passcode }); }
  log(c, creator.member.name, `created the care circle for ${elderName}`);
  db.circles[code] = c;
  const token = newSession(code, creator.member.id); save();
  return { code, token, passcodes: passes };
});

const fails = {};
route('POST', '/api/login', false, async ({ body, ip }) => {
  for (const k of Object.keys(fails)) if (fails[k].until && fails[k].until < Date.now()) delete fails[k];
  const code = clean(body.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, ''), key = ip + '|' + code, f = fails[key] || { n: 0, until: 0 };
  if (f.until > Date.now()) throw httpErr(429, 'Too many tries. Please wait a few minutes and try again.');
  const c = db.circles[code]; let hit = null;
  if (c) hit = c.members.find(m => checkPass(body.passcode, m.passHash));
  else crypto.scryptSync('x', 'y', 32);
  if (!hit) { f.n++; if (f.n >= 6) { f.until = Date.now() + 10 * 60000; f.n = 0; } fails[key] = f; throw httpErr(401, 'That circle code or passcode doesn’t match. Check them and try again.'); }
  delete fails[key];
  return { token: newSession(code, hit.id), role: hit.role };
});
function newSession(code, memberId) {
  const t = crypto.randomBytes(24).toString('hex'), now = Date.now();
  for (const [k, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[k];
  db.sessions[crypto.createHash('sha256').update(t).digest('hex')] = { code, memberId, exp: now + 30 * 864e5 }; save(); return t;
}
route('POST', '/api/logout', true, async ({ token }) => { delete db.sessions[crypto.createHash('sha256').update(token).digest('hex')]; save(); return { ok: true }; });
route('GET', '/api/state', true, async ({ c, me }) => stateFor(c, me));

/* medicines & appointments (direct or proposed) */
for (const kind of ['med', 'appt']) {
  const plural = kind === 'med' ? 'meds' : 'appts';
  for (const [method, pat, op] of [['POST', `/api/${plural}`, 'create'], ['PUT', `/api/${plural}/:id`, 'update'], ['DELETE', `/api/${plural}/:id`, 'delete']]) {
    route(method, pat, true, async ({ c, me, body, params }) => {
      const mode = modeFor(c, me); need(mode !== 'none', 'The care circle owner has set your access to view-only');
      const type = `${kind}.${op}`, p = { ...body, targetId: params.id };
      if (op !== 'create' && !(c[plural].some(x => x.id === params.id))) throw httpErr(404, 'Not found');
      if (op !== 'delete') (kind === 'med' ? sanitizeMed : sanitizeAppt)(p, c, op === 'update' ? c[plural].find(x => x.id === params.id) : null); // validate early
      if (mode === 'direct') { applyAction(c, type, p, me.name); save(); return { applied: true }; }
      c.proposals.unshift({ id: uid(4), type, payload: p, summary: describe(type, p, c), by: me.id, byName: me.name, at: new Date().toISOString(), status: 'pending' });
      log(c, me.name, `suggested a change: ${describe(type, p, c)}`); save();
      const approvers = c.members.filter(m => m.role === 'elder' && m.email);
      sendMail(c, approvers, `${me.name} suggested a change`, [`${me.name} suggested: ${describe(type, p, c)}.`, 'Open the app to approve or decline it.'], 'proposal').then(save);
      return { applied: false, proposed: true };
    });
  }
}
route('POST', '/api/proposals/:id/:verb', true, async ({ c, me, params }) => {
  need(me.role === 'elder' || (me.role === 'caretaker' && c.settings.caretakerApproves), 'Only the elder (or a trusted caretaker) can decide');
  const p = c.proposals.find(x => x.id === params.id && x.status === 'pending'); if (!p) throw httpErr(404, 'Already handled');
  if (params.verb === 'approve') { applyAction(c, p.type, p.payload, `${p.byName} (approved by ${me.name})`); p.status = 'approved'; }
  else if (params.verb === 'reject') { p.status = 'rejected'; log(c, me.name, `declined ${p.byName}'s suggestion: ${p.summary}`); }
  else throw httpErr(400, 'Unknown');
  p.decidedBy = me.name; save();
  const sug = c.members.find(m => m.id === p.by);
  if (sug) sendMail(c, [sug], `Your suggestion was ${p.status}`, [`${me.name} ${p.status} your suggestion: ${p.summary}.`], 'proposal').then(save);
  return { ok: true };
});
route('POST', '/api/appts/:id/volunteer', true, async ({ c, me, params }) => {
  const a = c.appts.find(x => x.id === params.id); if (!a) throw httpErr(404, 'Not found');
  const i = a.volunteers.findIndex(v => v.id === me.id);
  if (i >= 0) { a.volunteers.splice(i, 1); log(c, me.name, `can no longer go to ${a.title}`); } else { a.volunteers.push({ id: me.id, name: me.name }); log(c, me.name, `will go with ${c.elderName} to ${a.title}`); }
  save(); return { ok: true };
});

/* doses */
route('POST', '/api/dose', true, async ({ c, me, body }) => {
  need(modeFor(c, me) !== 'none', 'View-only access');
  const [medId, date, time] = String(body.key || '').split('|'), med = c.meds.find(m => m.id === medId), now = nowLocal(c.timezone);
  if (!med || !isDate(date) || !isTime(time) || !dosesOn(c, date).some(d => d.key === body.key)) throw httpErr(404, 'That dose is not on the schedule');
  if (date > now.date) throw httpErr(400, 'That dose is in the future');
  const prev = c.logs[body.key], label = `${med.name} at ${fmtTime(time)}`;
  if (body.status === 'undo') { if (prev && prev.status === 'taken' && med.stock != null) med.stock += med.perDose; delete c.logs[body.key]; log(c, me.name, `undid ${label}`); save(); return { ok: true }; }
  if (!['taken', 'skipped'].includes(body.status)) throw httpErr(400, 'Bad status');
  const wasTaken = !!(prev && prev.status === 'taken');
  if (body.status === 'taken' && !wasTaken) {
    const recent = Object.entries(c.logs).find(([k, l]) => k.startsWith(medId + '|') && l.status === 'taken' && l.epoch && now.epoch - l.epoch < med.minGapHours * 60 && now.epoch >= l.epoch);
    if (recent && !body.confirm) throw httpErr(409, `${med.name} was already taken ${Math.max(1, Math.round((now.epoch - recent[1].epoch)))} minutes ago. Taking another dose this soon may be unsafe.`, { needsConfirm: true });
    if (med.stock != null) med.stock = Math.max(0, med.stock - med.perDose);
  } else if (body.status === 'skipped' && wasTaken && med.stock != null) {
    med.stock += med.perDose;                                // un-taking a dose returns the tablets
  }
  const due = naive(date, time);
  c.logs[body.key] = { status: body.status, at: new Date().toISOString(), epoch: now.epoch, by: me.name, note: clean(body.note, 120), late: body.status === 'taken' && now.epoch > due + c.settings.graceMin };
  log(c, me.name, `${body.status === 'taken' ? 'marked as taken' : 'skipped'}: ${label}${me.role !== 'elder' ? ' (on behalf of ' + c.elderName + ')' : ''}`);
  save(); return { ok: true };
});

/* check-in, notes */
route('POST', '/api/checkin', true, async ({ c, me, body }) => {
  const feeling = ['Great', 'Okay', 'Not well'].includes(body.feeling) ? body.feeling : 'Okay', now = nowLocal(c.timezone);
  c.checkins[now.date] = { feeling, by: me.name, at: new Date().toISOString() };
  for (const k of Object.keys(c.checkins)) if (k < addDays(now.date, -30)) delete c.checkins[k];
  log(c, me.name, `checked in: ${feeling}`); save();
  if (feeling === 'Not well') sendMail(c, c.members.filter(m => m.role !== 'elder' && m.prefs.checkin), `${c.elderName} is not feeling well`, [`${me.name} reported “Not well” today. Please get in touch.`], 'checkin').then(save);
  return { ok: true };
});
route('POST', '/api/notes', true, async ({ c, me, body }) => {
  const text = clean(body.text, 500); if (!text) throw httpErr(400, 'Write something first');
  c.notes.unshift({ id: uid(4), at: new Date().toISOString(), by: me.name, role: me.role, text, kind: body.kind === 'symptom' ? 'symptom' : 'note' });
  c.notes.length = Math.min(c.notes.length, 200); save();
  if (body.kind === 'symptom') sendMail(c, c.members.filter(m => m.id !== me.id && m.role !== 'elder' && m.prefs.checkin), `Symptom noted for ${c.elderName}`, [`${me.name}: ${text}`], 'note').then(save);
  return { ok: true };
});
route('DELETE', '/api/notes/:id', true, async ({ c, me, params }) => {
  const n = c.notes.find(x => x.id === params.id); if (!n) throw httpErr(404, 'Not found');
  need(n.by === me.name || me.role === 'elder', 'You can only remove your own notes'); c.notes = c.notes.filter(x => x !== n); save(); return { ok: true };
});

/* people, preferences, settings, emergency card */
route('POST', '/api/members', true, async ({ c, me, body }) => {
  need(canManage(me)); const role = ['caretaker', 'family'].includes(body.role) ? body.role : 'family';
  need(role === 'family' || me.role === 'elder', 'Only the elder can add a caretaker');
  const name = clean(body.name, 60); if (!name) throw httpErr(400, 'Enter a name');
  if (c.members.length >= 25) throw httpErr(400, 'Circle is full');
  const nm = newMember(name, role, body.email); c.members.push(nm.member); log(c, me.name, `invited ${nm.member.name} as ${role}`); save();
  return { id: nm.member.id, name: nm.member.name, role, passcode: nm.passcode };
});
route('POST', '/api/members/:id/reset', true, async ({ c, me, params }) => {
  need(canManage(me)); const m = c.members.find(x => x.id === params.id); if (!m) throw httpErr(404, 'Not found');
  need(m.role !== 'elder' || me.role === 'elder', 'Only the elder can reset their own passcode');
  need(!(m.role === 'caretaker' && me.role !== 'elder'), 'Only the elder can reset a caretaker');
  const p = makePasscode(); m.passHash = hashPass(p);
  for (const [k, s] of Object.entries(db.sessions)) if (s.code === c.code && s.memberId === m.id) delete db.sessions[k];
  log(c, me.name, `reset the passcode for ${m.name}`); save(); return { name: m.name, passcode: p };
});
route('DELETE', '/api/members/:id', true, async ({ c, me, params }) => {
  need(me.role === 'elder', 'Only the elder can remove people'); const m = c.members.find(x => x.id === params.id);
  if (!m || m.role === 'elder') throw httpErr(400, 'Cannot remove that person');
  c.members = c.members.filter(x => x !== m);
  for (const [k, s] of Object.entries(db.sessions)) if (s.code === c.code && s.memberId === m.id) delete db.sessions[k];
  log(c, me.name, `removed ${m.name} from the circle`); save(); return { ok: true };
});
route('PUT', '/api/members/:id/prefs', true, async ({ c, me, body, params }) => {
  const m = c.members.find(x => x.id === params.id); if (!m) throw httpErr(404, 'Not found');
  need(m.id === me.id || canManage(me));
  if (body.email !== undefined) { if (body.email && !isEmail(body.email)) throw httpErr(400, 'That email address doesn’t look right'); m.email = clean(body.email, 120); }
  for (const k of Object.keys(DEFAULT_PREFS.elder)) if (body.prefs && typeof body.prefs[k] === 'boolean') m.prefs[k] = body.prefs[k];
  save(); return { ok: true };
});
route('PUT', '/api/settings', true, async ({ c, me, body }) => {
  need(me.role === 'elder', 'Only the elder changes these settings'); const s = c.settings;
  if (['direct', 'propose', 'view'].includes(body.familyMode)) s.familyMode = body.familyMode;
  if (['direct', 'propose'].includes(body.caretakerMode)) s.caretakerMode = body.caretakerMode;
  for (const k of ['caretakerApproves', 'familySeesHealth']) if (typeof body[k] === 'boolean') s[k] = body[k];
  for (const k of ['checkinDeadline', 'digestTime']) if (isTime(body[k])) s[k] = body[k];
  for (const [k, lo, hi] of [['graceMin', 15, 240], ['leadMin', 0, 60], ['lowStockDays', 1, 30]]) if (body[k] !== undefined) s[k] = Math.min(hi, Math.max(lo, Math.floor(Number(body[k])) || s[k]));
  log(c, me.name, 'updated circle settings'); save(); return { ok: true };
});
route('PUT', '/api/emergency', true, async ({ c, me, body }) => {
  need(canManage(me)); const e = c.emergency;
  for (const k of ['bloodGroup', 'conditions', 'allergies', 'notes']) if (body[k] !== undefined) e[k] = clean(body[k], 400);
  for (const k of ['doctors', 'contacts']) if (Array.isArray(body[k])) e[k] = body[k].slice(0, 10).map(x => ({ name: clean(x.name, 60), phone: clean(x.phone, 30), detail: clean(x.detail, 60) })).filter(x => x.name);
  log(c, me.name, 'updated the health card'); save(); return { ok: true };
});
route('POST', '/api/test-email', true, async ({ c, me }) => {
  if (!isEmail(me.email)) throw httpErr(400, 'Add your email address first (Circle → My notifications)');
  await sendMail(c, [me], 'CareCircle test email', ['This is a test. If you can read this, reminders will reach you.'], 'test'); save();
  return { mode: mailMode() };
});

/* ───────────────────────── server ───────────────────────── */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
function readBody(req) {
  return new Promise((res, rej) => {
    let n = 0; const chunks = [];
    req.on('data', ch => { n += ch.length; if (n > 200000) { rej(httpErr(413, 'Too large')); req.destroy(); } else chunks.push(ch); });
    req.on('end', () => { try { res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch (e) { rej(httpErr(400, 'Bad JSON')); } });
  });
}
async function handler(req, res) {
  const u = new URL(req.url, 'http://x'), pathname = decodeURIComponent(u.pathname);
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:" };
  if (pathname === '/healthz') { res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
  if (pathname.startsWith('/api/')) {
    const json = (status, obj) => { res.writeHead(status, { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
    try {
      let matched = null;
      for (const r of routes) { if (r.method !== req.method) continue; const m = r.re.exec(pathname); if (m) { matched = { r, params: m.groups || {} }; break; } }
      if (!matched) return json(404, { error: 'Not found' });
      const ctx = { params: matched.params, ip: req.socket.remoteAddress || '', body: req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req) };
      if (matched.r.auth) {
        const token = (req.headers.authorization || '').replace(/^Bearer /, ''), s = db.sessions[crypto.createHash('sha256').update(token).digest('hex')];
        const c = s && s.exp > Date.now() && db.circles[s.code], me = c && c.members.find(m => m.id === s.memberId);
        if (!me) return json(401, { error: 'Please sign in again.' });
        Object.assign(ctx, { token, c, me });
      }
      return json(200, await matched.r.fn(ctx));
    } catch (e) { if (!e.status) console.error(e); return json(e.status || 500, { error: e.status ? e.message : 'Something went wrong', ...(e.extra || {}) }); }
  }
  const file = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, headers); return res.end('Not found'); }
    res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(buf);
  });
}
const server = http.createServer(handler);
module.exports = { server, tick, tickCircle, db, nowLocal, naive, addDays };
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`CareCircle running at ${APP_URL}  (email: ${mailMode()}${mailMode() === 'demo' ? ' — set SMTP_HOST etc. to send real email' : ''})`);
    setInterval(() => tick(), 30000); tick();
  });
}
