'use strict';
/* CareCircle helper chat — a small, self-contained assistant (no network calls, no dependencies).
   Answers how-to questions about the app, a few live questions from the signed-in user's own data
   ("when is my next dose?"), can open sections, and handles light small talk.
   It is rule-based, so it never invents medical advice. */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const st = () => (typeof S !== 'undefined' ? S : null);
  const signedIn = () => !!(typeof token !== 'undefined' && token && st());
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TABS = { today: 'Today', meds: 'Medicines', visits: 'Appointments', circle: 'Care circle', health: 'Health' };

  const live = {
    nextDose() {
      const s = st(); if (!s) return null;
      if (s.hideHealth) return 'Dose details are private in this circle.';
      const d = s.today.find(x => x.status === 'due' || x.status === 'upcoming');
      return d ? `Your next dose is ${d.name}${d.dose ? ' (' + d.dose + ')' : ''} at ${fmtTime(d.time)}${d.status === 'due' ? ', and it is due now.' : '.'}` : 'No more doses are due today.';
    },
    today() {
      const s = st(); if (!s) return null;
      if (s.hideHealth) return 'Dose details are private in this circle.';
      const t = s.today.length, done = s.today.filter(x => x.status === 'taken').length;
      return t ? `Today: ${done} of ${t} doses taken, ${s.today.filter(x => ['due', 'missed', 'upcoming'].includes(x.status)).length} still to go.` : 'No medicines are scheduled today.';
    },
    appt() {
      const s = st(); if (!s) return null;
      const a = s.appts.find(x => naive(x.date, x.time) >= nowEpoch());
      return a ? `Your next appointment is "${a.title}" on ${fmtDate(a.date)} at ${fmtTime(a.time)}${a.place ? ', ' + a.place : ''}.` : 'There are no upcoming appointments. You can add one under Appointments.';
    },
    me() { const s = st(); return s ? `You are signed in as ${s.me.name} (${{ elder: 'Elder', caretaker: 'Caretaker', family: 'Family' }[s.me.role]}) in ${s.circle.elderName}'s circle.` : null; },
    code() { const s = st(); return s ? `Your circle code is ${s.circle.code}. Passcodes are personal and are shown only once when created.` : null; },
    stock() {
      const s = st(); if (!s) return null;
      return s.lowStock.length ? 'Running low: ' + s.lowStock.map(l => `${l.name} (about ${l.daysLeft} day(s) left)`).join(', ') + '.' : 'No medicines are running low right now.';
    },
  };
  const needSignIn = 'Sign in first and I can look that up from your circle.';

  /* k = keyword fragments (any match scores; longer fragments score more). */
  const KB = [
    { k: ['hello', 'hi ', 'hey', 'good morning', 'good evening', 'namaste'], a: () => 'Hello! I am the CareCircle helper. Ask me how to do something, or about your day. Try “add a medicine” or “when is my next dose?”.' },
    { k: ['thank', 'thanks', 'great, ok'], a: () => 'You are welcome. I am here if you need anything else.' },
    { k: ['bye', 'goodbye'], a: () => 'Goodbye, take care!' },
    { k: ['who are you', 'what are you', 'your name', 'are you ai', 'are you a bot', 'are you human'], a: () => 'I am a simple built-in helper for CareCircle, not a person and not a doctor. I can explain how the app works and answer basic questions.' },
    { k: ['what can you do', 'help me', 'help', 'instructions', 'how to use', 'guide', 'get started', 'getting started'], a: () => 'I can explain: signing in, adding medicines, marking doses, appointments, inviting family, approvals, reminders, the health card and large text. I can also answer “next dose?”, “next appointment?”, and open a section for you.', chips: ['How do I add a medicine?', 'Next dose?', 'How do I invite family?'] },

    { k: ['sign in', 'log in', 'login', 'circle code', 'enter the app'], a: () => 'To sign in, enter your circle code and your own passcode on the first screen. Ask whoever set up the circle if you do not have them.' },
    { k: ['create a circle', 'start a circle', 'new circle', 'set up', 'sign up', 'register', 'start a care circle'], a: () => 'Choose “Start a care circle” on the sign-in screen, enter the name of the person being cared for, and press Create circle. You get a circle code and one passcode per person. Write them down, they are shown only once.' },
    { k: ['forgot', 'lost passcode', 'new passcode', 'reset passcode', 'passcode'], a: () => 'Passcodes are stored hashed, so they cannot be shown again. Ask the elder or a caretaker to open Care circle, find your name and press “New passcode”.' },
    { k: ['locked', 'lockout', 'too many'], a: () => 'After several wrong tries sign-in locks for 10 minutes. Wait, then try again with the right code and passcode.' },
    { k: ['sign out', 'log out', 'logout'], a: () => 'Use the Sign out button in the sidebar (or the top bar on a phone).', },

    { k: ['add a medicine', 'add medicine', 'new medicine', 'add a tablet', 'add pill', 'schedule a medicine', 'add medication'], a: () => 'Open Medicines, press “Add medicine”, then fill in the name, dose, times each day and days of the week. Add stock if you want refill warnings, then press Save.', go: 'meds' },
    { k: ['edit medicine', 'change medicine', 'change time', 'change the time', 'remove medicine', 'delete medicine', 'stop medicine', 'pause'], a: () => 'In Medicines, press Edit on the medicine to change times or days, tick “Pause” to stop reminders for a while, or press Remove. Family members who need approval send a suggestion instead.', go: 'meds' },
    { k: ['mark', 'took it', 'taken', 'take a dose', 'record a dose', 'tick off'], a: () => 'On Today, press “I took it” (or “Mark as taken”) on the dose. Use Skip if it was not taken, and Undo if you tapped by mistake.', go: 'today' },
    { k: ['missed', 'forgot to take', 'late dose', 'skip'], a: () => 'A dose counts as missed after a grace period set by the elder. Caretakers and family are told. If you remember late, you can still press “Mark as taken”; it is recorded as late. For what to do medically, please ask the doctor or pharmacist.' },
    { k: ['double', 'two doses', 'second dose', 'twice'], a: () => 'If a dose was already taken, the app asks you to confirm before recording another. Please check with a doctor or pharmacist before taking extra medicine.' },
    { k: ['stock', 'refill', 'running low', 'low on'], a: () => 'Enter “Tablets in stock” when you add a medicine. CareCircle counts it down with every taken dose and warns you when only a few days remain (the elder can change how many days).' },
    { k: ['reminder', 'email', 'notification', 'notify', 'alert'], a: () => 'Reminders are sent by email, once each: before a dose, when one is missed, before appointments, for low stock and as an evening summary. Add your email under Care circle > My reminders and choose which ones you want. In demo mode, emails show in the Email outbox instead of being delivered.', go: 'circle' },
    { k: ['test email', 'not getting email', 'no email', 'outbox', 'demo mode'], a: () => 'Press “Send a test email” under Care circle > My reminders. If the server has no mail settings it runs in demo mode: messages appear in the Email outbox but are not delivered.', go: 'circle' },

    { k: ['add appointment', 'new appointment', 'book appointment', 'doctor visit', 'schedule appointment', 'add a visit'], a: () => 'Open Appointments, press “Add appointment”, and enter the title, date and time. Tick “Someone should go along” if you want family to be asked.', go: 'visits' },
    { k: ['go along', 'companion', 'accompany', 'come with', 'volunteer', 'ride'], a: () => 'Family and caretakers see an appointment that needs company and can press “I’ll go along”. If nobody offers, family is reminded 3 days before.', go: 'visits' },

    { k: ['invite', 'add family', 'add member', 'add caretaker', 'add someone', 'new member'], a: () => 'Open Care circle and press Invite. Enter a name, choose Family or Caretaker, and a personal passcode is created. Share it privately, it is shown once.', go: 'circle' },
    { k: ['role', 'caretaker', 'family member', 'difference between', 'who can'], a: () => 'The Elder is in charge. Caretakers manage the day to day. Family can view and help. The elder decides who can change the care plan and what family can see.' },
    { k: ['approve', 'approval', 'suggest', 'suggestion', 'propose', 'decline'], a: () => 'When the elder wants to approve changes, family and caretaker edits become suggestions. They show on Today for whoever can decide, with Approve and Decline buttons.', go: 'today' },
    { k: ['rules', 'permission', 'privacy', 'private', 'what family can see', 'hide'], a: () => 'The elder can open Care circle > My rules to choose who can change medicines and whether family can see dose history and notes.', go: 'circle' },
    { k: ['remove member', 'remove someone', 'kick'], a: () => 'Only the elder can remove a person, from Care circle. They are signed out immediately.', go: 'circle' },

    { k: ['check-in', 'check in', 'feeling', 'how am i'], a: () => 'On Today, tap Great, Okay or Not well. Family is told if there is no check-in by the deadline, or straight away on “Not well”.', go: 'today' },
    { k: ['note', 'symptom', 'dizzy', 'post an update'], a: () => 'Under Care circle > Care notes, write an update and tick “This is a symptom” to alert caretakers and family.', go: 'circle' },
    { k: ['health card', 'print', 'blood group', 'allerg', 'emergency card', 'hospital'], a: () => 'Open Health, press Edit on the Health card to add blood group, allergies, doctors and contacts, then “Print this card” to take to hospital visits.', go: 'health' },
    { k: ['adherence', 'streak', 'percent', 'progress', 'history', 'chart', 'report'], a: () => 'Health shows doses taken over the last 7 days and your streak of days with every dose taken.', go: 'health' },
    { k: ['large text', 'bigger text', 'larger text', 'font', 'text size', 'cannot read', "can't read", 'small text'], a: () => 'Press “Larger text” in the sidebar (top bar on phones). Press “Smaller text” to go back.' },
    { k: ['dark mode', 'dark theme', 'theme'], a: () => 'CareCircle follows your device’s light or dark setting.' },
    { k: ['secure', 'safe', 'security', 'data stored', 'hashed'], a: () => 'Passcodes are stored hashed, sign-in locks after repeated wrong tries, and sessions expire. CareCircle organises care; it is not a medical service.' },
    { k: ['animation', 'intro', 'motion', 'reduce motion'], a: () => 'The opening animation plays once per browser session and can be skipped. If your device is set to “reduce motion”, animations are turned off.' },

    { k: ['next dose', 'next medicine', 'next tablet', 'what do i take', 'what should i take'], live: 'nextDose', a: () => needSignIn },
    { k: ['today', 'doses today', 'how many doses', 'how am i doing'], live: 'today', a: () => needSignIn, weak: true },
    { k: ['next appointment', 'my appointment', 'upcoming appointment', 'when is my', 'next visit'], live: 'appt', a: () => needSignIn },
    { k: ['who am i', 'my role', 'my name', 'am i signed in'], live: 'me', a: () => 'You are not signed in yet.' },
    { k: ['my circle code', 'what is my code', 'circle code is'], live: 'code', a: () => needSignIn },
    { k: ['low stock', 'any refills', 'need a refill'], live: 'stock', a: () => needSignIn },

    { k: ['what time', 'current time', 'time is it', 'time now'], a: () => 'It is ' + new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + ' on your device.' },
    { k: ['what day', 'date today', "today's date", 'what date', 'which day'], a: () => 'Today is ' + new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '.' },
    { k: ['joke'], a: () => 'Why did the vitamin go to the party? It heard there would be plenty of D! (A gentle one, for a calm app.)' },
    { k: ['weather'], a: () => 'I cannot check the weather from here, sorry. Your phone’s weather app will be quicker.' },
    { k: ['emergency', 'chest pain', "can't breathe", 'cannot breathe', 'unconscious', 'stroke', 'heart attack', 'bleeding', 'overdose', 'poison'], a: () => 'This sounds urgent. Please call your local emergency number now (112 in India) or go to the nearest hospital. I am not able to help with emergencies.', urgent: true },
    { k: ['should i take', 'can i take', 'side effect', 'dosage', 'how much', 'interact', 'diagnos', 'is it safe', 'medical advice', 'pain', 'fever'], a: () => 'I cannot give medical advice. For questions about doses, side effects or symptoms, please ask the doctor or pharmacist. I can help you write the question down: add it under “Questions to ask the doctor” on an appointment.' },
  ];
  const NAV = /\b(?:go to|open|show|take me to)\b/;
  const NAVMAP = [['today', ['today', 'dashboard', 'home']], ['meds', ['medicine', 'medication']], ['visits', ['appointment', 'visit']], ['circle', ['care circle', 'circle', 'settings', 'people']], ['health', ['health']]];

  function answer(raw) {
    const q = ' ' + raw.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim() + ' ';
    if (NAV.test(q)) {
      for (const [id, words] of NAVMAP) if (words.some(w => q.includes(w))) return signedIn() ? { text: `Opening ${TABS[id]}.`, go: id } : { text: 'Sign in first, then I can open ' + TABS[id] + ' for you.' };
    }
    let best = null, score = 0;
    for (const e of KB) {
      let sc = 0; for (const k of e.k) if (q.includes(k.length < 4 ? ' ' + k : k)) sc += e.weak ? k.length * .5 : k.length;
      if (sc > score) { score = sc; best = e; }
    }
    if (!best || score < 4) return { text: 'I am not sure about that one. I can help with signing in, medicines, doses, appointments, family and reminders, the health card and text size. Could you try asking in different words?', chips: ['How do I add a medicine?', 'How do I invite family?', 'What can you do?'] };
    const text = best.live ? (signedIn() ? live[best.live]() : best.a()) : best.a();
    return { text, chips: best.chips, goOffer: best.go && signedIn() ? best.go : null, urgent: best.urgent };
  }

  /* ── UI ── */
  let root, panel, log, input, open = false, lastToken = null, busy = false;
  const WELCOME = () => ({ text: signedIn() ? `Hi ${st().me.name.split(' ')[0]}! I can explain how CareCircle works or look up your next dose and appointments.` : 'Hi! I can explain how CareCircle works. Ask me anything, for example how to sign in or start a care circle.', chips: signedIn() ? ['Next dose?', 'How do I add a medicine?', 'How do I invite family?'] : ['How do I start a care circle?', 'What can you do?'] });

  function add(who, text, extra) {
    const m = document.createElement('div'); m.className = 'cb-msg ' + who + (extra && extra.urgent ? ' urgent' : '');
    const p = document.createElement('p'); p.textContent = text; m.appendChild(p);
    if (extra && extra.goOffer) { const b = document.createElement('button'); b.type = 'button'; b.className = 'cb-chip'; b.dataset.cbGo = extra.goOffer; b.textContent = 'Open ' + TABS[extra.goOffer]; m.appendChild(b); }
    if (extra && extra.chips && extra.chips.length) { const w = document.createElement('div'); w.className = 'cb-chips'; extra.chips.forEach(c => { const b = document.createElement('button'); b.type = 'button'; b.className = 'cb-chip'; b.dataset.cbAsk = c; b.textContent = c; w.appendChild(b); }); m.appendChild(w); }
    log.appendChild(m); log.scrollTop = log.scrollHeight; return m;
  }
  function navigate(id) {
    const b = document.querySelector(`[data-act="tab"][data-tab="${id}"]`); if (b) { b.click(); if (window.matchMedia('(max-width: 599px)').matches) setOpen(false); }
  }
  function ask(text) {
    text = text.trim().slice(0, 300); if (!text || busy) return;
    add('me', text); busy = true;
    const typing = document.createElement('div'); typing.className = 'cb-msg bot typing'; typing.setAttribute('aria-label', 'Typing'); typing.innerHTML = '<i></i><i></i><i></i>'; log.appendChild(typing); log.scrollTop = log.scrollHeight;
    const r = answer(text);
    setTimeout(() => { typing.remove(); add('bot', r.text, r); busy = false; if (r.go) navigate(r.go); }, reduced() ? 0 : 420);
  }
  function setOpen(v) {
    open = v; root.classList.toggle('open', v); panel.hidden = false; panel.setAttribute('aria-hidden', String(!v));
    $('.cb-fab', root).setAttribute('aria-expanded', String(v));
    const tk = signedIn() ? token : null;
    if (v) { if (tk !== lastToken || !log.children.length) { log.textContent = ''; lastToken = tk; const w = WELCOME(); add('bot', w.text, w); } setTimeout(() => input.focus({ preventScroll: true }), reduced() ? 0 : 220); }
    else if (document.activeElement && panel.contains(document.activeElement)) $('.cb-fab', root).focus();
  }
  function mount() {
    if ($('#cb-root')) return;
    root = document.createElement('div'); root.id = 'cb-root';
    root.innerHTML = `<button type="button" class="cb-fab" aria-label="Open help chat" aria-expanded="false" aria-controls="cb-panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="cb-ic-chat" d="M21 12a8 8 0 0 1-11.7 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/><path class="cb-ic-x" d="M6 6l12 12M18 6L6 18"/></svg></button>
      <section class="cb-panel" id="cb-panel" role="dialog" aria-label="CareCircle help chat" aria-hidden="true" hidden>
        <header><div><b>CareCircle helper</b><span>Instructions and quick answers</span></div><button type="button" class="cb-close" aria-label="Close chat">✕</button></header>
        <div class="cb-log" role="log" aria-live="polite"></div>
        <form class="cb-form" autocomplete="off"><label class="sr-only" for="cb-input">Your question</label><input id="cb-input" maxlength="300" placeholder="Ask a question…" enterkeyhint="send"><button type="submit" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>
        <p class="cb-note">Not medical advice. In an emergency call 112.</p>
      </section>`;
    document.body.appendChild(root);
    panel = $('.cb-panel', root); log = $('.cb-log', root); input = $('#cb-input', root);
    $('.cb-fab', root).addEventListener('click', () => setOpen(!open));
    $('.cb-close', root).addEventListener('click', () => setOpen(false));
    $('.cb-form', root).addEventListener('submit', ev => { ev.preventDefault(); const v = input.value; input.value = ''; ask(v); });
    root.addEventListener('click', ev => {
      const a = ev.target.closest('[data-cb-ask]'), g = ev.target.closest('[data-cb-go]');
      if (a) ask(a.dataset.cbAsk); if (g) navigate(g.dataset.cbGo);
    });
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && open && !document.querySelector('dialog[open]') && !document.querySelector('.cc-intro')) setOpen(false); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.CCChat = { answer };
})();
