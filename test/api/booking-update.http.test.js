import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { verifySeedDatabase } from '../../src/db/verify-seed.js';
import { now, responseTime, seededDatabase, serve } from './helpers.js';

const etag = (id, version = 1) => `"booking-${id}-v${version}"`;
const patch = (origin, id, body, tag = etag(id)) => fetch(`${origin}/api/v1/bookings/${id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(tag === null ? {} : { 'If-Match': tag }) },
  body: JSON.stringify(body),
});

test('rescheduling earlier/later and across days preserves identity, duration, and an exact audit chain', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database, now }));
  let before = { ...database.prepare("SELECT * FROM bookings WHERE lesson_id = 'L003'").get() };
  const original = { ...before };
  for (const [date, start_time] of [['2026-03-04', '15:30'], ['2026-03-04', '14:00'], ['2026-03-04', '17:00']]) {
    const response = await patch(origin, 'L003', { date, start_time, reason: 'family requested a new time' }, etag('L003', before.version));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.code.key, 'BOOKING_UPDATED');
    const saved = body.data.booking;
    assert.equal(saved.version, before.version + 1);
    assert.equal(response.headers.get('etag'), etag('L003', saved.version));
    for (const field of ['lesson_id', 'student', 'tutor_id', 'room', 'duration_min']) assert.equal(saved[field], original[field]);
    assert.equal(saved.date, date);
    assert.equal(saved.start_time, start_time);
    const history = await fetch(`${origin}/api/v1/bookings/L003/changes`);
    const latest = (await history.json()).data.items.at(-1);
    assert.deepEqual(latest.before_snapshot, before);
    assert.deepEqual(latest.after_snapshot, saved);
    assert.equal(latest.action, 'updated');
    // The first move affects Tuesday's already-finalized old schedule; later moves affect only Wednesday.
    assert.equal(latest.needs_manual_communication, before.version === 1);
    before = saved;
  }
  assert.equal(database.prepare('SELECT count(*) AS count FROM bookings').get().count, 34);
  assert.equal(database.prepare('SELECT count(*) AS count FROM booking_changes').get().count, 37);
});

test('rejected reschedules leave data unchanged for cross-room tutor/student/room conflicts and daily limits', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  for (const [body, status, key] of [
    [{ date: '2026-03-10', start_time: '09:00', tutor_id: 'T1' }, 409, 'TUTOR_SCHEDULE_CONFLICT'],
    [{ date: '2026-03-04', start_time: '09:00', tutor_id: 'T1' }, 409, 'ROOM_SCHEDULE_CONFLICT'],
    [{ date: '2026-03-04', start_time: '09:00', student: 'Le Minh Chau', tutor_id: 'T1' }, 409, 'STUDENT_SCHEDULE_CONFLICT'],
    [{ date: '2026-03-06', start_time: '22:00', tutor_id: 'T1' }, 409, 'TUTOR_DAILY_LIMIT_EXCEEDED'],
    [{ date: '2026-03-09' }, 422, 'CENTRE_CLOSED'],
    [{ room: 'R6' }, 422, 'ROOM_CHANGE_NOT_SUPPORTED'],
  ]) {
    const response = await patch(origin, 'L004', { ...body, reason: 'requested move' });
    assert.equal(response.status, status, key);
    assert.equal((await response.json()).code.key, key);
  }
  assert.equal(verifySeedDatabase(database).booking_changes, 34);
});

test('cancellation reduces tutor capacity and a same-day reschedule excludes itself from a full day', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  const cancelled = await patch(origin, 'L027', { status: 'cancelled', reason: 'family cancellation' });
  assert.equal(cancelled.status, 200);
  await cancelled.json();
  const moved = await patch(origin, 'L018', { start_time: '08:30', reason: 'earlier arrival' });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).data.booking.version, 2);
  assert.equal(database.prepare(`SELECT count(*) AS count FROM bookings WHERE tutor_id = 'T1'
    AND date = '2026-03-06' AND status IN ('booked', 'no_show')`).get().count, 6);
});

test('cancellation preserves details, records its reason/timestamp, and releases all resources for a new booking', async (t) => {
  const database = seededDatabase(t);
  const before = { ...database.prepare("SELECT * FROM bookings WHERE lesson_id = 'L001'").get() };
  const origin = await serve(t, createApp({ database, now }));
  const response = await patch(origin, 'L001', { status: 'cancelled', reason: 'administrative_room_change' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.code.key, 'BOOKING_CANCELLED');
  const saved = body.data.booking;
  assert.deepEqual(saved, { ...before, status: 'cancelled', cancelled_at: responseTime, version: 2 });
  assert.equal(response.headers.get('etag'), etag('L001', 2));
  const history = await fetch(`${origin}/api/v1/bookings/L001/changes`);
  const changes = (await history.json()).data.items;
  assert.equal(changes.length, 2);
  assert.equal(changes[1].action, 'cancelled');
  assert.equal(changes[1].reason, 'administrative_room_change');
  assert.equal(changes[1].needs_manual_communication, true);
  assert.deepEqual(changes[1].before_snapshot, before);
  assert.deepEqual(changes[1].after_snapshot, saved);
  const replacement = await fetch(`${origin}/api/v1/bookings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ student: before.student, tutor_id: before.tutor_id, room: before.room,
      date: before.date, start_time: before.start_time, duration_min: before.duration_min }),
  });
  assert.equal(replacement.status, 201);
  assert.notEqual((await replacement.json()).data.booking.lesson_id, before.lesson_id);
  assert.equal(database.prepare("SELECT status FROM bookings WHERE lesson_id = 'L001'").get().status, 'cancelled');
  const stale = await patch(origin, 'L001', { status: 'cancelled', reason: 'retry' });
  assert.equal(stale.status, 412);
  await stale.json();
  const repeated = await patch(origin, 'L001', { status: 'cancelled', reason: 'retry' }, etag('L001', 2));
  assert.equal(repeated.status, 409);
  assert.equal((await repeated.json()).code.key, 'BOOKING_ALREADY_CANCELLED');
  assert.equal(database.prepare("SELECT count(*) AS count FROM booking_changes WHERE lesson_id = 'L001'").get().count, 2);
});

