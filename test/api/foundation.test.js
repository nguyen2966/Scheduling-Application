import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { defaultReferenceTime, loadConfig, projectRoot } from '../../src/config.js';
import { AppError } from '../../src/api/errors/app-error.js';
import { createErrorHandler } from '../../src/api/middleware/error-handler.js';
import { sendResponse } from '../../src/api/response.js';
import { now, responseDouble, responseTime } from './helpers.js';

test('configuration supplies defaults and accepts explicit host, port, and database path', () => {
  assert.deepEqual(loadConfig({}), {
    host: '127.0.0.1', port: 3000, databasePath: join(projectRoot, 'data', 'bright-path.sqlite'),
    timeZone: 'Asia/Ho_Chi_Minh', referenceTime: defaultReferenceTime,
  });
  assert.deepEqual(loadConfig({ HOST: 'localhost', PORT: '4100', DATABASE_PATH: 'data/other.sqlite' }), {
    host: 'localhost', port: 4100, databasePath: join(projectRoot, 'data', 'other.sqlite'),
    timeZone: 'Asia/Ho_Chi_Minh', referenceTime: defaultReferenceTime,
  });
  assert.equal(loadConfig({ PORT: '0' }).port, 0);
  assert.equal(loadConfig({ REFERENCE_TIME: '2026-03-03T16:00:00+07:00' }).referenceTime, '2026-03-03T16:00:00+07:00');
});

test('configuration rejects invalid ports and blank or whitespace-containing hosts', () => {
  for (const PORT of ['', '-1', '65536', '3.5', '3000oops', ' 3000']) {
    assert.throws(() => loadConfig({ PORT }), /PORT/);
  }
  for (const HOST of ['', '  ', 'local host']) assert.throws(() => loadConfig({ HOST }), /HOST/);
  for (const REFERENCE_TIME of ['', '2026-03-03T16:00:00', '2026-02-30T09:00:00Z']) {
    assert.throws(() => loadConfig({ REFERENCE_TIME }), /REFERENCE_TIME/);
  }
});

test('known application errors retain their status, safe details, and timestamp', () => {
  const failure = new AppError(422, 'INVALID_INPUT', 'Choose a valid room.', { details: { field: 'room' } });
  const res = responseDouble();
  createErrorHandler({ now, logger: { error() { assert.fail('Known error was logged as unexpected'); } } })
    (failure, {}, res, () => assert.fail('Unexpected fallthrough'));
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.body, {
    data: { details: { field: 'room' } },
    code: { http_status: 422, key: 'INVALID_INPUT', message: 'Choose a valid room.' },
    timestamp: { iso: responseTime },
  });
});

test('unexpected errors are logged once and their internal messages are hidden', () => {
  const logs = [];
  const error = new Error('SELECT private_student FROM secret_table');
  const res = responseDouble();
  createErrorHandler({ now, logger: { error: (...args) => logs.push(args) } })(error, {}, res, () => {});
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.code.key, 'INTERNAL_SERVER_ERROR');
  assert.deepEqual(res.body.data, {});
  assert.equal(logs.length, 1);
  assert.doesNotMatch(JSON.stringify([res.body, logs]), /private_student|secret_table/);
});

test('parser errors have matching HTTP statuses and stable keys', () => {
  const handler = createErrorHandler({ now });
  for (const [type, status, key] of [
    ['entity.parse.failed', 400, 'INVALID_JSON'],
    ['entity.too.large', 413, 'PAYLOAD_TOO_LARGE'],
    ['charset.unsupported', 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['encoding.unsupported', 415, 'UNSUPPORTED_MEDIA_TYPE'],
  ]) {
    const res = responseDouble();
    handler(Object.assign(new Error('parser internals'), { type }), {}, res, () => {});
    assert.equal(res.statusCode, status);
    assert.equal(res.body.code.http_status, status);
    assert.equal(res.body.code.key, key);
  }
});

test('error middleware delegates when headers have already been sent', () => {
  const failure = new Error('late failure');
  const res = responseDouble();
  res.headersSent = true;
  let forwarded;
  createErrorHandler()(failure, {}, res, (error) => { forwarded = error; });
  assert.equal(forwarded, failure);
  assert.equal(res.body, undefined);
});

test('bodyless response statuses never produce a JSON envelope', () => {
  for (const status of [204, 304]) {
    const res = responseDouble();
    sendResponse(res, { status }, () => assert.fail('Bodyless response used a clock'));
    assert.equal(res.statusCode, status);
    assert.equal(res.ended, true);
    assert.equal(res.body, undefined);
  }
});
