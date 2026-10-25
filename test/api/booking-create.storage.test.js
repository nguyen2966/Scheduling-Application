import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { createRoomRepository } from '../../src/api/repositories/rooms.js';
import { createTutorRepository } from '../../src/api/repositories/tutors.js';
import { createBookingRepository } from '../../src/api/repositories/bookings.js';
import { createBookingChangeRepository } from '../../src/api/repositories/booking-changes.js';
import { openDatabase } from '../../src/db/connection.js';
import { setupDatabase } from '../../src/db/import-seed.js';
import { withWriteTransaction } from '../../src/db/transaction.js';
import { verifySeedDatabase } from '../../src/db/verify-seed.js';
import { now, seededDatabase, serve } from './helpers.js';

test('repositories query references, occupying lessons, and counted daily bookings from SQLite', (t) => {
  const database = seededDatabase(t);
  const rooms = createRoomRepository({ database });
  const tutors = createTutorRepository({ database });
  const bookings = createBookingRepository({ database });
  assert.deepEqual(rooms.findById('R6'), { room_id: 'R6' });
  assert.equal(rooms.findById('R7'), null);
  assert.equal(tutors.findById('T1').phone, '090xxx1122');
  assert.equal(tutors.findById('missing'), null);
  const occupied = bookings.findOccupying({ from: '2026-03-05', to: '2026-03-06' });
  assert.ok(occupied.some((booking) => booking.lesson_id === 'L015'));
  assert.ok(!occupied.some((booking) => booking.lesson_id === 'L017'));
  assert.equal(bookings.countTutorDaily('T2', '2026-03-03'), 1);
  assert.equal(bookings.countTutorDaily('T2', '2026-03-05'), 1);
  assert.equal(bookings.countTutorDaily('T1', '2026-03-06'), 7);
});

test('booking and audit repositories commit together and a failure rolls back both inserts', (t) => {
  const database = seededDatabase(t);
  const bookings = createBookingRepository({ database });
  const changes = createBookingChangeRepository({ database });
  const candidate = { lesson_id: 'B-storage', date: '2026-03-07', start_time: '13:00', duration_min: 90,
    student: 'New Student', tutor_id: 'T2', room: 'R6', status: 'booked', cancelled_at: null, note: null, version: 1 };
  const save = () => {
    const saved = bookings.insert(candidate);
    changes.insert({ lesson_id: saved.lesson_id, action: 'created', changed_at: now().toISOString(),
      before_snapshot: null, after_snapshot: saved, reason: null, needs_manual_communication: false });
    return saved;
  };
  const failure = new Error('late failure');
  assert.throws(() => withWriteTransaction(database, () => { save(); throw failure; }), (error) => error === failure);
  assert.equal(database.isTransaction, false);
  assert.equal(verifySeedDatabase(database).bookings, 34);
  assert.deepEqual(withWriteTransaction(database, save), candidate);
  assert.deepEqual(bookings.findById(candidate.lesson_id), candidate);
  const history = changes.findByLessonId(candidate.lesson_id);
  assert.equal(history.length, 1);
  assert.deepEqual(JSON.parse(history[0].after_snapshot), candidate);
  assert.equal(history[0].needs_manual_communication, 0);
});

test('transaction helper refuses asynchronous callbacks and releases locks after failure', (t) => {
  const database = seededDatabase(t);
  let called = false;
  assert.throws(() => withWriteTransaction(database, async () => { called = true; }), /synchronous operation/);
  assert.equal(called, false);
  assert.throws(() => withWriteTransaction(database, () => Promise.resolve()), /synchronous operation/);
  assert.equal(database.isTransaction, false);
  assert.equal(withWriteTransaction(database, () => 'next operation'), 'next operation');
});

test('a competing connection cannot validate before acquiring the write lock; HTTP returns safe 503', async (t) => {
  const parent = resolve(tmpdir());
  const directory = mkdtempSync(join(parent, 'bright-path-lock-'));
  const path = join(directory, 'shared.sqlite');
  const owner = openDatabase(path);
  setupDatabase(owner);
  const contender = openDatabase(path);
  contender.exec('PRAGMA busy_timeout = 1');
  t.after(() => {
    for (const database of [contender, owner]) {
      if (database.isOpen) database.close();
    }
    assert.equal(dirname(directory), parent);
    assert.ok(basename(directory).startsWith('bright-path-lock-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const origin = await serve(t, createApp({ database: contender }));
  owner.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(() => withWriteTransaction(contender, () => assert.fail('Validated without the write lock')),
      (error) => (error.errcode & 0xff) === 5);
    const response = await fetch(`${origin}/api/v1/bookings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student: 'Lock Test', tutor_id: 'T2', room: 'R6',
        date: '2026-03-07', start_time: '13:00', duration_min: 60 }),
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code.key, 'DATABASE_UNAVAILABLE');
    assert.deepEqual(body.data, {});
    assert.equal(contender.isTransaction, false);
  } finally {
    owner.exec('ROLLBACK');
  }
  assert.equal(verifySeedDatabase(contender).bookings, 34);
});
