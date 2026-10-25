import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { AppError } from '../../src/api/errors/app-error.js';
import { createBookingChangeRepository } from '../../src/api/repositories/booking-changes.js';
import { createBookingChangeService } from '../../src/api/services/booking-changes.js';
import { createBookingChangeController } from '../../src/api/controllers/booking-changes.js';
import { createBookingChangeRouter } from '../../src/api/routes/booking-changes.js';
import { verifySeedDatabase } from '../../src/db/verify-seed.js';
import { invokeRouter, now, responseDouble, responseTime, seededDatabase, serve } from './helpers.js';

test('history repository returns only the requested booking in insertion order', (t) => {
  const database = seededDatabase(t);
  const repository = createBookingChangeRepository({ database });
  const baseline = repository.findByLessonId('L001')[0];
  const snapshot = JSON.parse(baseline.after_snapshot);
  database.prepare(`INSERT INTO booking_changes (lesson_id, action, changed_at,
    before_snapshot, after_snapshot, reason, needs_manual_communication)
    VALUES ('L001', 'updated', ?, ?, ?, 'test adjustment', 1)`).run(
    '2026-03-02T00:00:00Z', JSON.stringify(snapshot), JSON.stringify({ ...snapshot, version: 2 }),
  );
  const changesBeforeRead = database.prepare('SELECT total_changes() AS count').get().count;
  const changes = repository.findByLessonId('L001');
  assert.equal(changes.length, 2);
  assert.equal(changes[0].action, 'imported');
  assert.equal(changes[1].action, 'updated');
  assert.ok(changes[0].id < changes[1].id);
  assert.ok(changes[1].changed_at < changes[0].changed_at);
  assert.ok(changes.every((change) => change.lesson_id === 'L001'));
  assert.deepEqual(repository.findByLessonId('missing'), []);
  assert.deepEqual(repository.findByLessonId("L001' OR 1=1 --"), []);
  assert.equal(database.prepare('SELECT total_changes() AS count').get().count, changesBeforeRead);
});

test('history service checks booking existence and parses snapshots and three-state communication flags', async () => {
  const calls = [];
  const before = { lesson_id: 'L001', version: 1 };
  const after = { lesson_id: 'L001', version: 2 };
  const service = createBookingChangeService({
    bookingService: { getBooking(id) { calls.push(['booking', id]); return before; } },
    bookingChangeRepository: { findByLessonId(id) {
      calls.push(['history', id]);
      return [null, 0, 1].map((flag, index) => ({ id: index + 1, lesson_id: id,
        before_snapshot: index === 0 ? null : JSON.stringify(before),
        after_snapshot: JSON.stringify(after), needs_manual_communication: flag }));
    } },
  });
  const changes = await service.listChanges('L001');
  assert.deepEqual(calls, [['booking', 'L001'], ['history', 'L001']]);
  assert.deepEqual(changes.map((item) => item.needs_manual_communication), [null, false, true]);
  assert.equal(changes[0].before_snapshot, null);
  assert.deepEqual(changes[1].before_snapshot, before);
  assert.deepEqual(changes[2].after_snapshot, after);
});

test('history service preserves empty histories, missing-booking errors, and repository failures', async () => {
  const failure = new AppError(404, 'BOOKING_NOT_FOUND', 'Missing booking.');
  const missing = createBookingChangeService({
    bookingService: { getBooking() { throw failure; } },
    bookingChangeRepository: { findByLessonId() { assert.fail('Missing booking queried history'); } },
  });
  await assert.rejects(missing.listChanges('missing'), (error) => error === failure);
  const empty = createBookingChangeService({ bookingService: { getBooking: () => ({}) },
    bookingChangeRepository: { findByLessonId: () => [] } });
  assert.deepEqual(await empty.listChanges('L001'), []);
  const broken = createBookingChangeService({ bookingService: { getBooking: () => ({}) },
    bookingChangeRepository: { findByLessonId() { throw failure; } } });
  await assert.rejects(broken.listChanges('L001'), (error) => error === failure);
});

test('history controller passes the booking ID and returns the standard envelope', async () => {
  const items = [{ id: 1, lesson_id: 'L001', action: 'imported' }];
  const controller = createBookingChangeController({ bookingChangeService: {
    listChanges(id) { assert.equal(id, 'L001'); return items; },
  }, now });
  const res = responseDouble();
  await controller.list({ params: { lesson_id: 'L001' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { data: { items },
    code: { http_status: 200, key: 'BOOKING_CHANGES_RETRIEVED', message: 'Booking history retrieved successfully.' },
    timestamp: { iso: responseTime } });
  const failure = new Error('history unavailable');
  const broken = createBookingChangeController({ bookingChangeService: { listChanges() { throw failure; } } });
  await assert.rejects(broken.list({ params: { lesson_id: 'L001' } }, responseDouble()), (error) => error === failure);
});

test('history router preserves parent IDs, supports read methods, and rejects mutations', async () => {
  const calls = [];
  const router = createBookingChangeRouter({ bookingChangeController: {
    list(req, res) { calls.push([req.method, req.params.lesson_id]); res.end(); },
  } });
  await invokeRouter(router, 'GET', '/', { lesson_id: 'L001' });
  await invokeRouter(router, 'HEAD', '/', { lesson_id: 'L005' });
  assert.deepEqual(calls, [['GET', 'L001'], ['HEAD', 'L005']]);
  assert.equal((await invokeRouter(router, 'OPTIONS')).res.statusCode, 204);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const { error, res } = await invokeRouter(router, method);
    assert.equal(error.httpStatus, 405);
    assert.equal(res.headers.Allow, 'GET, HEAD, OPTIONS');
  }
});

test('history HTTP reads return parsed baseline states and preserve the full seed database', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database, now }));
  for (const id of ['L001', 'L005', 'L015', 'L032']) {
    const response = await fetch(`${origin}/api/v1/bookings/${id}/changes`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.code.key, 'BOOKING_CHANGES_RETRIEVED');
    assert.equal(body.data.items.length, 1);
    const change = body.data.items[0];
    assert.equal(change.action, 'imported');
    assert.equal(change.lesson_id, id);
    assert.equal(change.before_snapshot, null);
    assert.equal(change.needs_manual_communication, null);
    assert.deepEqual(change.after_snapshot, { ...database.prepare('SELECT * FROM bookings WHERE lesson_id = ?').get(id) });
  }
  assert.equal(verifySeedDatabase(database).booking_changes, 34);
});

test('history HTTP errors and bodyless responses follow the API contract', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  const path = `${origin}/api/v1/bookings/L001/changes`;
  const head = await fetch(path, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const options = await fetch(path, { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  assert.equal(await options.text(), '');
  const missing = await fetch(`${origin}/api/v1/bookings/missing/changes`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code.key, 'BOOKING_NOT_FOUND');
  const blank = await fetch(`${origin}/api/v1/bookings/%20/changes`);
  assert.equal(blank.status, 422);
  assert.equal((await blank.json()).code.key, 'INVALID_BOOKING_ID');
  const mutation = await fetch(path, { method: 'POST' });
  assert.equal(mutation.status, 405);
  assert.equal((await mutation.json()).code.key, 'METHOD_NOT_ALLOWED');
});
