import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { verifySeedDatabase } from '../../src/db/verify-seed.js';
import { now, responseTime, roomItems, seededDatabase, serve } from './helpers.js';

test('rooms HTTP endpoint returns all six rooms and does not change seed data', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database, now }));
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`${origin}/api/v1/rooms`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(response.headers.has('x-powered-by'), false);
    assert.deepEqual(await response.json(), {
      data: { items: roomItems },
      code: { http_status: 200, key: 'ROOMS_RETRIEVED', message: 'Rooms retrieved successfully.' },
      timestamp: { iso: responseTime },
    });
  }
  assert.equal(verifySeedDatabase(database).bookings, 34);
});

test('HEAD and OPTIONS obey bodyless HTTP semantics', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  const head = await fetch(`${origin}/api/v1/rooms`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.match(head.headers.get('content-type'), /application\/json/);
  assert.equal(await head.text(), '');
  const options = await fetch(`${origin}/api/v1/rooms`, { method: 'OPTIONS' });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('allow'), 'GET, HEAD, OPTIONS');
  assert.equal(await options.text(), '');
});

test('unsupported room mutations return 405 and unknown API paths return 404', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(`${origin}/api/v1/rooms`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD, OPTIONS');
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ['code', 'data', 'timestamp']);
    assert.equal(body.code.http_status, 405);
    assert.equal(body.code.key, 'METHOD_NOT_ALLOWED');
  }
  for (const path of ['/api/v1/missing', '/api/v1/rooms/R1']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code.key, 'RESOURCE_NOT_FOUND');
  }
  assert.equal(verifySeedDatabase(database).rooms, 6);
});

test('JSON parsing failures use the API error envelope', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  for (const [body, contentType, expectedStatus, expectedKey] of [
    ['{"broken":', 'application/json', 400, 'INVALID_JSON'],
    [JSON.stringify({ note: 'x'.repeat(17000) }), 'application/json', 413, 'PAYLOAD_TOO_LARGE'],
    ['{}', 'application/json; charset=iso-8859-1', 415, 'UNSUPPORTED_MEDIA_TYPE'],
  ]) {
    const response = await fetch(`${origin}/api/v1/rooms`, {
      method: 'POST', headers: { 'Content-Type': contentType }, body,
    });
    assert.equal(response.status, expectedStatus);
    const payload = await response.json();
    assert.equal(payload.code.http_status, expectedStatus);
    assert.equal(payload.code.key, expectedKey);
    assert.deepEqual(payload.data, {});
  }
});

test('repository failures travel through all layers to the central safe error handler', async (t) => {
  const database = seededDatabase(t);
  const logs = [];
  const origin = await serve(t, createApp({ database, logger: { error: (...args) => logs.push(args) } }));
  database.close();
  const response = await fetch(`${origin}/api/v1/rooms`);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.code.key, 'INTERNAL_SERVER_ERROR');
  assert.deepEqual(body.data, {});
  assert.doesNotMatch(JSON.stringify(body), /SQLITE|SELECT|closed|stack/i);
  assert.equal(logs.length, 1);
});
