import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { verifySeedDatabase } from '../../src/db/verify-seed.js';
import { now, seededDatabase, serve } from './helpers.js';

test('booking HTTP reads preserve historical collisions, statuses, and closed-day records', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database, now }));
  for (const [query, expected] of [
    ['', 34], ['?from=2026-03-03&to=2026-03-04', 6],
    ['?from=2026-03-04&to=2026-03-05&room=R1', ['L009', 'L010']],
    ['?from=2026-03-09&to=2026-03-10', ['L032']],
    ['?from=2026-03-10&to=2026-03-11', ['L033', 'L034']],
    ['?room=R6', []],
  ]) {
    const response = await fetch(`${origin}/api/v1/bookings${query}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.code.key, 'BOOKINGS_RETRIEVED');
    if (Array.isArray(expected)) assert.deepEqual(body.data.items.map((item) => item.lesson_id), expected);
    else assert.equal(body.data.items.length, expected);
  }
  for (const [id, status] of [['L005', 'cancelled'], ['L015', 'no_show']]) {
    const response = await fetch(`${origin}/api/v1/bookings/${id}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.booking.status, status);
    assert.equal(body.data.booking.version, 1);
  }
  assert.equal(verifySeedDatabase(database).bookings, 34);
});

test('booking detail has a version ETag and supports conditional GET, HEAD, and OPTIONS', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  const url = `${origin}/api/v1/bookings/L001`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('etag'), '"booking-L001-v1"');
  const booking = (await response.json()).data.booking;
  assert.equal(booking.lesson_id, 'L001');
  assert.equal(booking.student, 'Le Minh Chau');
  assert.equal(booking.cancelled_at, null);
  // Node fetch otherwise adds Cache-Control: no-cache to conditional requests.
  const cached = await fetch(url, { headers: {
    'If-None-Match': '"booking-L001-v1"', 'Cache-Control': 'max-age=0',
  } });
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('etag'), '"booking-L001-v1"');
  assert.equal(await head.text(), '');
  const options = await fetch(url, { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('allow'), 'GET, HEAD, OPTIONS');
  assert.equal(await options.text(), '');
});

test('invalid booking filters return 422, missing IDs return 404, and malformed URL encoding returns 400', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  for (const query of ['?from=2026-02-30', '?to=invalid', '?room=R7', '?room=',
    '?from=2026-03-05&to=2026-03-04', '?from=2026-03-03&from=2026-03-04',
    '?room=R1&room=R2', '?unexpected=value']) {
    const response = await fetch(`${origin}/api/v1/bookings${query}`);
    assert.equal(response.status, 422, query);
    const body = await response.json();
    assert.equal(body.code.http_status, 422);
    assert.equal(body.code.key, 'INVALID_BOOKING_FILTER');
    assert.ok(body.data.details.field);
  }
  for (const id of ['missing', encodeURIComponent("L001' OR 1=1 --")]) {
    const response = await fetch(`${origin}/api/v1/bookings/${id}`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code.key, 'BOOKING_NOT_FOUND');
  }
  const malformed = await fetch(`${origin}/api/v1/bookings/%E0%A4%A`);
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code.key, 'INVALID_PATH');
});

test('booking writes remain unavailable and do not alter seed data', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  for (const [path, method] of [['/bookings', 'POST'], ['/bookings/L001', 'PATCH'], ['/bookings/L001', 'DELETE']]) {
    const response = await fetch(`${origin}/api/v1${path}`, { method });
    assert.equal(response.status, 405);
    assert.equal((await response.json()).code.key, 'METHOD_NOT_ALLOWED');
  }
  assert.equal(verifySeedDatabase(database).booking_changes, 34);
});
