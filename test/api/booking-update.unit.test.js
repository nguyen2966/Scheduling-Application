import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingEtag, parseIfMatch } from '../../src/api/booking-etag.js';
import { validateUpdateInput, prepareBookingUpdate } from '../../src/api/services/booking-validation.js';
import { createBookingService } from '../../src/api/services/bookings.js';
import { createBookingController } from '../../src/api/controllers/bookings.js';
import { createBookingRouter } from '../../src/api/routes/bookings.js';
import { createBookingRepository } from '../../src/api/repositories/bookings.js';
import { invokeRouter, now, responseDouble, responseTime, seededDatabase } from './helpers.js';

const current = { lesson_id: 'L001', date: '2026-03-03', start_time: '09:00', duration_min: 60,
  student: 'Le Minh Chau', tutor_id: 'T1', room: 'R1', status: 'booked',
  cancelled_at: null, note: null, version: 1 };
const tag = bookingEtag(current);

test('If-Match requires concrete tags and parses lists, weak tags, and quoted commas', () => {
  assert.equal(tag, '"booking-L001-v1"');
  assert.deepEqual(parseIfMatch(' "opaque,tag", W/"old", "booking-L001-v1" '),
    ['"opaque,tag"', 'W/"old"', tag]);
  for (const value of [undefined, '', '  ']) {
    assert.throws(() => parseIfMatch(value), (error) => error.httpStatus === 428);
  }
  for (const value of ['*', 'unquoted', '"tag",', '"tag" junk', null, []]) {
    assert.throws(() => parseIfMatch(value), (error) => error.httpStatus === 400);
  }
  assert.equal(parseIfMatch(`W/${tag}`).includes(tag), false);
});

test('patch validation requires a reason and rejects server-owned fields or malformed bodies', () => {
  for (const input of [undefined, null, [], 'text', {}, { reason: '' }, { reason: null },
    { reason: '  ' }, { reason: 'change', version: 1 }, { reason: 'change', lesson_id: 'other' },
    { reason: 'change', cancelled_at: '2026-03-03T00:00:00Z' }]) {
    assert.throws(() => validateUpdateInput(input), (error) => error.httpStatus === 422);
  }
  assert.deepEqual(validateUpdateInput({ student: '  Student  ', note: '', reason: '  by phone  ' }),
    { patch: { student: 'Student', note: null }, reason: 'by phone' });
});

test('rescheduling preserves identity and omitted fields and validates the whole candidate', () => {
  const result = prepareBookingUpdate(current, { date: '2026-03-04', start_time: '13:00' }, now());
  assert.deepEqual(result.candidate, { ...current, date: '2026-03-04', start_time: '13:00', version: 2 });
  assert.equal(result.action, 'updated');
  assert.equal(result.requiresAvailability, true);
  for (const patch of [{ room: 'R6' }, { date: '2026-02-30' }, { duration_min: 45 },
    { start_time: '24:00' }, { student: '' }, { note: {} }, { date: '2026-03-09' }]) {
    assert.throws(() => prepareBookingUpdate(current, patch, now()), (error) => error.httpStatus === 422);
  }
  assert.throws(() => prepareBookingUpdate(current, { start_time: current.start_time }, now()),
    (error) => error.code === 'NO_BOOKING_CHANGES');
});

test('note-only corrections and cancellation bypass unchanged historical schedule violations', () => {
  const monday = { ...current, lesson_id: 'L032', date: '2026-03-09' };
  const note = prepareBookingUpdate(monday, { note: 'owner confirmed' }, now());
  assert.equal(note.requiresAvailability, false);
  assert.equal(note.candidate.date, monday.date);
  const cancelled = prepareBookingUpdate(monday, { status: 'cancelled' }, now());
  assert.equal(cancelled.action, 'cancelled');
  assert.equal(cancelled.requiresAvailability, false);
  assert.deepEqual(cancelled.candidate, { ...monday, status: 'cancelled', cancelled_at: responseTime, version: 2 });
});

test('cancellation/restoration transitions preserve timestamps and reject contradictory operations', () => {
  const cancelled = { ...current, status: 'cancelled', cancelled_at: responseTime };
  const restored = prepareBookingUpdate(cancelled, { status: 'booked' }, now());
  assert.equal(restored.candidate.cancelled_at, null);
  assert.equal(restored.requiresAvailability, true);
  assert.equal(prepareBookingUpdate(cancelled, { note: 'corrected' }, now()).candidate.cancelled_at, responseTime);
  assert.throws(() => prepareBookingUpdate(cancelled, { status: 'cancelled' }, now()),
    (error) => error.code === 'BOOKING_ALREADY_CANCELLED');
  assert.throws(() => prepareBookingUpdate(cancelled, { start_time: '12:00' }, now()),
    (error) => error.code === 'BOOKING_CANCELLED');
  assert.throws(() => prepareBookingUpdate(current, { status: 'cancelled', start_time: '12:00' }, now()),
    (error) => error.httpStatus === 422);
  assert.throws(() => prepareBookingUpdate(current, { status: 'no_show' }, now()),
    (error) => error.code === 'INVALID_BOOKING_TRANSITION');
});

