// Tests for site/schedule-core.js. Run: node tools/schedule-core.test.js
'use strict';
// An odd machine zone (+12:45/+13:45): any accidental use of local time would break these tests.
process.env.TZ = 'Pacific/Chatham';

const assert = require('node:assert/strict');
const path = require('node:path');
const S = require(path.join(__dirname, '..', 'site', 'schedule-core.js'));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const U = s => Date.parse(s); // '2026-03-29T01:30Z' -> ms
const H = 3600000;
const KY = 'Europe/Kyiv', VAN = 'America/Vancouver', EDM = 'America/Edmonton', LA = 'America/Los_Angeles';
const wall = (ms, tz) => { const f = S.fromInstant(ms, tz); return f.date + ' ' + f.time; };

const series = (over = {}) => Object.assign({
  id: 's1', kind: 'series', student: 'julia', start: '2026-11-03', time: '18:00',
  durationMin: 60, tz: KY, every: 1, until: null, ex: {},
}, over);
const one = (over = {}) => Object.assign({
  id: 'o1', kind: 'one', student: 'vova', date: '2026-11-12', time: '17:00', durationMin: 60, tz: KY,
}, over);
// Range helpers for the view of Nov 9-15, 2026 (Mon-Sun).
const W = ['2026-11-09', '2026-11-15'];
const pick = (occs, k) => occs.map(o => o[k]);

// ---------- dates ----------

test('isDate / isTime are strict', () => {
  for (const s of ['2026-02-28', '2024-02-29', '2026-12-31', '2026-01-01']) assert.equal(S.isDate(s), true, s);
  for (const s of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-2-3', '2026-02-03T00:00',
    ' 2026-02-03', '', null, undefined, 20260203, {}]) assert.equal(S.isDate(s), false, String(s));
  for (const s of ['00:00', '09:05', '23:59', '12:30']) assert.equal(S.isTime(s), true, s);
  for (const s of ['24:00', '9:00', '12:60', '12:5', '1230', '12:30:00', '', null, 1230]) assert.equal(S.isTime(s), false, String(s));
});

