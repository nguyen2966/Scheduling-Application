import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRoomRepository } from '../../src/api/repositories/rooms.js';
import { createRoomService } from '../../src/api/services/rooms.js';
import { createRoomController } from '../../src/api/controllers/rooms.js';
import { createRoomRouter } from '../../src/api/routes/rooms.js';
import { AppError } from '../../src/api/errors/app-error.js';
import { openDatabase } from '../../src/db/connection.js';
import { now, responseDouble, responseTime, roomItems } from './helpers.js';

test('room repository reads every room in stable order without writing', (t) => {
  const database = openDatabase(':memory:');
  t.after(() => database.close());
  database.exec(readFileSync(new URL('../../src/db/schema.sql', import.meta.url), 'utf8'));
  const insert = database.prepare('INSERT INTO rooms (room_id) VALUES (?)');
  for (const room of [...roomItems].reverse()) insert.run(room.room_id);
  const repository = createRoomRepository({ database });
  const before = database.prepare('SELECT total_changes() AS count').get().count;
  assert.deepEqual(repository.findAll(), roomItems);
  assert.deepEqual(repository.findAll(), roomItems);
  assert.equal(database.prepare('SELECT total_changes() AS count').get().count, before);
});

test('room service delegates to its repository and preserves its result', () => {
  let calls = 0;
  const service = createRoomService({ roomRepository: { findAll() { calls++; return roomItems; } } });
  assert.equal(service.listRooms(), roomItems);
  assert.equal(calls, 1);
});

test('room service supports an empty repository and propagates failures', async () => {
  assert.deepEqual(createRoomService({ roomRepository: { findAll: () => [] } }).listRooms(), []);
  const failure = new Error('repository unavailable');
  const service = createRoomService({ roomRepository: { findAll() { throw failure; } } });
  assert.throws(() => service.listRooms(), (error) => error === failure);
  const asyncService = createRoomService({ roomRepository: { findAll: async () => { throw failure; } } });
  await assert.rejects(asyncService.listRooms(), (error) => error === failure);
});

test('room controller returns the service result with the required response envelope', async () => {
  let calls = 0;
  const controller = createRoomController({
    roomService: { async listRooms() { calls++; return roomItems; } }, now,
  });
  const res = responseDouble();
  await controller.list({}, res);
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    data: { items: roomItems },
    code: { http_status: 200, key: 'ROOMS_RETRIEVED', message: 'Rooms retrieved successfully.' },
    timestamp: { iso: responseTime },
  });
});

test('room controller rejects service failures for Express 5 to forward centrally', async () => {
  const failure = new Error('service failure');
  const controller = createRoomController({ roomService: { listRooms: async () => { throw failure; } } });
  const res = responseDouble();
  await assert.rejects(controller.list({}, res), (error) => error === failure);
  assert.equal(res.body, undefined);
});

function invokeRouter(router, method, url = '/') {
  return new Promise((resolve) => {
    const res = responseDouble();
    res.end = () => { res.ended = true; resolve({ res }); return res; };
    router.handle({ method, url, headers: {} }, res, (error) => resolve({ error, res, unmatched: !error }));
  });
}

test('room router dispatches GET and HEAD to its injected controller', async () => {
  const methods = [];
  const router = createRoomRouter({ roomController: {
    list(req, res) { methods.push(req.method); res.end(); },
  } });
  await invokeRouter(router, 'GET');
  await invokeRouter(router, 'HEAD');
  assert.deepEqual(methods, ['GET', 'HEAD']);
});

test('room router handles OPTIONS without a body or controller call', async () => {
  const router = createRoomRouter({ roomController: { list() { assert.fail('Unexpected controller call'); } } });
  const { res } = await invokeRouter(router, 'OPTIONS');
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.equal(res.body, undefined);
  assert.equal(res.headers.Allow, 'GET, HEAD, OPTIONS');
});

test('room router rejects unsupported methods and leaves unknown paths unmatched', async () => {
  const router = createRoomRouter({ roomController: { list() { assert.fail('Unexpected controller call'); } } });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const { error, res } = await invokeRouter(router, method);
    assert.ok(error instanceof AppError);
    assert.equal(error.httpStatus, 405);
    assert.equal(error.code, 'METHOD_NOT_ALLOWED');
    assert.equal(res.headers.Allow, 'GET, HEAD, OPTIONS');
  }
  assert.equal((await invokeRouter(router, 'GET', '/R1')).unmatched, true);
});