test('update service performs version checks, self-excluding validation, update and audit under its transaction', async () => {
  const calls = [];
  let active = false;
  let change;
  const inside = (name, value) => { assert.equal(active, true); calls.push(name); return value; };
  const service = createBookingService({
    bookingRepository: {
      findById: () => inside('load', current),
      findOccupying: () => inside('availability', [current]),
      countTutorDaily(id, date, excluded) {
        assert.equal(id, current.tutor_id); assert.equal(date, current.date); assert.equal(excluded, current.lesson_id);
        return inside('count', 5);
      },
      update(candidate, expected) { assert.equal(expected, 1); return inside('update', candidate); },
    },
    roomRepository: { findById: () => inside('room', { room_id: 'R1' }) },
    tutorRepository: { findById: () => inside('tutor', { tutor_id: 'T1' }) },
    bookingChangeRepository: { insert(value) { inside('history'); change = value; } },
    businessNow: now,
    runInTransaction(operation) {
      calls.push('begin'); active = true;
      try { const result = operation(); calls.push('commit'); return result; }
      finally { active = false; }
    },
  });
  const result = await service.updateBooking('L001', { start_time: '08:30', reason: 'earlier' }, tag);
  assert.deepEqual(calls, ['begin', 'load', 'tutor', 'room', 'availability', 'count', 'update', 'history', 'commit']);
  assert.equal(result.booking.version, 2);
  assert.equal(change.before_snapshot, current);
  assert.deepEqual(change.after_snapshot, result.booking);
  assert.equal(change.reason, 'earlier');
  assert.equal(change.needs_manual_communication, true);
});

test('cancellation service does not query availability and writes an immutable before/after record', async () => {
  let change;
  const service = createBookingService({
    bookingRepository: { findById: () => current, update: (candidate) => candidate,
      findOccupying() { assert.fail('Cancellation queried availability'); } },
    bookingChangeRepository: { insert(value) { change = value; } },
    runInTransaction: (operation) => operation(), businessNow: now,
  });
  const result = await service.updateBooking('L001', { status: 'cancelled', reason: 'administrative_room_change' }, tag);
  assert.equal(result.action, 'cancelled');
  assert.equal(result.booking.cancelled_at, responseTime);
  assert.equal(change.action, 'cancelled');
  assert.equal(change.reason, 'administrative_room_change');
  assert.equal(change.before_snapshot, current);
});

test('update service rejects missing/stale versions, unknown bookings, and failed conditional SQL without history', async () => {
  const noTransaction = createBookingService({ runInTransaction() { assert.fail('Missing precondition opened a transaction'); } });
  await assert.rejects(noTransaction.updateBooking('L001', { note: 'new', reason: 'change' }), (error) => error.httpStatus === 428);
  const service = createBookingService({
    bookingRepository: { findById: () => current, update: () => null },
    bookingChangeRepository: { insert() { assert.fail('Failed update added history'); } },
    runInTransaction: (operation) => operation(), businessNow: now,
  });
  for (const ifMatch of ['"booking-L001-v0"', `W/${tag}`, '"booking-L002-v1"', tag]) {
    await assert.rejects(service.updateBooking('L001', { note: 'new', reason: 'change' }, ifMatch),
      (error) => error.httpStatus === 412 && error.code === 'PRECONDITION_FAILED');
  }
  const missing = createBookingService({ bookingRepository: { findById: () => null }, runInTransaction: (operation) => operation() });
  await assert.rejects(missing.updateBooking('missing', { note: 'new', reason: 'change' }, tag),
    (error) => error.httpStatus === 404);
});

test('repository updates preserve ID/room, increment version in SQL, and reject stale writes', (t) => {
  const database = seededDatabase(t);
  const repository = createBookingRepository({ database });
  assert.equal(repository.countTutorDaily('T1', '2026-03-03', 'L001'), 2);
  const saved = repository.update({ ...current, room: 'R6', version: 99, start_time: '08:30' }, 1);
  assert.deepEqual(saved, { ...current, start_time: '08:30', version: 2 });
  assert.equal(repository.update({ ...current, start_time: '08:00' }, 1), null);
  assert.deepEqual(repository.findById('L001'), saved);
});

test('update controller sends current ETag and correct success codes and propagates failures', async () => {
  for (const action of ['updated', 'cancelled']) {
    const body = { reason: 'change' };
    const saved = { ...current, version: 2, status: action === 'cancelled' ? 'cancelled' : 'booked' };
    const controller = createBookingController({ bookingService: { updateBooking(id, input, ifMatch) {
      assert.equal(id, 'L001'); assert.equal(input, body); assert.equal(ifMatch, tag);
      return { booking: saved, action };
    } }, now });
    const res = responseDouble();
    await controller.update({ params: { lesson_id: 'L001' }, body, get: () => tag }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.ETag, '"booking-L001-v2"');
    assert.equal(res.body.code.key, action === 'cancelled' ? 'BOOKING_CANCELLED' : 'BOOKING_UPDATED');
    assert.deepEqual(res.body.data.booking, saved);
  }
  const failure = new Error('service failure');
  const controller = createBookingController({ bookingService: { updateBooking() { throw failure; } } });
  await assert.rejects(controller.update({ params: { lesson_id: 'L001' }, get: () => tag }, responseDouble()),
    (error) => error === failure);
});

test('PATCH route requires JSON and dispatches to the shared update/cancellation controller', async () => {
  const calls = [];
  const router = createBookingRouter({ bookingController: {
    list(req, res) { res.end(); }, get(req, res) { res.end(); }, create(req, res) { res.end(); },
    update(req, res) { calls.push([req.params.lesson_id, req.body]); res.end(); },
  } });
  assert.equal((await invokeRouter(router, 'PATCH', '/L001')).error.httpStatus, 415);
  const body = { status: 'cancelled', reason: 'family request' };
  await invokeRouter(router, 'PATCH', '/L001', {}, { headers: { 'Content-Type': 'application/json' }, body });
  assert.deepEqual(calls, [['L001', body]]);
  assert.equal((await invokeRouter(router, 'OPTIONS', '/L001')).res.headers.Allow, 'GET, HEAD, PATCH, OPTIONS');
});
