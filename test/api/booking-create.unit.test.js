import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCreationInput, validateAvailability } from '../../src/api/services/booking-validation.js';
import { needsManualCommunication } from '../../src/api/services/schedule-cutoff.js';
import { createBookingService } from '../../src/api/services/bookings.js';
import { createBookingController } from '../../src/api/controllers/bookings.js';
import { createBookingRouter } from '../../src/api/routes/bookings.js';
import { invokeRouter, now, responseDouble, responseTime } from './helpers.js';

export const input = { student: 'New Student', tutor_id: 'T2', room: 'R6',
  date: '2026-03-04', start_time: '13:15', duration_min: 90 };

test('creation validation accepts 60/90 minutes, trims student names, and preserves note text', () => {
  const result = validateCreationInput({ ...input, student: '  New Student  ', note: '  quoted, "note"  ', reason: '  extra lesson  ' });
  assert.equal(result.candidate.student, 'New Student');
  assert.equal(result.candidate.note, '  quoted, "note"  ');
  assert.equal(result.reason, 'extra lesson');
  assert.equal(result.candidate.status, 'booked');
  assert.equal(result.candidate.version, 1);
  assert.equal(result.candidate.cancelled_at, null);
  assert.equal(validateCreationInput({ ...input, duration_min: 60 }).candidate.duration_min, 60);
  assert.equal(validateCreationInput({ ...input, note: '' }).candidate.note, null);
});

test('creation validation rejects incorrect JSON shapes, types, missing fields, and server-owned fields', () => {
  for (const invalid of [undefined, null, [], 'text', 42,
    { ...input, student: '' }, { ...input, student: ['Name'] }, { ...input, tutor_id: null },
    { ...input, room: 1 }, { ...input, date: '2026-02-30' }, { ...input, date: undefined },
    { ...input, start_time: '24:00' }, { ...input, start_time: '9:00' },
    { ...input, duration_min: '60' }, { ...input, duration_min: 45 },
    { ...input, duration_min: 60.5 }, { ...input, note: {} }, { ...input, reason: [] },
    { ...input, lesson_id: 'L001' }, { ...input, version: 3 },
    { ...input, status: 'cancelled' }, { ...input, cancelled_at: null }]) {
    assert.throws(() => validateCreationInput(invalid), (error) =>
      error.httpStatus === 422 && error.code === 'INVALID_BOOKING_INPUT');
  }
});

test('Monday closure covers the full interval while an exact midnight end remains allowed', () => {
  for (const candidate of [{ ...input, date: '2026-03-09' },
    { ...input, date: '2026-03-08', start_time: '23:30', duration_min: 60 }]) {
    assert.throws(() => validateCreationInput(candidate), (error) => error.code === 'CENTRE_CLOSED');
  }
  assert.equal(validateCreationInput({ ...input, date: '2026-03-08', start_time: '23:00', duration_min: 60 })
    .candidate.start_time, '23:00');
});

test('availability uses half-open intervals, including neighboring dates, and ignores cancellations', () => {
  const { candidate } = validateCreationInput({ ...input, date: '2026-03-04', start_time: '00:30', duration_min: 60 });
  const previous = { ...candidate, lesson_id: 'prior', date: '2026-03-03', start_time: '23:30', duration_min: 90 };
  assert.throws(() => validateAvailability(candidate, [previous], 1), (error) => error.code === 'STUDENT_SCHEDULE_CONFLICT');
  validateAvailability({ ...candidate, start_time: '01:00' }, [previous], 1);
  validateAvailability(candidate, [{ ...previous, status: 'cancelled' }], 1);
  assert.throws(() => validateAvailability(candidate, [{ ...previous, status: 'no_show' }], 1),
    (error) => error.code === 'STUDENT_SCHEDULE_CONFLICT');
  assert.throws(() => validateAvailability(candidate, [], 6),
    (error) => error.httpStatus === 409 && error.code === 'TUTOR_DAILY_LIMIT_EXCEEDED');
});

test('communication cut-off uses 16:00 previous local day, with an inclusive boundary and both affected dates', () => {
  const { candidate } = validateCreationInput(input);
  assert.equal(needsManualCommunication({ after: candidate, changedAt: new Date('2026-03-03T08:59:59.999Z') }), false);
  assert.equal(needsManualCommunication({ after: candidate, changedAt: new Date('2026-03-03T09:00:00Z') }), true);
  assert.equal(needsManualCommunication({ after: candidate, changedAt: new Date('2026-03-03T16:00:00+07:00') }), true);
  assert.equal(needsManualCommunication({ before: candidate, after: { ...candidate, date: '2026-03-05' },
    changedAt: new Date('2026-03-03T09:00:00Z') }), true);
  assert.equal(needsManualCommunication({ after: { ...candidate, status: 'cancelled' }, changedAt: new Date() }), false);
});

