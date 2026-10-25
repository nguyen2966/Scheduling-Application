import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { defaultReferenceTime } from '../../src/config.js';
import { verifySeedDatabase } from '../../src/db/verify-seed.js';
import { now, seededDatabase, serve } from './helpers.js';

const input = { student: 'New Student', tutor_id: 'T2', room: 'R6',
  date: '2026-03-07', start_time: '13:00', duration_min: 60 };
const post = (origin, body) => fetch(`${origin}/api/v1/bookings`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('HTTP creation saves 60/90-minute bookings and full audit snapshots without changing imported records', async (t) => {
  const database = seededDatabase(t);
  const originals = database.prepare('SELECT * FROM bookings ORDER BY lesson_id').all();
  const origin = await serve(t, createApp({ database, now: () => new Date('2030-01-01T00:00:00Z') }));
  for (const [duration_min, start_time] of [[60, '13:00'], [90, '15:00']]) {
    const response = await post(origin, { ...input, student: '  New Student  ', duration_min, start_time, reason: 'extra lesson' });
    assert.equal(response.status, 201);
    assert.match(response.headers.get('content-type'), /application\/json/);
    const body = await response.json();
    const booking = body.data.booking;
    assert.match(booking.lesson_id, /^B-[0-9a-f-]{36}$/);
    assert.equal(booking.student, 'New Student');
    assert.equal(booking.duration_min, duration_min);
    assert.equal(booking.status, 'booked');
    assert.equal(booking.version, 1);
    assert.equal(booking.cancelled_at, null);
    assert.equal(body.code.http_status, 201);
    assert.equal(body.code.key, 'BOOKING_CREATED');
    assert.equal(body.timestamp.iso, '2030-01-01T00:00:00.000Z');
    assert.equal(response.headers.get('etag'), `"booking-${booking.lesson_id}-v1"`);
    const location = response.headers.get('location');
    assert.equal(location, `/api/v1/bookings/${booking.lesson_id}`);
    const detail = await fetch(`${origin}${location}`);
    assert.deepEqual((await detail.json()).data.booking, booking);
    const history = await fetch(`${origin}${location}/changes`);
    const changes = (await history.json()).data.items;
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, 'created');
    assert.equal(changes[0].changed_at, defaultReferenceTime);
    assert.equal(changes[0].before_snapshot, null);
    assert.equal(changes[0].reason, 'extra lesson');
    assert.equal(changes[0].needs_manual_communication, false);
    assert.deepEqual(changes[0].after_snapshot, booking);
  }
  assert.deepEqual(database.prepare("SELECT * FROM bookings WHERE lesson_id LIKE 'L%' ORDER BY lesson_id").all(), originals);
  assert.equal(database.prepare('SELECT count(*) AS count FROM bookings').get().count, 36);
  assert.equal(database.prepare('SELECT count(*) AS count FROM booking_changes').get().count, 36);
});

test('creation returns actionable 409 errors for each resource conflict, no-shows, and daily over-capacity', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database, now }));
  for (const [candidate, key, ids] of [
    [{ ...input, student: 'Le Minh Chau', tutor_id: 'T1', date: '2026-03-04', start_time: '09:00' }, 'STUDENT_SCHEDULE_CONFLICT', ['L007', 'L008']],
    [{ ...input, tutor_id: 'T1', date: '2026-03-10', start_time: '09:00' }, 'TUTOR_SCHEDULE_CONFLICT', ['L033', 'L034']],
    [{ ...input, tutor_id: 'T3', room: 'R1', date: '2026-03-04', start_time: '11:00' }, 'ROOM_SCHEDULE_CONFLICT', ['L009', 'L010']],
    [{ ...input, tutor_id: 'T3', room: 'R1', date: '2026-03-03', start_time: '09:30' }, 'ROOM_SCHEDULE_CONFLICT', ['L001']],
    [{ ...input, date: '2026-03-05', start_time: '13:00' }, 'TUTOR_SCHEDULE_CONFLICT', ['L015']],
    [{ ...input, tutor_id: 'T1', date: '2026-03-06', start_time: '21:30' }, 'TUTOR_DAILY_LIMIT_EXCEEDED', null],
  ]) {
    const response = await post(origin, candidate);
    assert.equal(response.status, 409, key);
    const body = await response.json();
    assert.equal(body.code.key, key);
    assert.equal(body.code.http_status, 409);
    assert.ok(body.data.details.field);
    if (ids) assert.deepEqual(body.data.details.conflicting_lesson_ids, ids);
  }
  assert.equal(verifySeedDatabase(database).bookings, 34);
});