test('addDays / daysBetween / weekday across months, years and DST', () => {
  assert.equal(S.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(S.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(S.addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(S.addDays('2026-03-28', 2), '2026-03-30'); // across the EU switch: still whole days
  assert.equal(S.addDays('2026-11-10', 0), '2026-11-10');
  assert.equal(S.daysBetween('2026-10-01', '2026-11-01'), 31);
  assert.equal(S.daysBetween('2026-11-01', '2026-10-01'), -31);
  assert.equal(S.daysBetween('2026-03-01', '2026-04-01'), 31);
  assert.equal(S.weekday('2026-11-10'), 2); // Tuesday
  assert.equal(S.weekday('2026-11-08'), 0); // Sunday
  assert.equal(S.weekday('2026-11-14'), 6); // Saturday
  assert.equal(S.addDays('nope', 1), null);
  assert.equal(S.weekday('2026-02-30'), null);
  assert.equal(S.daysBetween('x', '2026-01-01'), null);
});

test('weekStart: Monday on or before (Sunday, Monday, year boundary)', () => {
  assert.equal(S.weekStart('2026-11-08'), '2026-11-02'); // Sunday -> previous Monday
  assert.equal(S.weekStart('2026-11-09'), '2026-11-09'); // Monday -> itself
  assert.equal(S.weekStart('2026-11-14'), '2026-11-09'); // Saturday
  assert.equal(S.weekStart('2027-01-01'), '2026-12-28'); // Friday
  assert.equal(S.weekStart('bad'), null);
});

test('validTz', () => {
  for (const tz of [KY, VAN, EDM, 'UTC']) assert.equal(S.validTz(tz), true, tz);
  for (const tz of ['Mars/Olympus', '', null, undefined, 3, {}]) assert.equal(S.validTz(tz), false, String(tz));
});

// ---------- instants ----------

test('tzOffsetMin: summer and winter', () => {
  assert.equal(S.tzOffsetMin(U('2026-01-15T12:00Z'), KY), 120);
  assert.equal(S.tzOffsetMin(U('2026-07-15T12:00Z'), KY), 180);
  assert.equal(S.tzOffsetMin(U('2026-01-15T12:00Z'), VAN), -480);
  assert.equal(S.tzOffsetMin(U('2026-07-15T12:00Z'), VAN), -420);
  assert.equal(S.tzOffsetMin(U('2026-01-15T12:00Z'), EDM), -420);
  assert.equal(S.tzOffsetMin(U('2026-07-15T12:00Z'), EDM), -360);
  assert.equal(S.tzOffsetMin(U('2026-07-15T12:00:00.999Z'), KY), 180); // milliseconds ignored
  assert.ok(Number.isNaN(S.tzOffsetMin(0, 'Bad/Zone')));
});

test('toInstant / fromInstant: fixed values', () => {
  assert.equal(S.toInstant('2026-07-01', '18:00', KY), U('2026-07-01T15:00Z'));
  assert.equal(S.toInstant('2026-01-13', '18:00', KY), U('2026-01-13T16:00Z'));
  assert.equal(S.toInstant('2026-07-01', '09:00', VAN), U('2026-07-01T16:00Z'));
  assert.equal(S.toInstant('2026-01-13', '09:00', VAN), U('2026-01-13T17:00Z'));
  assert.equal(S.toInstant('2026-01-13', '00:00', EDM), U('2026-01-13T07:00Z'));
  assert.deepEqual(S.fromInstant(U('2026-11-10T06:00Z'), KY), { date: '2026-11-10', time: '08:00', weekday: 2 });
  assert.deepEqual(S.fromInstant(U('2026-01-13T07:30Z'), VAN), { date: '2026-01-12', time: '23:30', weekday: 1 });
  assert.equal(S.fromInstant(U('2026-01-13T22:00Z'), KY).time, '00:00'); // midnight is 00, not 24
  for (const bad of [['2026-02-30', '10:00', KY], ['2026-02-03', '25:00', KY], ['2026-02-03', '10:00', 'X/Y']]) {
    assert.ok(Number.isNaN(S.toInstant(...bad)), bad.join(' '));
  }
  assert.equal(S.fromInstant(NaN, KY), null);
  assert.equal(S.fromInstant(0, 'X/Y'), null);
});

// Known spring-forward gaps in 2026 for the times swept below.
const GAPS = { [KY]: ['2026-03-29 03:30'], [VAN]: ['2026-03-08 02:30'], [EDM]: ['2026-03-08 02:30'], [LA]: ['2026-03-08 02:30'] };

test('round trip wall time -> instant -> wall time, every day of 2026', () => {
  for (const tz of [KY, VAN, EDM, LA]) {
    for (let d = '2026-01-01'; d <= '2026-12-31'; d = S.addDays(d, 1)) {
      for (const t of ['00:00', '01:30', '02:30', '03:30', '12:00', '18:00', '23:59']) {
        const ms = S.toInstant(d, t, tz), back = S.fromInstant(ms, tz);
        if (GAPS[tz].includes(d + ' ' + t)) {
          assert.equal(back.time, '0' + (+t[1] + 1) + t.slice(2), `${tz} gap ${d} ${t} moves forward 1h`);
        } else {
          assert.equal(back.date + ' ' + back.time, d + ' ' + t, `${tz} ${d} ${t}`);
        }
      }
    }
  }
});

test('round trip instant -> wall time -> instant, every 30 min of 2026', () => {
  for (const tz of [KY, VAN, EDM, LA]) {
    let ambiguous = 0;
    for (let ms = U('2026-01-01T00:00Z'); ms < U('2027-01-01T00:00Z'); ms += H / 2) {
      const f = S.fromInstant(ms, tz), back = S.toInstant(f.date, f.time, tz);
      if (back === ms) continue;
      // Only the second pass of a fall-back hour may differ: it maps to the earlier instant.
      assert.equal(back, ms - H, `${tz} ${new Date(ms).toISOString()}`);
      assert.equal(S.tzOffsetMin(back, tz) - S.tzOffsetMin(ms, tz), 60);
      ambiguous++;
    }
    if (tz === KY || tz === LA) assert.equal(ambiguous, 2, tz); // one repeated hour = 2 half-hour marks
  }
});

test('Kyiv spring forward 2026-03-29 (01:00 UTC: 03:00 -> 04:00)', () => {
  assert.equal(S.toInstant('2026-03-29', '02:30', KY), U('2026-03-29T00:30Z')); // exists, +2
  assert.equal(S.toInstant('2026-03-29', '02:59', KY), U('2026-03-29T00:59Z'));
  assert.equal(S.toInstant('2026-03-29', '03:00', KY), U('2026-03-29T01:00Z')); // gap -> 04:00
  assert.equal(S.toInstant('2026-03-29', '03:30', KY), U('2026-03-29T01:30Z')); // gap -> 04:30
  assert.equal(wall(S.toInstant('2026-03-29', '03:30', KY), KY), '2026-03-29 04:30');
  assert.equal(S.toInstant('2026-03-29', '04:00', KY), U('2026-03-29T01:00Z'));
  assert.equal(S.tzOffsetMin(U('2026-03-29T00:59Z'), KY), 120);
  assert.equal(S.tzOffsetMin(U('2026-03-29T01:00Z'), KY), 180);
});

test('Kyiv fall back 2026-10-25 (01:00 UTC: 04:00 -> 03:00), ambiguous -> earlier', () => {
  assert.equal(S.toInstant('2026-10-25', '02:59', KY), U('2026-10-24T23:59Z'));
  assert.equal(S.toInstant('2026-10-25', '03:00', KY), U('2026-10-25T00:00Z')); // EEST, not 01:00Z
  assert.equal(S.toInstant('2026-10-25', '03:30', KY), U('2026-10-25T00:30Z'));
  assert.equal(wall(U('2026-10-25T01:30Z'), KY), '2026-10-25 03:30'); // the later 03:30 also exists
  assert.equal(S.toInstant('2026-10-25', '04:00', KY), U('2026-10-25T02:00Z'));
});

test('Vancouver spring forward 2026-03-08 (02:00 PST -> 03:00 PDT)', () => {
  assert.equal(S.toInstant('2026-03-08', '01:59', VAN), U('2026-03-08T09:59Z'));
  assert.equal(S.toInstant('2026-03-08', '02:30', VAN), U('2026-03-08T10:30Z')); // gap -> 03:30 PDT
  assert.equal(wall(S.toInstant('2026-03-08', '02:30', VAN), VAN), '2026-03-08 03:30');
  assert.equal(S.toInstant('2026-03-08', '03:00', VAN), U('2026-03-08T10:00Z'));
});

test('Vancouver 2026-11-01: fall back or permanent DST, per installed tz data', () => {
  // 01:30 is 08:30Z either way (ambiguous -> earlier PDT, or plain PDT).
  assert.equal(S.toInstant('2026-11-01', '01:30', VAN), U('2026-11-01T08:30Z'));
  const fallsBack = S.tzOffsetMin(U('2026-12-01T12:00Z'), VAN) === -480;
  // tzdata 2026e has BC on permanent UTC-7 from 2026-03-08; older data still falls back.
  assert.equal(S.toInstant('2026-11-01', '02:00', VAN), fallsBack ? U('2026-11-01T10:00Z') : U('2026-11-01T09:00Z'));
  assert.equal(wall(U('2026-11-01T09:30Z'), VAN), fallsBack ? '2026-11-01 01:30' : '2026-11-01 02:30');
});

test('US fall back 2026-11-01 (Los Angeles): ambiguous 01:30 -> earlier', () => {
  assert.equal(S.toInstant('2026-11-01', '01:30', LA), U('2026-11-01T08:30Z')); // PDT
  assert.equal(wall(U('2026-11-01T09:30Z'), LA), '2026-11-01 01:30'); // PST, same wall time
  assert.equal(S.toInstant('2026-11-01', '02:00', LA), U('2026-11-01T10:00Z'));
});

// ---------- series ----------

test('seriesDates: weekly, every 2, until inclusive, clamps to start', () => {
  const s = series({ start: '2026-11-03' });
  assert.deepEqual(S.seriesDates(s, '2026-11-01', '2026-11-24'), ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24']);
  assert.deepEqual(S.seriesDates(s, '2026-11-04', '2026-11-16'), ['2026-11-10']);
  assert.deepEqual(S.seriesDates(series({ every: 2 }), '2026-11-01', '2026-12-31'),
    ['2026-11-03', '2026-11-17', '2026-12-01', '2026-12-15', '2026-12-29']);
  assert.deepEqual(S.seriesDates(series({ every: 2 }), '2026-11-10', '2026-11-16'), []); // off week
  assert.deepEqual(S.seriesDates(series({ until: '2026-11-17' }), '2026-11-01', '2026-12-31'),
    ['2026-11-03', '2026-11-10', '2026-11-17']);
  assert.deepEqual(S.seriesDates(series({ until: '2026-11-16' }), '2026-11-01', '2026-12-31'),
    ['2026-11-03', '2026-11-10']);
  const noEvery = series(); delete noEvery.every;
  assert.deepEqual(S.seriesDates(noEvery, '2026-11-09', '2026-11-15'), ['2026-11-10']);
  assert.deepEqual(S.seriesDates(series({ start: 'x' }), '2026-11-01', '2026-11-30'), []);
  assert.deepEqual(S.seriesDates(null, '2026-11-01', '2026-11-30'), []);
});

test('Kyiv 18:00 series in Vancouver: 08:00, then 09:00 once only Kyiv has switched', () => {
  const s = series({ start: '2026-10-06' }); // Tuesdays
  const occs = S.expand([s], '2026-10-19', '2026-11-01', VAN);
  assert.deepEqual(occs.map(o => wall(o.start, VAN)), ['2026-10-20 08:00', '2026-10-27 09:00']);
  assert.deepEqual(pick(occs, 'time'), ['18:00', '18:00']); // stored wall time stays in the series tz
  assert.deepEqual(S.expand([s], '2026-10-19', '2026-11-01', KY).map(o => wall(o.start, KY)),
    ['2026-10-20 18:00', '2026-10-27 18:00']);
  // Nov 3: 08:00 if Vancouver falls back on Nov 1, 09:00 on permanent DST (tzdata 2026e).
  const fallsBack = S.tzOffsetMin(U('2026-12-01T12:00Z'), VAN) === -480;
  assert.equal(wall(S.expand([s], '2026-11-03', '2026-11-03', VAN)[0].start, VAN), fallsBack ? '2026-11-03 08:00' : '2026-11-03 09:00');
  // Same series seen from Los Angeles (US rules): back to 08:00 after Nov 1.
  assert.deepEqual(S.expand([s], '2026-10-19', '2026-11-08', LA).map(o => wall(o.start, LA)),
    ['2026-10-20 08:00', '2026-10-27 09:00', '2026-11-03 08:00']);
});

test('series occurrences: fields, end, every 2, until inclusive', () => {
  const [o] = S.expand([series()], ...W, KY);
  assert.deepEqual(o, {
    key: 's1@2026-11-10', docId: 's1', kind: 'series', student: 'julia', origDate: '2026-11-10',
    date: '2026-11-10', time: '18:00', tz: KY, start: U('2026-11-10T16:00Z'), end: U('2026-11-10T17:00Z'),
    durationMin: 60, status: 'planned', moved: false, note: '',
  });
  assert.equal(S.expand([series({ every: 2 })], ...W, KY).length, 0);
  assert.equal(S.expand([series({ every: 2 })], '2026-11-16', '2026-11-22', KY).length, 1);
  assert.equal(S.expand([series({ until: '2026-11-10' })], ...W, KY).length, 1);
  assert.equal(S.expand([series({ until: '2026-11-09' })], ...W, KY).length, 0);
  assert.equal(S.expand([series({ start: '2026-11-17' })], ...W, KY).length, 0);
});

test('ex: cancelled kept as cancelled, done, notes, duration change', () => {
  const s = series({
    note: 'unit 5', ex: {
      '2026-11-10': { status: 'cancelled', note: 'sick' },
      '2026-11-17': { status: 'done', durationMin: 90 },
    },
  });
  const occs = S.expand([s], '2026-11-09', '2026-11-29', KY);
  assert.deepEqual(pick(occs, 'status'), ['cancelled', 'done', 'planned']);
  assert.deepEqual(pick(occs, 'note'), ['sick', 'unit 5', 'unit 5']);
  assert.equal(occs[1].durationMin, 90);
  assert.equal(occs[1].end - occs[1].start, 90 * 60000);
  assert.deepEqual(pick(occs, 'moved'), [false, false, false]);
});

test('ex: moved into the range from outside (near and far), moved out of it', () => {
  const s = series({
    ex: {
      '2026-11-10': { date: '2026-12-02' }, // out of the week
      '2026-11-24': { date: '2026-11-12', time: '10:00' }, // in from two weeks later
      '2027-03-02': { date: '2026-11-13', note: 'early' }, // in from months later
      '2026-11-17': { time: '19:30' }, // same day, later
    },
  });
  const occs = S.expand([s], ...W, KY);
  assert.deepEqual(pick(occs, 'key'), ['s1@2026-11-24', 's1@2027-03-02']);
  assert.deepEqual(occs.map(o => o.date + ' ' + o.time), ['2026-11-12 10:00', '2026-11-13 18:00']);
  assert.deepEqual(pick(occs, 'moved'), [true, true]);
  assert.equal(occs[1].note, 'early');
  const dec = S.expand([s], '2026-11-30', '2026-12-06', KY);
  assert.deepEqual(pick(dec, 'key'), ['s1@2026-12-01', 's1@2026-11-10']); // Dec 1, then the moved Dec 2
  assert.equal(dec[1].origDate, '2026-11-10');
  assert.equal(dec[1].date, '2026-12-02');
  const nov17 = S.expand([s], '2026-11-16', '2026-11-22', KY)[0];
  assert.equal(nov17.time, '19:30');
  assert.equal(nov17.moved, true);
  assert.equal(nov17.start, U('2026-11-17T17:30Z'));
  // A move is read in the series tz, also across DST: Kyiv 18:00 on Jul 1 is 15:00Z.
  const summer = series({ ex: { '2026-11-10': { date: '2026-07-01' } } });
  assert.equal(S.expand([summer], '2026-07-01', '2026-07-01', KY)[0].start, U('2026-07-01T15:00Z'));
  // ex keys that are not lesson dates are ignored.
  const orphan = series({ ex: { '2026-11-11': { date: '2026-11-12' } } });
  assert.deepEqual(pick(S.expand([orphan], ...W, KY), 'key'), ['s1@2026-11-10']);
});

test('lesson on another calendar day in the view tz (previous and next day)', () => {
  // Kyiv Tue 08:00 = Vancouver Mon 23:00 or 22:00 (UTC-7 or -8): Monday either way.
  const morning = series({ time: '08:00' });
  const mon = S.expand([morning], '2026-11-09', '2026-11-09', VAN);
  assert.equal(mon.length, 1);
  assert.equal(mon[0].origDate, '2026-11-10');
  assert.equal(mon[0].date, '2026-11-10'); // date/time stay in the series tz
  assert.equal(S.fromInstant(mon[0].start, VAN).date, '2026-11-09');
  assert.equal(S.expand([morning], '2026-11-10', '2026-11-10', VAN).length, 0);
  // Vancouver Sun 20:00 = Kyiv Mon morning.
  const evening = series({ id: 'v', student: 'victoria', start: '2026-11-01', time: '20:00', tz: VAN });
  const kyMon = S.expand([evening], '2026-11-09', '2026-11-09', KY);
  assert.deepEqual(pick(kyMon, 'origDate'), ['2026-11-08']);
  assert.equal(S.fromInstant(kyMon[0].start, KY).date, '2026-11-09');
  assert.equal(S.expand([evening], '2026-11-08', '2026-11-08', KY).length, 0);
  // Edmonton evening seen from Kyiv also lands on the next day.
  const edm = series({ id: 'e', start: '2026-11-02', time: '21:00', tz: EDM }); // Mondays
  const edmTue = S.expand([edm], '2026-11-10', '2026-11-10', KY);
  assert.deepEqual(pick(edmTue, 'origDate'), ['2026-11-09']);
  assert.equal(S.fromInstant(edmTue[0].start, KY).date, '2026-11-10');
});

test('range boundaries follow the view tz midnight', () => {
  const late = series({ time: '23:30', durationMin: 60 }); // Kyiv Tue 23:30
  assert.equal(S.expand([late], '2026-11-10', '2026-11-10', KY).length, 1);
  assert.equal(S.expand([late], '2026-11-11', '2026-11-11', KY).length, 0); // started Tuesday
  const midnight = series({ time: '00:00' });
  assert.equal(S.expand([midnight], '2026-11-10', '2026-11-10', KY).length, 1);
  assert.equal(S.expand([midnight], '2026-11-09', '2026-11-09', KY).length, 0);
});

test('one-off occurrences and sorting by start, then student', () => {
  const docs = [
    one({ id: 'o2', student: 'zed', date: '2026-11-10', time: '18:00', status: 'done', note: 'trial' }),
    series(),
    one({ id: 'o3', student: 'anna', date: '2026-11-10', time: '18:00' }),
    one(),
  ];
  const occs = S.expand(docs, ...W, KY);
  assert.deepEqual(pick(occs, 'key'), ['o3', 's1@2026-11-10', 'o2', 'o1']);
  const o2 = occs.find(o => o.key === 'o2');
  assert.equal(o2.docId, 'o2');
  assert.equal(o2.kind, 'one');
  assert.equal(o2.origDate, '2026-11-10');
  assert.equal(o2.status, 'done');
  assert.equal(o2.moved, false);
  assert.equal(o2.note, 'trial');
  assert.equal(S.expand([one({ date: '2026-11-16' })], ...W, KY).length, 0);
});

test('expand skips malformed docs without throwing', () => {
  const hostile = {};
  Object.defineProperty(hostile, 'kind', { get() { throw new Error('boom'); } });
  const junkEx = series({ // JSON.parse so "__proto__" is an own key, as it would be from storage
    id: 'j', ex: JSON.parse(`{
      "2026-11-10": {"date": "nope", "time": 99, "durationMin": -1, "status": "weird", "note": 5},
      "bad": {"date": "2026-11-11"}, "__proto__": {"date": "2026-11-11"}, "2026-11-17": null}`),
  });
  const docs = [
    null, undefined, 5, 'x', [], {}, { kind: 'series' }, hostile,
    series({ id: 'a', tz: 'Bad/Zone' }), series({ id: 'b', start: '2026-02-30' }), series({ id: 'c', time: '6pm' }),
    series({ id: 'd', durationMin: 0 }), series({ id: 'e', every: 0 }), series({ id: 'f', until: 'soon' }),
    series({ id: 'g', student: '' }), series({ id: undefined }), series({ id: 'h', kind: 'weekly' }),
    one({ id: 'i', date: null }), series({ id: 'k', ex: 'junk' }), junkEx, one({ id: 'ok' }),
  ];
  let occs;
  assert.doesNotThrow(() => { occs = S.expand(docs, ...W, KY); });
  assert.deepEqual(pick(occs, 'key'), ['j@2026-11-10', 'k@2026-11-10', 'ok']);
  const j = occs.find(o => o.key === 'j@2026-11-10');
  assert.deepEqual([j.date, j.time, j.durationMin, j.status, j.note, j.moved], ['2026-11-10', '18:00', 60, 'planned', '', false]);
  for (const args of [[null, ...W, KY], [docs, 'x', W[1], KY], [docs, W[0], '2026-02-30', KY], [docs, ...W, 'Bad/Zone'], []]) {
    assert.deepEqual(S.expand(...args), []);
  }
});

// ---------- conflicts ----------

const occ = (key, from, to, status = 'planned') => ({ key, start: U(from), end: U(to), status });

test('overlaps: touching is not an overlap, cancelled ignored', () => {
  const list = [
    occ('A', '2026-11-10T15:00Z', '2026-11-10T16:00Z'),
    occ('B', '2026-11-10T15:30Z', '2026-11-10T16:30Z'),
    occ('C', '2026-11-10T16:30Z', '2026-11-10T17:00Z'), // touches B
    occ('D', '2026-11-10T15:00Z', '2026-11-10T17:00Z', 'cancelled'),
    occ('E', '2026-11-10T14:00Z', '2026-11-10T15:00Z'), // touches A
    occ('F', '2026-11-10T09:00Z', '2026-11-10T20:00Z'), // covers everything
  ];
  const m = S.overlaps(list);
  assert.deepEqual([...m.keys()].sort(), ['A', 'B', 'C', 'E', 'F']);
  assert.deepEqual(m.get('A').sort(), ['B', 'F']);
  assert.deepEqual(m.get('B').sort(), ['A', 'F']);
  assert.deepEqual(m.get('C'), ['F']);
  assert.deepEqual(m.get('F').sort(), ['A', 'B', 'C', 'E']);
  assert.equal(m.has('D'), false);
  assert.equal(S.overlaps(list.filter(o => o.key !== 'F')).has('C'), false);
  assert.equal(S.overlaps([]).size, 0);
  assert.doesNotThrow(() => S.overlaps(null));
  assert.equal(S.overlaps([null, 5, { key: 'x' }, occ('y', '2026-11-10T15:00Z', 'bad')]).size, 0);
});

test('overlaps across time zones (Kyiv lesson vs Vancouver and Edmonton lessons)', () => {
  const docs = [
    series(), // Kyiv Tue 18:00 = 16:00Z
    one({ id: 'v', student: 'victoria', date: '2026-11-10', time: '08:30', tz: VAN }),
    one({ id: 'e', student: 'mariya', date: '2026-11-10', time: '09:30', tz: EDM }),
    one({ id: 'k', student: 'vova', date: '2026-11-10', time: '19:00', tz: KY }), // touches the series
  ];
  const occs = S.expand(docs, ...W, KY);
  const vStart = occs.find(o => o.key === 'v').start;
  // Vancouver 08:30 = Edmonton 09:30 = 15:30Z (UTC-7/-6) or 16:30Z (UTC-8/-7): either way it
  // overlaps Kyiv 18:00-19:00 (16:00-17:00Z), whichever tz data is installed.
  assert.ok(vStart === U('2026-11-10T15:30Z') || vStart === U('2026-11-10T16:30Z'));
  assert.equal(occs.find(o => o.key === 'e').start, vStart);
  const m = S.overlaps(occs);
  assert.deepEqual(m.get('s1@2026-11-10').sort(), ['e', 'v']);
  assert.deepEqual(m.get('v').sort(), ['e', 's1@2026-11-10']);
  assert.deepEqual(m.get('e').sort(), ['s1@2026-11-10', 'v']);
  assert.equal(m.has('k'), vStart === U('2026-11-10T16:30Z')); // only the UTC-8 case reaches 17:00Z
});

test('conflictsWith: interval check, ignoreKey, cancelled ignored', () => {
  const list = [
    occ('A', '2026-11-10T15:00Z', '2026-11-10T16:00Z'),
    occ('B', '2026-11-10T16:00Z', '2026-11-10T17:00Z'),
    occ('C', '2026-11-10T15:30Z', '2026-11-10T16:30Z', 'cancelled'),
  ];
  const iv = { start: U('2026-11-10T15:45Z'), end: U('2026-11-10T16:15Z') };
  assert.deepEqual(pick(S.conflictsWith(list, iv), 'key'), ['A', 'B']);
  assert.deepEqual(pick(S.conflictsWith(list, iv, 'A'), 'key'), ['B']);
  assert.deepEqual(S.conflictsWith(list, { start: U('2026-11-10T17:00Z'), end: U('2026-11-10T18:00Z') }), []);
  assert.deepEqual(S.conflictsWith(list, { start: U('2026-11-10T14:00Z'), end: U('2026-11-10T15:00Z') }), []);
  assert.deepEqual(S.conflictsWith(null, iv), []);
  assert.deepEqual(S.conflictsWith(list, null), []);
});

// ---------- next lesson ----------

test('nextOccurrence: skips cancelled and other students, counts a running lesson', () => {
  const docs = [
    series({ ex: { '2026-11-10': { status: 'cancelled' } } }),
    one({ id: 'x', student: 'vova', date: '2026-11-10', time: '18:00' }),
    null, { kind: 'series' },
  ];
  const now = U('2026-11-10T10:00Z'); // Tue noon in Kyiv
  assert.equal(S.nextOccurrence(docs, 'julia', now, KY).key, 's1@2026-11-17');
  assert.equal(S.nextOccurrence(docs, 'vova', now, KY).key, 'x');
  // 18:30 Kyiv: Vova's lesson is still running.
  assert.equal(S.nextOccurrence(docs, 'vova', U('2026-11-10T16:30Z'), KY).key, 'x');
  assert.equal(S.nextOccurrence(docs, 'vova', U('2026-11-10T17:00Z'), KY), null); // just ended
  // Viewed from Vancouver, the same answer.
  assert.equal(S.nextOccurrence(docs, 'julia', now, VAN).key, 's1@2026-11-17');
  // Horizon.
  const far = [series({ start: '2027-03-02' })];
  assert.equal(S.nextOccurrence(far, 'julia', now, KY), null);
  assert.equal(S.nextOccurrence(far, 'julia', now, KY, 120).key, 's1@2027-03-02');
  // A one-off earlier than the series wins.
  const both = [series(), one({ id: 'early', student: 'julia', date: '2026-11-11', time: '09:00' })];
  assert.equal(S.nextOccurrence(both, 'julia', U('2026-11-10T17:00Z'), KY).key, 'early');
  for (const args of [[null, 'julia', now, KY], [docs, 'julia', NaN, KY], [docs, 'julia', now, 'Bad/Zone'], [docs, undefined, now, KY]]) {
    assert.equal(S.nextOccurrence(...args), null);
  }
});

// ---------- split ----------

test('splitSeries: until, start, ids, ex partitioning, no mutation', () => {
  const s = series({
    every: 2, until: '2027-06-01', note: 'n',
    ex: {
      '2026-11-17': { status: 'cancelled' },
      '2026-12-01': { date: '2026-12-02', time: '10:00' },
      '2026-12-15': { status: 'done', note: 'x' },
    },
  });
  const before = JSON.stringify(s);
  const { old, next } = S.splitSeries(s, '2026-12-01', 's2');
  assert.equal(JSON.stringify(s), before);
  assert.equal(old.id, 's1');
  assert.equal(old.start, '2026-11-03');
  assert.equal(old.until, '2026-11-30');
  assert.deepEqual(Object.keys(old.ex), ['2026-11-17']);
  assert.equal(next.id, 's2');
  assert.equal(next.start, '2026-12-01');
  assert.equal(next.until, '2027-06-01');
  assert.equal(next.every, 2);
  assert.equal(next.note, 'n');
  assert.deepEqual(Object.keys(next.ex).sort(), ['2026-12-01', '2026-12-15']);
  // Together the halves give the same lessons as the original.
  const sig = occs => occs.map(o => [o.origDate, o.date, o.time, o.status, o.note].join(' '));
  assert.deepEqual(sig(S.expand([old, next], '2026-11-01', '2027-02-01', KY)), sig(S.expand([s], '2026-11-01', '2027-02-01', KY)));
  assert.deepEqual(S.validate(old), []);
  assert.deepEqual(S.validate(next), []);
  next.ex['2026-12-15'].note = 'changed';
  old.ex['2026-11-17'].status = 'done';
  assert.equal(JSON.stringify(s), before); // deep copies
  assert.equal('id' in S.splitSeries(s, '2026-12-01').next, false);
});

test('splitSeries at the start edits in place; bad input throws', () => {
  const s = series({ ex: { '2026-11-10': { status: 'done' } } });
  const r = S.splitSeries(s, '2026-11-03', 's2');
  assert.equal(r.old, null);
  assert.deepEqual(r.next, s);
  assert.notEqual(r.next, s);
  assert.notEqual(r.next.ex, s.ex);
  assert.equal(r.next.id, 's1');
  assert.throws(() => S.splitSeries(one(), '2026-11-12'), TypeError);
  assert.throws(() => S.splitSeries(s, 'soon'), TypeError);
});

// ---------- validate ----------

test('validate: good docs pass', () => {
  assert.deepEqual(S.validate(series()), []);
  assert.deepEqual(S.validate(series({ every: undefined, until: undefined, ex: undefined, note: 'x' })), []);
  assert.deepEqual(S.validate(series({ ex: { '2026-11-10': { status: 'done', date: '2026-11-11', time: '09:00', durationMin: 45, note: '' } } })), []);
  assert.deepEqual(S.validate(one({ status: 'cancelled', note: 'moved to Friday' })), []);
  assert.deepEqual(S.validate(series({ until: '2026-11-03' })), []); // until = start is fine
});

test('validate: catches each bad field', () => {
  const cases = [
    [series({ student: '' }), /student/], [series({ student: '   ' }), /student/], [series({ student: 7 }), /student/],
    [series({ kind: 'weekly' }), /kind/], [series({ start: '2026-02-30' }), /start/], [one({ date: '2026-13-01' }), /date/],
    [series({ time: '25:00' }), /time/], [one({ time: '9:00' }), /time/],
    [series({ durationMin: 4 }), /durationMin/], [series({ durationMin: 601 }), /durationMin/],
    [series({ durationMin: 30.5 }), /durationMin/], [one({ durationMin: '60' }), /durationMin/],
    [series({ tz: 'Mars/Base' }), /tz/], [one({ tz: undefined }), /tz/],
    [series({ every: 0 }), /every/], [series({ every: 9 }), /every/], [series({ every: 1.5 }), /every/],
    [series({ until: '2026-11-02' }), /until/], [series({ until: '2026-11-31' }), /until/],
    [series({ note: 5 }), /note/], [one({ status: 'maybe' }), /status/],
    [series({ ex: [] }), /ex/], [series({ ex: { 'Nov 10': {} } }), /ex key/],
    [series({ ex: { '2026-11-10': 'x' } }), /ex 2026-11-10: must be an object/],
    [series({ ex: { '2026-11-10': { status: 'gone' } } }), /ex 2026-11-10: status/],
    [series({ ex: { '2026-11-10': { date: '2026-11-31' } } }), /ex 2026-11-10: date/],
    [series({ ex: { '2026-11-10': { time: '7pm' } } }), /ex 2026-11-10: time/],
    [series({ ex: { '2026-11-10': { durationMin: 1000 } } }), /ex 2026-11-10: durationMin/],
    [series({ ex: { '2026-11-10': { note: {} } } }), /ex 2026-11-10: note/],
    [series({ ex: { '2026-11-11': {} } }), /ex 2026-11-11: not a lesson date/],
    [series({ every: 2, ex: { '2026-11-10': {} } }), /not a lesson date/],
  ];
  for (const [doc, re] of cases) {
    const errs = S.validate(doc);
    assert.equal(errs.length, 1, JSON.stringify(doc) + ' -> ' + JSON.stringify(errs));
    assert.match(errs[0], re);
  }
  for (const bad of [null, undefined, 'x', 5, []]) assert.deepEqual(S.validate(bad), ['document must be an object']);
  assert.ok(S.validate({ kind: 'series' }).length >= 5);
});

// ---------- formatting ----------

test('fmtTime', () => {
  assert.equal(S.fmtTime('17:30'), '17:30');
  assert.equal(S.fmtTime('17:30', true), '5:30 PM');
  assert.equal(S.fmtTime('00:05', true), '12:05 AM');
  assert.equal(S.fmtTime('12:00', true), '12:00 PM');
  assert.equal(S.fmtTime('09:00', true), '9:00 AM');
  assert.equal(S.fmtTime('bad', true), 'bad');
  assert.equal(S.fmtTime(null), '');
});

// ---------- runner ----------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log('  ok    ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL  ' + name + '\n        ' + String((e && e.message) || e).split('\n').join('\n        '));
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
