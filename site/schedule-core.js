/*
 * schedule-core.js: pure scheduling logic for the lesson scheduler (no DOM, no dependencies).
 *
 * Conventions: dates 'YYYY-MM-DD', times 'HH:MM' (24h), instants = ms since epoch, tz = IANA zone.
 * The machine's local time zone is never used: calendar math runs in UTC (Date.UTC / getUTC*),
 * and wall times in a zone come from Intl.DateTimeFormat.
 *
 * Stored docs (`id` added by the caller):
 *   series: {kind:'series', student, start, time, durationMin, tz, every?, until?, ex?, note?}
 *   one-off: {kind:'one', student, date, time, durationMin, tz, status?, note?}
 * expand(), overlaps(), conflictsWith() and nextOccurrence() never throw: bad docs are skipped
 * (validate() is the place that reports what is wrong).
 */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const MIN = 60000;
  const STATUSES = ['planned', 'done', 'cancelled'];
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = o => o !== null && typeof o === 'object' && !Array.isArray(o);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // ---------- calendar dates (UTC arithmetic only) ----------

  // 'YYYY-MM-DD' -> ms at 00:00 UTC of that date, or NaN unless it is a real calendar date.
  function dateMs(iso) {
    const m = typeof iso === 'string' && DATE_RE.exec(iso);
    if (!m) return NaN;
    const y = +m[1], mo = +m[2] - 1, d = +m[3];
    const ms = Date.UTC(y, mo, d);
    const t = new Date(ms);
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo && t.getUTCDate() === d ? ms : NaN;
  }
  const isoOf = ms => {
    const t = new Date(ms);
    return pad(t.getUTCFullYear(), 4) + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  };
  const isDate = s => !Number.isNaN(dateMs(s));
  const isTime = s => typeof s === 'string' && TIME_RE.test(s);
  const minutesOf = time => +time.slice(0, 2) * 60 + +time.slice(3);
  const isDur = n => Number.isInteger(n) && n >= 5 && n <= 600;

  function addDays(iso, n) {
    const ms = dateMs(iso);
    return Number.isNaN(ms) || !Number.isInteger(n) ? null : isoOf(ms + n * DAY);
  }
  function weekday(iso) { // 0 = Sun .. 6 = Sat
    const ms = dateMs(iso);
    return Number.isNaN(ms) ? null : new Date(ms).getUTCDay();
  }
  function weekStart(iso) { // Monday on or before
    const wd = weekday(iso);
    return wd === null ? null : addDays(iso, -((wd + 6) % 7));
  }
  function daysBetween(a, b) { // b - a in days
    const d = dateMs(b) - dateMs(a);
    return Number.isNaN(d) ? null : Math.round(d / DAY);
  }

  // ---------- time zones ----------

  const fmtCache = new Map(); // tz -> Intl.DateTimeFormat, or null when the zone is invalid
  function formatter(tz) {
    if (typeof tz !== 'string' || !tz) return null;
    if (!fmtCache.has(tz)) {
      let f = null;
      try {
        f = new Intl.DateTimeFormat('en-US', {
          timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
      } catch (e) { f = null; }
      fmtCache.set(tz, f);
    }
    return fmtCache.get(tz);
  }
  const validTz = tz => formatter(tz) !== null;

  // Wall-clock parts of instant ms in tz, or null.
  function wallParts(ms, tz) {
    const f = formatter(tz);
    if (!f || typeof ms !== 'number' || !(Math.abs(ms) <= 8.64e15)) return null;
    const p = {};
    for (const part of f.formatToParts(ms)) p[part.type] = part.value;
    // `% 24`: some engines print midnight as "24" even with h23.
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
  }

  function tzOffsetMin(ms, tz) { // minutes ahead of UTC at that instant
    const p = wallParts(ms, tz);
    if (!p) return NaN;
    const wall = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    const whole = ms - (((ms % 1000) + 1000) % 1000); // the formatter drops milliseconds
    return Math.round((wall - whole) / MIN);
  }

  function fromInstant(ms, tz) {
    const p = wallParts(ms, tz);
    if (!p) return null;
    const date = pad(p.y, 4) + '-' + pad(p.mo) + '-' + pad(p.d);
    return { date, time: pad(p.h) + ':' + pad(p.mi), weekday: weekday(date) };
  }

  // Wall time in tz -> instant (NaN on bad input). Takes the zone's offsets a day before and
  // after; a candidate is real when the zone has that offset at that instant.
  //  - both real and different: ambiguous fall-back hour -> the earlier instant;
  //  - neither real: spring-forward gap -> the pre-gap offset, i.e. shifted forward by the gap.
  function toInstant(dateISO, time, tz) {
    const day = dateMs(dateISO);
    if (Number.isNaN(day) || !isTime(time) || !validTz(tz)) return NaN;
    const wall = day + minutesOf(time) * MIN;
    const before = tzOffsetMin(wall - DAY, tz), after = tzOffsetMin(wall + DAY, tz);
    const tBefore = wall - before * MIN, tAfter = wall - after * MIN;
    const okBefore = tzOffsetMin(tBefore, tz) === before;
    const okAfter = tzOffsetMin(tAfter, tz) === after;
    if (okBefore && okAfter) return Math.min(tBefore, tAfter);
    if (okAfter) return tAfter;
    return tBefore;
  }

  // ---------- documents ----------

  const everyOf = s => (s.every == null ? 1 : s.every);

  // Original lesson dates of a series within [fromISO, toISO], honoring start, every, until.
  function seriesDates(series, fromISO, toISO) {
    if (!isObj(series)) return [];
    const start = dateMs(series.start), every = everyOf(series);
    let lo = dateMs(fromISO), hi = dateMs(toISO);
    if ([start, lo, hi].some(Number.isNaN) || !Number.isInteger(every) || every < 1) return [];
    if (series.until != null) {
      const until = dateMs(series.until);
      if (Number.isNaN(until)) return [];
      hi = Math.min(hi, until);
    }
    lo = Math.max(lo, start);
    const step = 7 * every * DAY, out = [];
    for (let t = start + Math.ceil((lo - start) / step) * step; t <= hi; t += step) out.push(isoOf(t));
    return out;
  }

  // Errors in the fields expand() needs; a doc with any of these is skipped.
  function coreErrors(doc) {
    if (!isObj(doc)) return ['document must be an object'];
    const errs = [], series = doc.kind === 'series', dateKey = series ? 'start' : 'date';
    const kindOk = series || doc.kind === 'one';
    if (!kindOk) errs.push('kind must be "series" or "one"');
    if (typeof doc.student !== 'string' || !doc.student.trim()) errs.push('student must be a non-empty name');
    if (kindOk && !isDate(doc[dateKey])) errs.push(dateKey + ' must be a real date (YYYY-MM-DD)');
    if (!isTime(doc.time)) errs.push('time must be HH:MM (24h)');
    if (!isDur(doc.durationMin)) errs.push('durationMin must be a whole number from 5 to 600');
    if (!validTz(doc.tz)) errs.push('tz must be a valid IANA time zone');
    if (series) {
      const ev = everyOf(doc);
      if (!Number.isInteger(ev) || ev < 1 || ev > 8) errs.push('every must be a whole number of weeks from 1 to 8');
      if (doc.until != null && !isDate(doc.until)) errs.push('until must be a real date or null');
      else if (doc.until != null && isDate(doc.start) && doc.until < doc.start) errs.push('until must not be before start');
    }
    return errs;
  }

  function validate(doc) {
    const errs = coreErrors(doc), scheduleOk = errs.length === 0;
    if (!isObj(doc)) return errs;
    if (doc.note != null && typeof doc.note !== 'string') errs.push('note must be text');
    if (doc.kind === 'one' && doc.status != null && !STATUSES.includes(doc.status)) {
      errs.push('status must be "done" or "cancelled"');
    }
    if (doc.kind !== 'series' || doc.ex == null) return errs;
    if (!isObj(doc.ex)) return errs.concat('ex must be an object keyed by date');
    for (const k of Object.keys(doc.ex)) {
      const e = doc.ex[k], at = 'ex ' + k + ': ';
      if (!isDate(k)) { errs.push('ex key "' + k + '" is not a real date'); continue; }
      if (scheduleOk && !seriesDates(doc, k, k).length) errs.push(at + 'not a lesson date of this series');
      if (!isObj(e)) { errs.push(at + 'must be an object'); continue; }
      if (e.status != null && !STATUSES.includes(e.status)) errs.push(at + 'status must be "done" or "cancelled"');
      if (e.date != null && !isDate(e.date)) errs.push(at + 'date must be a real date');
      if (e.time != null && !isTime(e.time)) errs.push(at + 'time must be HH:MM (24h)');
      if (e.durationMin != null && !isDur(e.durationMin)) errs.push(at + 'durationMin must be a whole number from 5 to 600');
      if (e.note != null && typeof e.note !== 'string') errs.push(at + 'note must be text');
    }
    return errs;
  }

  // One occurrence; `ov` holds per-occurrence overrides (a series ex entry, or the one-off's status).
  function makeOcc(doc, key, origDate, ov) {
    const date = isDate(ov.date) ? ov.date : origDate;
    const time = isTime(ov.time) ? ov.time : doc.time;
    const durationMin = isDur(ov.durationMin) ? ov.durationMin : doc.durationMin;
    const start = toInstant(date, time, doc.tz);
    return {
      key, docId: doc.id, kind: doc.kind, student: doc.student, origDate, date, time, tz: doc.tz,
      start, end: start + durationMin * MIN, durationMin,
      status: STATUSES.includes(ov.status) ? ov.status : 'planned',
      moved: date !== origDate || time !== doc.time,
      note: (typeof ov.note === 'string' && ov.note) || (typeof doc.note === 'string' && doc.note) || '',
    };
  }

  function docOccurrences(doc, fromISO, toISO) {
    if (doc.kind === 'one') return [makeOcc(doc, String(doc.id), doc.date, { status: doc.status })];
    const ex = isObj(doc.ex) ? doc.ex : {};
    // Offsets between zones differ by up to ~26h, so scan a few days around the range, plus every
    // ex entry that moves its lesson (a move can come from any distance).
    const dates = new Set(seriesDates(doc, addDays(fromISO, -3), addDays(toISO, 3)));
    for (const k of Object.keys(ex)) {
      if (isObj(ex[k]) && isDate(ex[k].date) && seriesDates(doc, k, k).length) dates.add(k);
    }
    return [...dates].map(d => makeOcc(doc, doc.id + '@' + d, d, has(ex, d) && isObj(ex[d]) ? ex[d] : {}));
  }

  // Occurrences starting in [fromISO 00:00, toISO + 1 day 00:00) in viewTz, sorted by start, student.
  // Docs need an `id` (string or number); docs without one, or with bad core fields, are skipped.
  function expand(docs, fromISO, toISO, viewTz) {
    if (!Array.isArray(docs) || !isDate(fromISO) || !isDate(toISO) || !validTz(viewTz)) return [];
    const lo = toInstant(fromISO, '00:00', viewTz), hi = toInstant(addDays(toISO, 1), '00:00', viewTz);
    const out = [];
    for (const doc of docs) {
      try { // belt and braces: a hostile object (throwing getter) must not break the whole view
        if (coreErrors(doc).length) continue;
        if (!((typeof doc.id === 'string' && doc.id) || Number.isFinite(doc.id))) continue;
        for (const o of docOccurrences(doc, fromISO, toISO)) if (o.start >= lo && o.start < hi) out.push(o);
      } catch (e) { /* skip */ }
    }
    return out.sort((a, b) => a.start - b.start || cmp(a.student, b.student) || cmp(a.key, b.key));
  }

  // ---------- conflicts ----------

  const live = o => isObj(o) && o.status !== 'cancelled' && Number.isFinite(o.start) && Number.isFinite(o.end);

  // Map key -> keys it overlaps (only keys with at least one overlap). Touching is not overlapping.
  function overlaps(occs) {
    const res = new Map();
    const list = (Array.isArray(occs) ? occs : []).filter(live).sort((a, b) => a.start - b.start);
    const add = (a, b) => { if (!res.has(a)) res.set(a, []); res.get(a).push(b); };
    for (let i = 0; i < list.length; i++) {
      // Sorted by start, so once b starts at or after a ends, no later one can overlap a.
      for (let j = i + 1; j < list.length && list[j].start < list[i].end; j++) {
        const a = list[i], b = list[j];
        if (a.start < b.end && a.key !== b.key) { add(a.key, b.key); add(b.key, a.key); }
      }
    }
    return res;
  }

  function conflictsWith(occs, iv, ignoreKey) {
    if (!Array.isArray(occs) || !isObj(iv) || !Number.isFinite(iv.start) || !Number.isFinite(iv.end)) return [];
    return occs.filter(o => live(o) && o.key !== ignoreKey && o.start < iv.end && iv.start < o.end);
  }

  // First non-cancelled occurrence of `student` that has not ended yet, or null.
  function nextOccurrence(docs, student, nowMs, viewTz, horizonDays = 60) {
    const now = fromInstant(nowMs, viewTz);
    if (!now) return null;
    const h = Number.isFinite(horizonDays) ? Math.min(Math.max(Math.floor(horizonDays), 0), 3660) : 60;
    // From yesterday, so a lesson still running across midnight counts.
    const occs = expand(docs, addDays(now.date, -1), addDays(now.date, h), viewTz);
    return occs.find(o => o.student === student && o.status !== 'cancelled' && o.end > nowMs) || null;
  }

  // "Change this and following": `old` ends the day before atDate (an original occurrence date),
  // `next` starts at atDate with id newId (no id if newId is null). Ex entries go to the side their
  // original date falls on. When atDate is on or before the start: {old: null, next: copy with the
  // same id}, i.e. edit in place. Inputs are never mutated.
  function splitSeries(series, atDate, newId) {
    if (!isObj(series) || series.kind !== 'series' || !isDate(series.start) || !isDate(atDate)) {
      throw new TypeError('splitSeries needs a series doc and a YYYY-MM-DD date');
    }
    const clone = o => JSON.parse(JSON.stringify(o));
    if (atDate <= series.start) return { old: null, next: clone(series) };
    const old = clone(series), next = clone(series), ex = isObj(old.ex) ? old.ex : {};
    old.ex = {};
    next.ex = {};
    for (const k of Object.keys(ex)) (k < atDate ? old.ex : next.ex)[k] = ex[k];
    old.until = addDays(atDate, -1);
    next.start = atDate;
    delete next.id;
    if (newId != null) next.id = newId;
    return { old, next };
  }

  function fmtTime(time, hour12) {
    if (!isTime(time)) return typeof time === 'string' ? time : '';
    if (!hour12) return time;
    const h = +time.slice(0, 2);
    return (h % 12 || 12) + ':' + time.slice(3) + (h < 12 ? ' AM' : ' PM');
  }

  const SchedCore = {
    addDays, weekday, weekStart, daysBetween, isDate, isTime, validTz,
    toInstant, fromInstant, tzOffsetMin, seriesDates, expand, overlaps, conflictsWith,
    nextOccurrence, splitSeries, validate, fmtTime,
  };
  if (typeof module === 'object' && module.exports) module.exports = SchedCore;
  else root.SchedCore = SchedCore;
})(typeof self !== 'undefined' ? self : this);
