import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { createTutorRepository } from '../../src/api/repositories/tutors.js';
import { createTutorService } from '../../src/api/services/tutors.js';
import { createTutorController } from '../../src/api/controllers/tutors.js';
import { createTutorRouter } from '../../src/api/routes/tutors.js';
import { verifySeedDatabase } from '../../src/db/verify-seed.js';
import { invokeRouter, now, responseDouble, responseTime, seededDatabase, serve } from './helpers.js';

const tutors = [
  { tutor_id: 'T1', tutor_name: 'Ngoc Anh', subject: 'Maths', phone: '090xxx1122' },
  { tutor_id: 'T2', tutor_name: 'Pham Duc', subject: 'English', phone: '090xxx3344' },
  { tutor_id: 'T3', tutor_name: 'Le Thu', subject: 'Physics', phone: '090xxx5566' },
];

test('tutor repository returns every tutor and preserves imported contact text', (t) => {
  const database = seededDatabase(t);
  const before = database.prepare('SELECT total_changes() AS count').get().count;
  assert.deepEqual(createTutorRepository({ database }).findAll(), tutors);
  assert.equal(database.prepare('SELECT total_changes() AS count').get().count, before);
});

test('tutor service delegates, supports empty results, and propagates repository failures', () => {
  let calls = 0;
  const service = createTutorService({ tutorRepository: { findAll() { calls++; return tutors; } } });
  assert.equal(service.listTutors(), tutors);
  assert.equal(calls, 1);
  assert.deepEqual(createTutorService({ tutorRepository: { findAll: () => [] } }).listTutors(), []);
  const failure = new Error('unavailable');
  assert.throws(() => createTutorService({ tutorRepository: { findAll() { throw failure; } } }).listTutors(),
    (error) => error === failure);
});

test('tutor controller sends the standard envelope and rejects service failures', async () => {
  const controller = createTutorController({ tutorService: { listTutors: async () => tutors }, now });
  const res = responseDouble();
  await controller.list({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    data: { items: tutors },
    code: { http_status: 200, key: 'TUTORS_RETRIEVED', message: 'Tutors retrieved successfully.' },
    timestamp: { iso: responseTime },
  });
  const failure = new Error('unavailable');
  const failing = createTutorController({ tutorService: { listTutors: async () => { throw failure; } } });
  await assert.rejects(failing.list({}, responseDouble()), (error) => error === failure);
});

test('tutor router dispatches reads, handles OPTIONS, and rejects mutations', async () => {
  const methods = [];
  const router = createTutorRouter({ tutorController: {
    list(req, res) { methods.push(req.method); res.end(); },
  } });
  await invokeRouter(router, 'GET');
  await invokeRouter(router, 'HEAD');
  assert.deepEqual(methods, ['GET', 'HEAD']);
  const options = await invokeRouter(router, 'OPTIONS');
  assert.equal(options.res.statusCode, 204);
  assert.equal(options.res.headers.Allow, 'GET, HEAD, OPTIONS');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const { error, res } = await invokeRouter(router, method);
    assert.equal(error.httpStatus, 405);
    assert.equal(res.headers.Allow, 'GET, HEAD, OPTIONS');
  }
  assert.equal((await invokeRouter(router, 'GET', '/T1')).unmatched, true);
});

test('tutor HTTP reads return the complete source data without changing the database', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database, now }));
  const response = await fetch(`${origin}/api/v1/tutors`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.items, tutors);
  const head = await fetch(`${origin}/api/v1/tutors`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const rejected = await fetch(`${origin}/api/v1/tutors`, { method: 'POST' });
  assert.equal(rejected.status, 405);
  assert.equal((await rejected.json()).code.key, 'METHOD_NOT_ALLOWED');
  assert.equal(verifySeedDatabase(database).tutors, 3);
});