test('cancelled lessons release all resources and exact end/start boundaries remain available', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  const released = await post(origin, { ...input, date: '2026-03-03', start_time: '14:00',
    student: 'Vu Ha My', room: 'R2' });
  assert.equal(released.status, 201);
  await released.json();
  const adjacent = await post(origin, { ...input, student: 'Another Student', tutor_id: 'T1',
    room: 'R1', date: '2026-03-03', start_time: '10:00', duration_min: 60 });
  // L003 starts at 10:30: only the first boundary is free, the full interval is not.
  assert.equal(adjacent.status, 409);
  assert.equal((await adjacent.json()).code.key, 'TUTOR_SCHEDULE_CONFLICT');
  const free = await post(origin, { ...input, student: 'Another Student', tutor_id: 'T1',
    room: 'R1', date: '2026-03-03', start_time: '12:00' });
  assert.equal(free.status, 201);
  await free.json();
});

test('the sixth counted daily booking is allowed and the seventh is rejected without extra history', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  for (let hour = 0; hour < 7; hour++) {
    const response = await post(origin, { ...input, date: '2026-03-11', start_time: `0${hour}:00` });
    const body = await response.json();
    assert.equal(response.status, hour < 6 ? 201 : 409);
    if (hour === 6) assert.equal(body.code.key, 'TUTOR_DAILY_LIMIT_EXCEEDED');
  }
  assert.equal(database.prepare('SELECT count(*) AS count FROM bookings').get().count, 40);
  assert.equal(database.prepare('SELECT count(*) AS count FROM booking_changes').get().count, 40);
});

test('invalid creation input, unknown references, and Monday occupancy return 422 without writes', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  for (const body of [null, [], 'text', 12, {}, { ...input, student: '' },
    { ...input, duration_min: '60' }, { ...input, duration_min: 45 },
    { ...input, tutor_id: 'missing' }, { ...input, room: 'R7' },
    { ...input, date: '2026-02-30' }, { ...input, date: '2026-03-09' },
    { ...input, date: '2026-03-08', start_time: '23:30' },
    { ...input, status: 'cancelled' }, { ...input, version: 2 }, { ...input, lesson_id: 'L001' }]) {
    const response = await post(origin, body);
    assert.equal(response.status, 422, JSON.stringify(body));
    assert.equal((await response.json()).code.http_status, 422);
  }
  const text = await fetch(`${origin}/api/v1/bookings`, { method: 'POST', body: JSON.stringify(input) });
  assert.equal(text.status, 415);
  assert.equal((await text.json()).code.key, 'UNSUPPORTED_MEDIA_TYPE');
  assert.equal(verifySeedDatabase(database).booking_changes, 34);
});

test('cross-midnight overlaps are found across dates and ending exactly at Monday midnight is allowed', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  const first = await post(origin, { ...input, date: '2026-03-03', start_time: '23:30', duration_min: 90 });
  assert.equal(first.status, 201);
  await first.json();
  const overlapping = await post(origin, { ...input, student: 'Another Student', room: 'R5',
    date: '2026-03-04', start_time: '00:30' });
  assert.equal(overlapping.status, 409);
  assert.equal((await overlapping.json()).code.key, 'TUTOR_SCHEDULE_CONFLICT');
  const sunday = await post(origin, { ...input, date: '2026-03-08', start_time: '23:00' });
  assert.equal(sunday.status, 201);
  await sunday.json();
});

test('creation after the local cut-off is accepted and flagged for manual communication', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t),
    businessNow: () => new Date('2026-03-06T09:00:00Z') }));
  const response = await post(origin, input);
  assert.equal(response.status, 201);
  await response.json();
  const history = await fetch(`${origin}${response.headers.get('location')}/changes`);
  const change = (await history.json()).data.items[0];
  assert.equal(change.needs_manual_communication, true);
  assert.equal(change.changed_at, '2026-03-06T09:00:00.000Z');
});

test('an audit-insert failure rolls back the booking and returns a safe server error', async (t) => {
  const database = seededDatabase(t);
  database.exec(`CREATE TRIGGER fail_creation_audit BEFORE INSERT ON booking_changes
    WHEN NEW.action = 'created' BEGIN SELECT RAISE(ABORT, 'private audit failure'); END;`);
  const logs = [];
  const origin = await serve(t, createApp({ database, logger: { error: (...args) => logs.push(args) } }));
  const response = await post(origin, input);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.code.key, 'INTERNAL_SERVER_ERROR');
  assert.doesNotMatch(JSON.stringify(body), /private|audit failure|SQLITE/);
  assert.equal(logs.length, 1);
  assert.equal(database.isTransaction, false);
  assert.equal(verifySeedDatabase(database).bookings, 34);
});
