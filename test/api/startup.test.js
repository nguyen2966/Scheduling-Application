import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { defaultReferenceTime, projectRoot } from '../../src/config.js';
import { openDatabase } from '../../src/db/connection.js';
import { setupDatabase } from '../../src/db/import-seed.js';
import { verifySeedDatabase } from '../../src/db/verify-seed.js';
import { roomItems } from './helpers.js';

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

function workspace(t) {
  const parent = resolve(tmpdir());
  const directory = mkdtempSync(join(parent, 'bright-path-api-'));
  const children = [];
  t.after(async () => {
    for (const child of children) await stop(child);
    assert.equal(dirname(directory), parent);
    assert.ok(basename(directory).startsWith('bright-path-api-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const path = join(directory, 'app.sqlite');
  const options = (extra) => ({
    cwd: directory,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATABASE_PATH: path,
      REFERENCE_TIME: defaultReferenceTime, ...extra },
  });
  return {
    path,
    run(extra) {
      return spawnSync(process.execPath, [join(projectRoot, 'index.js')], {
        ...options(extra), encoding: 'utf8', timeout: 5000,
      });
    },
    start() {
      const child = spawn(process.execPath, [join(projectRoot, 'index.js')], options());
      children.push(child);
      return child;
    },
  };
}

function waitForUrl(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${stderr}`)), 5000);
    const fail = (error) => { clearTimeout(timer); reject(error); };
    child.on('error', fail);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = /API listening at (http:\/\/127\.0\.0\.1:\d+\/api\/v1)/.exec(stdout);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once('exit', (code) => fail(new Error(`Server exited with ${code}: ${stderr}`)));
  });
}

test('real entry point serves read APIs on localhost and restarts without changing data', { timeout: 15000 }, async (t) => {
  const fixture = workspace(t);
  const database = openDatabase(fixture.path);
  setupDatabase(database);
  database.close();

  for (let attempt = 0; attempt < 2; attempt++) {
    const child = fixture.start();
    const url = await waitForUrl(child);
    const response = await fetch(`${url}/rooms`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.data.items, roomItems);
    assert.equal(body.code.http_status, 200);
    assert.ok(Number.isFinite(Date.parse(body.timestamp.iso)));
    const tutorResponse = await fetch(`${url}/tutors`, { signal: AbortSignal.timeout(5000) });
    assert.equal(tutorResponse.status, 200);
    assert.deepEqual((await tutorResponse.json()).data.items.map((item) => item.tutor_id), ['T1', 'T2', 'T3']);
    const bookings = await fetch(`${url}/bookings?from=2026-03-04&to=2026-03-05&room=R1`);
    assert.equal(bookings.status, 200);
    assert.deepEqual((await bookings.json()).data.items.map((item) => item.lesson_id), ['L009', 'L010']);
    const detail = await fetch(`${url}/bookings/L001`);
    assert.equal(detail.status, 200);
    assert.equal(detail.headers.get('etag'), '"booking-L001-v1"');
    assert.equal((await detail.json()).data.booking.lesson_id, 'L001');
    const history = await fetch(`${url}/bookings/L001/changes`);
    assert.equal(history.status, 200);
    const changes = (await history.json()).data.items;
    assert.equal(changes.length, 1);
    assert.equal(changes[0].action, 'imported');
    assert.equal(changes[0].after_snapshot.lesson_id, 'L001');
    t.diagnostic(`Localhost smoke test passed: ${url}/rooms`);
    await stop(child);
  }

  const saved = openDatabase(fixture.path, { readOnly: true });
  try {
    assert.equal(verifySeedDatabase(saved).booking_changes, 34);
  } finally {
    saved.close();
  }
});

test('startup fails clearly for missing databases, uninitialized schemas, and invalid configuration', (t) => {
  const fixture = workspace(t);
  const missing = fixture.run();
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, /Database not found.*npm run db:setup/);
  assert.equal(existsSync(fixture.path), false);

  const database = openDatabase(fixture.path);
  database.close();
  const uninitialized = fixture.run();
  assert.equal(uninitialized.status, 1, uninitialized.stderr);
  assert.match(uninitialized.stderr, /schema is not initialized or supported/);
  const saved = openDatabase(fixture.path, { readOnly: true });
  try {
    assert.deepEqual(saved.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all(), []);
  } finally {
    saved.close();
  }
  const invalidPort = fixture.run({ PORT: 'invalid' });
  assert.equal(invalidPort.status, 1, invalidPort.stderr);
  assert.match(invalidPort.stderr, /PORT must be an integer/);
});

test('an occupied port causes a controlled startup failure', async (t) => {
  const fixture = workspace(t);
  const database = openDatabase(fixture.path);
  setupDatabase(database);
  database.close();
  const blocker = createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  try {
    const result = fixture.run({ PORT: String(blocker.address().port) });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Application startup failed:.*EADDRINUSE/);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test('concurrent localhost app processes create only one conflicting booking and preserve it after restart', { timeout: 20000 }, async (t) => {
  const fixture = workspace(t);
  const database = openDatabase(fixture.path);
  setupDatabase(database);
  database.close();
  const first = fixture.start();
  const second = fixture.start();
  const urls = await Promise.all([waitForUrl(first), waitForUrl(second)]);
  const input = { student: 'Concurrent Student', tutor_id: 'T2', room: 'R6',
    date: '2026-03-07', start_time: '13:00', duration_min: 90 };
  const responses = await Promise.all(urls.map((url) => fetch(`${url}/bookings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    signal: AbortSignal.timeout(10000),
  })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  const created = bodies[responses.findIndex((response) => response.status === 201)].data.booking;
  const rejected = bodies[responses.findIndex((response) => response.status === 409)];
  assert.equal(rejected.code.key, 'STUDENT_SCHEDULE_CONFLICT');
  await stop(first);
  await stop(second);

  const restarted = fixture.start();
  const url = await waitForUrl(restarted);
  const detail = await fetch(`${url}/bookings/${created.lesson_id}`);
  assert.equal(detail.status, 200);
  assert.deepEqual((await detail.json()).data.booking, created);
  const history = await fetch(`${url}/bookings/${created.lesson_id}/changes`);
  const changes = (await history.json()).data.items;
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'created');
  assert.deepEqual(changes[0].after_snapshot, created);
  assert.equal(changes[0].needs_manual_communication, false);
  await stop(restarted);
  const saved = openDatabase(fixture.path, { readOnly: true });
  try {
    assert.equal(saved.prepare('SELECT count(*) AS count FROM bookings').get().count, 35);
    assert.equal(saved.prepare('SELECT count(*) AS count FROM booking_changes').get().count, 35);
    assert.equal(saved.prepare("SELECT count(*) AS count FROM booking_changes WHERE action = 'imported'").get().count, 34);
  } finally {
    saved.close();
  }
  t.diagnostic(`Create-booking localhost race and restart passed for ${created.lesson_id}`);
});
