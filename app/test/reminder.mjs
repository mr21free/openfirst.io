// Validates the review-reminder .ics: correct recurrence, lands on the chosen
// weekday/time, stays on that weekday every N months, and carries an alarm.
import { buildReviewIcs, googleCalendarUrl } from '../src/lib/calendar.js';

const results = [];
const ok = (n, c) => results.push([c ? 'PASS' : 'FAIL', n]);
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function parseDtStart(ics) {
  const m = ics.match(/DTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, 0);
}
const get = (ics, key) => ics.split(/\r\n/).find((l) => l.startsWith(key + ':'))?.slice(key.length + 1);

// Scenario 1: every 3 months, Saturday morning, base mid-January.
{
  const ics = buildReviewIcs({ months: 3, weekday: 6, hour: 9, title: 'My plan', from: new Date(2026, 0, 15) });
  ok('uses CRLF line endings', ics.includes('\r\n') && !/[^\r]\n/.test(ics));
  ok('is a well-formed VCALENDAR', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
  ok('has a single VEVENT', (ics.match(/BEGIN:VEVENT/g) || []).length === 1 && (ics.match(/END:VEVENT/g) || []).length === 1);
  ok('carries a DISPLAY alarm', ics.includes('BEGIN:VALARM') && ics.includes('ACTION:DISPLAY') && ics.includes('TRIGGER:'));
  ok('has a unique UID + DTSTAMP', /UID:.+@lifeplan/.test(ics) && /DTSTAMP:\d{8}T\d{6}Z/.test(ics));

  const start = parseDtStart(ics);
  ok('starts on the chosen weekday (Saturday)', start.getDay() === 6);
  ok('starts at the chosen hour (09:00)', start.getHours() === 9 && start.getMinutes() === 0);
  ok('first reminder is ~3 months out', start > new Date(2026, 2, 1) && start < new Date(2026, 4, 1));

  const rrule = get(ics, 'RRULE');
  const ord = Math.min(Math.ceil(start.getDate() / 7), 5);
  const expectByday = (ord >= 5 ? '-1' : String(ord)) + 'SA';
  ok('RRULE recurs every 3 months', rrule.includes('FREQ=MONTHLY') && rrule.includes('INTERVAL=3'));
  ok('RRULE pins the weekday via BYDAY', rrule.includes('BYDAY=' + expectByday));
  ok('summary weaves in the plan title (no "my" before it)', /SUMMARY:Review My plan/.test(ics) && ics.includes('DESCRIPTION:'));
  ok('carries the brand + site as location and URL', ics.includes('LOCATION:https://openfirst.io/') && ics.includes('URL:https://openfirst.io/'));
  // Long lines get RFC 5545 folded ("\r\n " continuations) — unfold before
  // substring checks so a fold landing mid-phrase doesn't false-fail.
  const unfolded = ics.replace(/\r\n /g, '');
  ok('description keeps the brand + site even if LOCATION is hidden', unfolded.includes('Made with OpenFirst') && unfolded.includes('https://openfirst.io/'));
}

// Scenario 2: every 6 months, Monday evening — interval + weekday/time honoured.
{
  const ics = buildReviewIcs({ months: 6, weekday: 1, hour: 19, from: new Date(2026, 5, 27) });
  const start = parseDtStart(ics);
  ok('6-month interval honoured', get(ics, 'RRULE').includes('INTERVAL=6'));
  ok('Monday honoured', start.getDay() === 1 && get(ics, 'RRULE').includes(DAYS[1]));
  ok('evening hour honoured (19:00)', start.getHours() === 19);
  ok('first reminder ~6 months out', start > new Date(2026, 10, 1) && start < new Date(2027, 1, 1));
  ok('summary falls back to the generic name with no title', /SUMMARY:Review my OpenFirst plan/.test(ics));
}

// Google Calendar link carries the same schedule (incl. the repeat rule).
{
  const url = googleCalendarUrl({ months: 3, weekday: 6, hour: 9, title: 'My plan', from: new Date(2026, 0, 15) });
  const u = new URL(url);
  ok('google link targets calendar.google.com', u.hostname === 'calendar.google.com' && u.searchParams.get('action') === 'TEMPLATE');
  ok('google link carries the repeat (recur RRULE)', /^RRULE:FREQ=MONTHLY;INTERVAL=3;BYDAY=/.test(u.searchParams.get('recur') || ''));
  ok('google link has a start/end date range', /^\d{8}T\d{6}\/\d{8}T\d{6}$/.test(u.searchParams.get('dates') || ''));
  ok('google link carries the site as location', u.searchParams.get('location') === 'https://openfirst.io/');
  ok('google link title weaves in the plan title', u.searchParams.get('text') === 'Review My plan');
}

console.log('\n=== Review reminder (.ics) ===');
let bad = 0;
for (const [s, n] of results) { if (s === 'FAIL') bad++; console.log(`  [${s}] ${n}`); }
console.log(bad ? `\n✗ ${bad} failed` : `\n✓ all passed (${results.length})`);
process.exit(bad ? 1 : 0);
