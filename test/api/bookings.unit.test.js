import assert from 'node:assert/strict';
import test from 'node:test';
import { createBookingRepository } from '../../src/api/repositories/bookings.js';
import { createBookingService } from '../../src/api/services/bookings.js';
import { createBookingController } from '../../src/api/controllers/bookings.js';
import { createBookingRouter } from '../../src/api/routes/bookings.js';
import { invokeRouter, now, responseDouble, responseTime, roomItems, seededDatabase } from './helpers.js';

const booking = { lesson_id: 'L001', date: '2026-03-03', start_time: '09:00', duration_min: 60,
  student: 'Le Minh Chau', tutor_id: 'T1', room: 'R1', status: 'booked',
  cancelled_at: null, note: null, version: 1 };

test('booking repository filters start dates with an exclusive end and stable ordering', (t) => {
  const database = seededDatabase(t);
  const repository = createBookingRepository({ database });
  const changes = database.prepare('SELECT total_changes() AS count').get().count;
  assert.equal(repository.findAll().length, 34);
  assert.deepEqual(repository.findAll({ from: '2026-03-04', to: '2026-03-05', room: 'R1' })
    .map((item) => item.lesson_id), ['L009', 'L010']);
  assert.equal(repository.findAll({ to: '2026-03-04' }).length, 6);
  assert.deepEqual(repository.findAll({ from: '2026-03-10' }).map((item) => item.lesson_id), ['L033', 'L034']);
  assert.deepEqual(repository.findAll({ room: 'R6' }), []);
  assert.deepEqual(repository.findById('L001'), booking);
  assert.equal(repository.findById('missing'), null);
  assert.equal(repository.findById("L001' OR 1=1 --"), null);
  assert.deepEqual(repository.findAll({ room: "R1' OR 1=1 --" }), []);
  assert.equal(database.prepare('SELECT total_changes() AS count').get().count, changes);
});

test('booking service validates filters and delegates normalized values to repositories', async () => {
  const calls = [];
  const service = createBookingService({
    bookingRepository: {
      findAll(filters) { calls.push(filters); return [booking]; },
      findById(id) { calls.push(id); return booking; },
    },
    roomRepository: { findAll: () => roomItems },
  });
  assert.deepEqual(await service.listBookings({ from: '2026-03-03', to: '2026-03-04', room: 'R1' }), [booking]);
  assert.deepEqual(calls[0], { from: '2026-03-03', to: '2026-03-04', room: 'R1' });
  assert.equal(await service.getBooking('L001'), booking);
  assert.equal(calls[1], 'L001');
});

test('booking service rejects invalid filters before querying bookings', async () => {
  const service = createBookingService({
    bookingRepository: { findAll() { assert.fail('Invalid query reached the repository'); } },
    roomRepository: { findAll: () => roomItems },
  });
  for (const filters of [null, [], { from: '' }, { from: '2026-02-30' }, { from: '2026-3-03' },
    { from: ['2026-03-03', '2026-03-04'] }, { to: 'invalid' }, { room: '' }, { room: 'R7' },
    { room: ['R1', 'R2'] }, { tutor: 'T1' }, { from: '2026-03-04', to: '2026-03-03' },
    { from: '2026-03-03', to: '2026-03-03' }]) {
    await assert.rejects(service.listBookings(filters), (error) =>
      error.httpStatus === 422 && error.code === 'INVALID_BOOKING_FILTER');
  }
});

test('booking service distinguishes missing/invalid IDs and propagates data access failures', async () => {
  const failure = new Error('database unavailable');
  const missing = createBookingService({ bookingRepository: { findById: () => null } });
  await assert.rejects(missing.getBooking('missing'), (error) => error.httpStatus === 404 && error.code === 'BOOKING_NOT_FOUND');
  for (const id of ['', '   ', undefined, []]) {
    await assert.rejects(missing.getBooking(id), (error) => error.httpStatus === 422 && error.code === 'INVALID_BOOKING_ID');
  }
  const broken = createBookingService({ bookingRepository: {
    findById() { throw failure; }, findAll() { throw failure; },
  } });
  await assert.rejects(broken.getBooking('L001'), (error) => error === failure);
  await assert.rejects(broken.listBookings(), (error) => error === failure);
});

test('booking controller passes filters/IDs to the service and returns envelopes and version ETags', async () => {
  const query = { room: 'R1' };
  const controller = createBookingController({ bookingService: {
    listBookings(filters) { assert.equal(filters, query); return [booking]; },
    getBooking(id) { assert.equal(id, 'L001'); return booking; },
  }, now });
  const list = responseDouble();
  await controller.list({ query }, list);
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.data, { items: [booking] });
  assert.equal(list.body.code.key, 'BOOKINGS_RETRIEVED');
  assert.equal(list.body.timestamp.iso, responseTime);
  const detail = responseDouble();
  await controller.get({ params: { lesson_id: 'L001' } }, detail);
  assert.deepEqual(detail.body.data, { booking });
  assert.equal(detail.headers.ETag, '"booking-L001-v1"');
  assert.equal(detail.body.code.key, 'BOOKING_RETRIEVED');
});

test('booking controller forwards failures and safely encodes IDs in ETags', async () => {
  const failure = new Error('service failure');
  const controller = createBookingController({ bookingService: {
    listBookings() { throw failure; }, getBooking() { throw failure; },
  } });
  await assert.rejects(controller.list({ query: {} }, responseDouble()), (error) => error === failure);
  await assert.rejects(controller.get({ params: { lesson_id: 'L001' } }, responseDouble()), (error) => error === failure);
  const unusual = createBookingController({ bookingService: {
    getBooking: () => ({ ...booking, lesson_id: 'B-"quoted"', version: 3 }),
  } });
  const res = responseDouble();
  await unusual.get({ params: { lesson_id: 'B-"quoted"' } }, res);
  assert.equal(res.headers.ETag, '"booking-B-%22quoted%22-v3"');
});

test('booking router dispatches list/detail reads and rejects mutations for both routes', async () => {
  const calls = [];
  const router = createBookingRouter({ bookingController: {
    list(req, res) { calls.push('list'); res.end(); },
    get(req, res) { calls.push(req.params.lesson_id); res.end(); },
  } });
  await invokeRouter(router, 'GET');
  await invokeRouter(router, 'GET', '/L001');
  await invokeRouter(router, 'HEAD', '/L001');
  assert.deepEqual(calls, ['list', 'L001', 'L001']);
  for (const path of ['/', '/L001']) {
    assert.equal((await invokeRouter(router, 'OPTIONS', path)).res.statusCode, 204);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const { error, res } = await invokeRouter(router, method, path);
      assert.equal(error.httpStatus, 405);
      assert.equal(res.headers.Allow, 'GET, HEAD, OPTIONS');
    }
  }
  assert.equal((await invokeRouter(router, 'GET', '/L001/unknown')).unmatched, true);
});
