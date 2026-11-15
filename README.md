# CareCircle

**A shared medication and appointment platform for an elderly person, their caretakers and their family, with the elder in charge of their own care.**

Built for the PromptWars × Catalyst challenge: *Elderly Care & Medication Management Platform*.

## Project description

CareCircle helps an elderly person manage daily medicines, doctor appointments and healthcare routines, while keeping family and caretakers informed. Everyone in a circle signs in with a circle code and their own passcode. Caretakers manage the day to day, family can view and help, and the elder decides who can change the care plan and what family can see.

It goes beyond a reminder app. It adds approvals so the elder stays in charge, a missed-dose chain that alerts caretakers and family, a daily check-in, an accompaniment request for appointments, refill forecasting, a printable health card for hospital visits, and a large-text mode for the elder.

## Challenge requirements checklist

| Requirement from the challenge deck | Status in this repository |
|---|---|
| Requirement 1/4: submit GitHub repository link on the platform | Push this folder to a GitHub repository and submit its link. |
| Requirement 2/4: repository must be published and set to public access | Set the repository to **Public** before submitting. |
| Requirement 3/4: submit the "Deployed Project" link | Deploy with the steps below and submit the live URL. Check that it still works before the Top 10 decision, because a broken link means disqualification. |
| Requirement 4/4: brief description of the project | See *Project description* above. |
| Problem alignment: shared ecosystem, passcode access | Circle codes plus per-person passcodes (hashed, rate-limited). |
| Problem alignment: add, edit and manage medication schedules, track adherence | Medicine schedules with days, times, stock; adherence stats in *Health*. |
| Problem alignment: monitor upcoming doctor appointments | *Visits* tab with 24-hour and 2-hour reminders. |
| Problem alignment: proactive email reminders for missed medicines, upcoming doses and appointments | Reminder engine checks every 30 seconds; each email is sent once. |
| Assessment: code quality | Plain JavaScript, no build step, one server file with clear sections. |
| Assessment: security | Hashed passcodes (scrypt), login lockout, session expiry, HTML escaping, a Content-Security-Policy header, path traversal guard. |
| Assessment: efficiency | Single-file JSON store with atomic writes, reminder engine runs only on a 30-second tick. |
| Assessment: testing | `npm test` runs an end-to-end suite with a simulated clock. |
| Assessment: accessibility | Large-text mode, visible focus rings, labelled controls, reduced-motion support, print-friendly health card. |
| Assessment: effective use of services | Email over standard SMTP (nodemailer) with an in-app outbox when SMTP is not set. |

## Design

CareCircle uses a calm, Manus-inspired design system (see `public/style.css`): warm off-white surfaces, deep charcoal type, muted green for healthy states, restrained blue for actions, and Inter for text. On desktop (960px and wider) a sidebar holds the five sections. On phones, a top bar and bottom tabs do the same job. The sign-in screen is split in two on wider screens.

The ID card on the *Care circle* page tilts gently with the pointer. It is plain CSS and needs no WebGL. It turns off for reduced-motion preferences.

**Not included:** the React Bits `<Lanyard />` 3D component. It needs its source file and the `three` package (React Bits builds on React). This version does not add React or WebGL. If you want the 3D version, supply the component source and it can be added as a separate, lazily loaded module.

## Run it

```bash
npm install        # optional: only needed for real email (installs nodemailer)
npm test           # end-to-end API checks
npm run test:ui    # renders every screen against live data
npm start          # http://localhost:3000
```

Requires Node 18 or newer. Data is stored in `data/db.json` (or the path in `DATA_FILE`).

## Deploy (for the "Deployed Project" link)

Any host that runs a Node process or Docker works. A health check is at `/healthz`.

```bash
docker build -t carecircle .
docker run -p 3000:3000 -v carecircle-data:/app/data carecircle
```

Set `APP_URL` to the public address so email links work. Keep the data directory on persistent storage, otherwise sign-ins and reminders are lost when the container restarts.

Limitations to know about: data is a single JSON file, which suits one care circle or a small pilot but not large scale. Login lockout is keyed by the connecting address. Behind a reverse proxy, every user shares the proxy's address for lockout purposes, so the lockout can then affect everyone; put the app behind a proxy only after changing that logic to read the forwarded client address.

## Send real email

Without SMTP settings the app runs in **demo mode**: every reminder is recorded in *Circle → Email outbox* so you can see exactly what would be sent. Set these environment variables (see `.env.example`) before `npm start`:

```bash
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=587
export SMTP_USER=you@gmail.com
export SMTP_PASS=your-app-password      # Gmail: create an App Password
export MAIL_FROM="CareCircle <you@gmail.com>"
export APP_URL=https://your-domain.example   # link used inside emails
npm start
```

Then open *Circle → My reminders → Send a test email*.

## How access works

- Anyone can **start a care circle**. You get a 6-character **circle code** and one **passcode per person** (for example `maple-4821`), shown once.
- People sign in with the circle code plus their own passcode. Passcodes are stored hashed (scrypt), 6 wrong tries locks sign-in for 10 minutes, sessions last 30 days, and removing someone or resetting a passcode signs them out at once.
- Roles: **Elder** (full control), **Caretaker** (manages day to day), **Family** (views, helps, suggests).

## What it does beyond reminders

| Feature | What it does |
|---|---|
| Elder-in-charge approvals | Family edits become *suggestions* the elder approves or declines (the elder can change this to "direct" or "view only"). |
| Privacy switch | The elder can hide dose history, notes and activity from family. |
| Missed-dose chain | A dose with no tap after the grace period (default 60 min) is logged as missed and caretakers and family are emailed. |
| Double-dose guard | Recording a dose too soon after the last one asks for confirmation. |
| Daily check-in | One tap: Great / Okay / Not well. "Not well" alerts family at once. No check-in by the deadline also alerts them. |
| "I'll go along" | Appointments can ask for a companion. If nobody volunteers 3 days before, family is emailed. |
| Refill forecast | Stock is counted down per dose; a warning is emailed when it will run out within N days. |
| Symptom notes | Notes marked as symptoms alert caretakers and family. |
| Evening summary | Doses taken, anything missed, check-in status and the next appointment. |
| Who did what | Every change and dose is attributed to a person. |
| Health card | Allergies, conditions, doctors, emergency contacts and current medicines, printable for hospital visits. |
| Large-text mode | Bigger type and buttons for the elder. |

## Reminder emails

Checked every 30 seconds, each sent once: dose coming up, missed dose, appointment 24 hours and 2 hours before, companion needed, low stock, no check-in, evening summary. Each person chooses which ones they receive under *My reminders*.

## Tests

```bash
npm test
```

Runs the API end to end with a simulated clock: logins, permissions, approvals, reminders, de-duplication, privacy, stock accounting and the health check.

## Notes

This app helps people stay organised. It is not medical advice, and it does not check drug interactions. Always follow the prescriber's instructions.