test('historical conflicts, Monday records, and no-shows can be cancelled; note-only corrections preserve anomalies', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  const note = await patch(origin, 'L009', { note: 'owner review pending', reason: 'clarify imported note' });
  assert.equal(note.status, 200);
  assert.equal((await note.json()).data.booking.start_time, '11:00');
  for (const [id, version] of [['L009', 2], ['L032', 1], ['L015', 1]]) {
    const response = await patch(origin, id, { status: 'cancelled', reason: 'administrative correction' }, etag(id, version));
    assert.equal(response.status, 200, id);
    assert.equal((await response.json()).data.booking.status, 'cancelled');
  }
  assert.equal(database.prepare('SELECT count(*) AS count FROM bookings').get().count, 34);
});

test('PATCH enforces preconditions and field rules without changing records on failure', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  for (const [tag, status, key] of [[null, 428, 'PRECONDITION_REQUIRED'],
    ['unquoted', 400, 'INVALID_IF_MATCH'], ['*', 400, 'INVALID_IF_MATCH'],
    ['W/"booking-L001-v1"', 412, 'PRECONDITION_FAILED'], ['"booking-L001-v0"', 412, 'PRECONDITION_FAILED']]) {
    const response = await patch(origin, 'L001', { note: 'new note', reason: 'corrected' }, tag);
    assert.equal(response.status, status);
    assert.equal((await response.json()).code.key, key);
  }
  for (const body of [null, [], {}, { reason: '' }, { reason: 'change', version: 1 },
    { reason: 'change', cancelled_at: null }, { reason: 'change', date: '2026-02-30' },
    { reason: 'change', tutor_id: 'unknown' }, { reason: 'change', duration_min: '90' },
    { reason: 'change', date: '2026-03-03' }, { reason: 'change', status: 'cancelled', start_time: '12:00' }]) {
    const response = await patch(origin, 'L001', body);
    assert.equal(response.status, 422, JSON.stringify(body));
    await response.json();
  }
  const missing = await patch(origin, 'missing', { note: 'new note', reason: 'change' });
  assert.equal(missing.status, 404);
  await missing.json();
  const wrongType = await fetch(`${origin}/api/v1/bookings/L001`, { method: 'PATCH', body: '{}' });
  assert.equal(wrongType.status, 415);
  await wrongType.json();
  assert.equal(verifySeedDatabase(database).bookings, 34);
  const list = await patch(origin, 'L001', { note: 'confirmed', reason: 'phone call' }, '"old", "booking-L001-v1"');
  assert.equal(list.status, 200);
  assert.equal((await list.json()).data.booking.version, 2);
});