test('creation service performs reference/availability checks and both inserts inside one transaction', async () => {
  let active = false;
  const calls = [];
  let audit;
  const inside = (name, result) => { assert.equal(active, true); calls.push(name); return result; };
  const service = createBookingService({
    roomRepository: { findById: () => inside('room', { room_id: 'R6' }) },
    tutorRepository: { findById: () => inside('tutor', { tutor_id: 'T2' }) },
    bookingRepository: {
      findOccupying(window) { assert.deepEqual(window, { from: '2026-03-03', to: '2026-03-05' }); return inside('availability', []); },
      countTutorDaily(id, date) { assert.equal(id, 'T2'); assert.equal(date, input.date); return inside('count', 0); },
      insert(booking) { return inside('booking', { ...booking, note: 'saved state' }); },
    },
    bookingChangeRepository: { insert(change) { inside('history'); audit = change; } },
    businessNow: () => new Date('2026-03-03T09:00:00Z'), generateId: () => 'B-unit',
    runInTransaction(operation) {
      calls.push('begin'); active = true;
      try { const saved = operation(); calls.push('commit'); return saved; }
      finally { active = false; }
    },
  });
  const booking = await service.createBooking({ ...input, reason: 'new lesson' });
  assert.deepEqual(calls, ['begin', 'tutor', 'room', 'availability', 'count', 'booking', 'history', 'commit']);
  assert.equal(booking.lesson_id, 'B-unit');
  assert.deepEqual(audit.after_snapshot, booking);
  assert.equal(audit.before_snapshot, null);
  assert.equal(audit.action, 'created');
  assert.equal(audit.reason, 'new lesson');
  assert.equal(audit.changed_at, '2026-03-03T09:00:00.000Z');
  assert.equal(audit.needs_manual_communication, true);
});

test('creation service rejects invalid references and propagates transaction/audit failures', async () => {
  for (const [tutor, room, field] of [[null, { room_id: 'R6' }, 'tutor_id'], [{ tutor_id: 'T2' }, null, 'room']]) {
    const service = createBookingService({ roomRepository: { findById: () => room },
      tutorRepository: { findById: () => tutor }, runInTransaction: (operation) => operation() });
    await assert.rejects(service.createBooking(input), (error) => error.httpStatus === 422 && error.details.field === field);
  }
  const failure = new Error('transaction failure');
  const broken = createBookingService({ runInTransaction() { throw failure; } });
  await assert.rejects(broken.createBooking(input), (error) => error === failure);
});

test('creation controller returns 201 with Location, ETag, and the saved booking; errors propagate', async () => {
  const booking = { lesson_id: 'B-unit', ...validateCreationInput(input).candidate };
  const controller = createBookingController({ bookingService: { createBooking(body) {
    assert.equal(body, input); return booking;
  } }, now });
  const res = responseDouble();
  await controller.create({ body: input }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers.Location, '/api/v1/bookings/B-unit');
  assert.equal(res.headers.ETag, '"booking-B-unit-v1"');
  assert.deepEqual(res.body.data, { booking });
  assert.equal(res.body.code.key, 'BOOKING_CREATED');
  assert.equal(res.body.code.http_status, 201);
  assert.equal(res.body.timestamp.iso, responseTime);
  const failure = new Error('service failure');
  const broken = createBookingController({ bookingService: { createBooking() { throw failure; } } });
  await assert.rejects(broken.create({ body: input }, responseDouble()), (error) => error === failure);
});

test('POST booking route requires JSON and dispatches to its creation controller', async () => {
  let created = 0;
  const router = createBookingRouter({ bookingController: {
    list(req, res) { res.end(); }, get(req, res) { res.end(); },
    update(req, res) { res.end(); },
    create(req, res) { assert.equal(req.body, input); created++; res.end(); },
  } });
  const rejected = await invokeRouter(router, 'POST');
  assert.equal(rejected.error.httpStatus, 415);
  assert.equal(created, 0);
  await invokeRouter(router, 'POST', '/', {}, { headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: input });
  assert.equal(created, 1);
  assert.equal((await invokeRouter(router, 'OPTIONS')).res.headers.Allow, 'GET, HEAD, POST, OPTIONS');
});
