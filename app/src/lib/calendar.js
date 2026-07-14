// A recurring "review your plan" reminder as an .ics file the user imports once.
// First principles: with no server and no contact info we can't *send* a reminder,
// so we hand the user a self-sustaining one their own calendar (Apple / Google /
// Outlook) delivers across devices, forever, offline. Pure strings — no deps.

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']; // JS getDay() 0..6 → iCal code

const pad = (n) => String(n).padStart(2, '0');

// Floating local time (no Z, no TZID): shows at the same wall-clock everywhere —
// exactly right for "remind me Saturday morning" regardless of travel.
const fmtLocal = (d) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

const fmtUTC = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

const uid = () =>
  ((globalThis.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    Math.random().toString(36).slice(2) + Date.now().toString(36)) + '@lifeplan';

// RFC 5545 text escaping.
const esc = (s) =>
  String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Fold content lines to ≤75 octets (best-effort, char-based) per RFC 5545.
function fold(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length > 74) { out += '\r\n ' + rest.slice(0, 74); rest = rest.slice(74); }
  return out + '\r\n ' + rest;
}

const SITE = 'https://openfirst.io/';
// No "my" in front of the title itself — a plan named "My plan" would
// otherwise read as "Review my My plan".
const summary = (title) => (title && title.trim() ? `Review ${title.trim()}` : 'Review my OpenFirst plan');
// The brand + URL are woven into the text itself (not just LOCATION/URL fields,
// which some calendar clients hide) so the reminder still makes sense standing
// alone months later, after the name and site have been forgotten.
const describe = (title) =>
  `Time to review ${title && title.trim() ? `“${title.trim()}”` : 'your plan'}: check what changed, update values, re-export the reader, and replace the copy you gave your loved ones.\n\nMade with OpenFirst — ${SITE}`;

// Shared schedule: first reminder one interval out, snapped to the chosen weekday,
// recurring every N months pinned to that weekday (e.g. "2nd Saturday every 3 months").
function occurrence({ months = 3, weekday = 6, hour = 9, from = new Date() } = {}) {
  const start = new Date(from);
  start.setMonth(start.getMonth() + months);
  start.setHours(hour, 0, 0, 0);
  start.setDate(start.getDate() + ((weekday - start.getDay() + 7) % 7));
  const end = new Date(start.getTime() + 30 * 60000);
  const ordinal = Math.ceil(start.getDate() / 7);
  const byday = (ordinal >= 5 ? -1 : ordinal) + DAYS[weekday];
  return { start, end, rrule: `FREQ=MONTHLY;INTERVAL=${months};BYDAY=${byday}` };
}

const localTZ = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
};

/**
 * Build the reminder .ics text — the universal file (Apple Calendar, Outlook, …).
 * @param {object} o
 * @param {number} [o.months=3]  recurrence interval in months (e.g. 3, 6, 12)
 * @param {number} [o.weekday=6] preferred day of week, 0=Sun … 6=Sat
 * @param {number} [o.hour=9]    hour of day, 0–23
 * @param {string} [o.title]     plan title, woven into the reminder text
 * @param {Date}   [o.from]      base date (defaults to now) — first reminder is one interval out
 */
export function buildReviewIcs(opts = {}) {
  const { start, end, rrule } = occurrence(opts);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenFirst//Review reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid()}`,
    `DTSTAMP:${fmtUTC(new Date())}`,
    `DTSTART:${fmtLocal(start)}`,
    `DTEND:${fmtLocal(end)}`,
    `RRULE:${rrule}`,
    fold(`SUMMARY:${esc(summary(opts.title))}`),
    fold(`DESCRIPTION:${esc(describe(opts.title))}`),
    fold(`LOCATION:${esc(SITE)}`),
    fold(`URL:${SITE}`),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(summary(opts.title))}`,
    'TRIGGER:-PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** Google Calendar "add event" link — opens online with the repeat already set. */
export function googleCalendarUrl(opts = {}) {
  const { start, end, rrule } = occurrence(opts);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: summary(opts.title),
    dates: `${fmtLocal(start)}/${fmtLocal(end)}`,
    details: describe(opts.title),
    location: SITE,
    recur: `RRULE:${rrule}`,
  });
  const tz = localTZ();
  if (tz) p.set('ctz', tz);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** Outlook.com "compose event" link. Note: the web compose form cannot carry a
 *  repeat rule, so this opens a single event the user sets to recur — the .ics
 *  is the better path for a recurring reminder in Outlook. */
export function outlookCalendarUrl(opts = {}) {
  const { start, end } = occurrence(opts);
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: summary(opts.title),
    startdt: iso(start),
    enddt: iso(end),
    body: describe(opts.title),
    location: SITE,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p.toString()}`;
}

/** Build + download the reminder. Returns the .ics text (handy for tests). */
export function downloadReviewIcs(opts = {}) {
  const ics = buildReviewIcs(opts);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'openfirst-plan-review-reminder.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return ics;
}