test('overnight rescheduling checks the previous date and form edits validate the new duration and student', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  const overnight = await patch(origin, 'L002', { start_time: '23:30', duration_min: 90, reason: 'late lesson' });
  assert.equal(overnight.status, 200);
  assert.equal((await overnight.json()).data.booking.duration_min, 90);
  const conflict = await patch(origin, 'L012', { start_time: '00:30', reason: 'earlier lesson' });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code.key, 'TUTOR_SCHEDULE_CONFLICT');
  const edited = await patch(origin, 'L012', { start_time: '13:00', duration_min: 60,
    student: '  Corrected Student  ', note: 'updated form', reason: 'correct student name' });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).data.booking.student, 'Corrected Student');
});

test('restoration clears cancellation timestamps and revalidates resources instead of bypassing conflicts', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  const restored = await patch(origin, 'L005', { status: 'booked', reason: 'family reinstated lesson' });
  assert.equal(restored.status, 200);
  const booking = (await restored.json()).data.booking;
  assert.equal(booking.cancelled_at, null);
  assert.equal(booking.version, 2);
  const cancelled = await patch(origin, 'L005', { status: 'cancelled', reason: 'family cancelled again' }, etag('L005', 2));
  assert.equal(cancelled.status, 200);
  await cancelled.json();
  const replacement = await fetch(`${origin}/api/v1/bookings`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student: 'Other Student', tutor_id: 'T2',
      room: 'R2', date: '2026-03-03', start_time: '14:00', duration_min: 60 }) });
  assert.equal(replacement.status, 201);
  await replacement.json();
  const blocked = await patch(origin, 'L005', { status: 'booked', reason: 'restore old lesson' }, etag('L005', 3));
  assert.equal(blocked.status, 409);
  await blocked.json();
  assert.equal(database.prepare("SELECT status FROM bookings WHERE lesson_id = 'L005'").get().status, 'cancelled');
});

test('an audit failure rolls back rescheduling and cancellation, including their version/timestamp changes', async (t) => {
  const database = seededDatabase(t);
  database.exec(`CREATE TRIGGER fail_update_audit BEFORE INSERT ON booking_changes
    WHEN NEW.action IN ('updated', 'cancelled') BEGIN SELECT RAISE(ABORT, 'private audit failure'); END;`);
  const logs = [];
  const origin = await serve(t, createApp({ database, logger: { error: (...args) => logs.push(args) } }));
  for (const body of [{ start_time: '08:30', reason: 'earlier' }, { status: 'cancelled', reason: 'cancel' }]) {
    const response = await patch(origin, 'L001', body);
    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private|SQLITE|audit failure/);
    assert.equal(database.isTransaction, false);
    assert.equal(verifySeedDatabase(database).booking_changes, 34);
  }
  assert.equal(logs.length, 2);
});

test('rescheduling to an already-finalized new date flags manual communication even when the old date is not finalized', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  const moved = await patch(origin, 'L034', { date: '2026-03-03', start_time: '12:30', reason: 'earlier date' });
  assert.equal(moved.status, 200);
  await moved.json();
  const history = await fetch(`${origin}/api/v1/bookings/L034/changes`);
  const change = (await history.json()).data.items.at(-1);
  assert.equal(change.needs_manual_communication, true);
  assert.equal(change.before_snapshot.date, '2026-03-10');
  assert.equal(change.after_snapshot.date, '2026-03-03');
});
