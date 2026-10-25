import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { projectRoot, seedDataDirectory } from '../src/config.js';
import { openDatabase } from '../src/db/connection.js';
import { setupDatabase } from '../src/db/import-seed.js';
import { verifySeedDatabase } from '../src/db/verify-seed.js';

const expectedCounts = { tutors: 3, rooms: 6, bookings: 34, booking_changes: 34 };
const importTime = '2026-03-03T06:00:00.000Z';
const now = () => new Date(importTime);
const tutorCsv = readFileSync(join(seedDataDirectory, 'tutors.csv'), 'utf8');
const lessonCsv = readFileSync(join(seedDataDirectory, 'lessons_export.csv'), 'utf8');
const schemaSql = readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');

function temporaryDirectory(t) {
  const parent = resolve(tmpdir());
  const directory = mkdtempSync(join(parent, 'bright-path-db-'));
  t.after(() => {
    // Only recursively remove this test's explicitly created temporary directory.
    assert.equal(dirname(directory), parent);
    assert.ok(basename(directory).startsWith('bright-path-db-'));
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function databaseFor(t) {
  const database = openDatabase(':memory:');
  t.after(() => database.close());
  return database;
}

function fixture(t, lessons = lessonCsv, tutors = tutorCsv) {
  const directory = temporaryDirectory(t);
  writeFileSync(join(directory, 'tutors.csv'), tutors);
  writeFileSync(join(directory, 'lessons_export.csv'), lessons);
  return directory;
}

test('imports the entire seed unchanged, including historical scheduling violations', (t) => {
  const database = databaseFor(t);
  assert.deepEqual(setupDatabase(database, { now }), expectedCounts);
  assert.deepEqual(verifySeedDatabase(database), expectedCounts);
  assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(database.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(database.prepare("SELECT phone FROM tutors WHERE tutor_id = 'T1'").get().phone, '090xxx1122');
  assert.equal(database.prepare("SELECT date FROM bookings WHERE lesson_id = 'L032'").get().date, '2026-03-09');
  assert.equal(database.prepare("SELECT status FROM bookings WHERE lesson_id = 'L015'").get().status, 'no_show');
  assert.equal(database.prepare("SELECT cancelled_at FROM bookings WHERE lesson_id = 'L005'").get().cancelled_at,
    '2026-03-03T08:15:00+07:00');
  assert.equal(database.prepare(`SELECT count(*) AS count FROM bookings
    WHERE tutor_id = 'T1' AND date = '2026-03-06' AND status IN ('booked', 'no_show')`).get().count, 7);
  assert.equal(database.prepare(`SELECT count(*) AS count FROM bookings
    WHERE tutor_id = 'T1' AND date = '2026-03-04' AND start_time = '11:00' AND room = 'R1'`).get().count, 2);
  const change = database.prepare("SELECT * FROM booking_changes WHERE lesson_id = 'L001'").get();
  assert.equal(change.changed_at, importTime);
  assert.equal(change.before_snapshot, null);
  assert.equal(change.needs_manual_communication, null);
  assert.deepEqual(JSON.parse(change.after_snapshot),
    { ...database.prepare("SELECT * FROM bookings WHERE lesson_id = 'L001'").get() });
  assert.equal(readFileSync(join(seedDataDirectory, 'tutors.csv'), 'utf8'), tutorCsv);
  assert.equal(readFileSync(join(seedDataDirectory, 'lessons_export.csv'), 'utf8'), lessonCsv);
});

test('repeated setup refuses to overwrite staff changes or duplicate history', (t) => {
  const database = databaseFor(t);
  setupDatabase(database, { now });
  database.exec("UPDATE bookings SET note = 'staff edit' WHERE lesson_id = 'L001'");
  assert.throws(() => setupDatabase(database), /already contains data/);
  assert.equal(database.prepare("SELECT note FROM bookings WHERE lesson_id = 'L001'").get().note, 'staff edit');
  assert.equal(database.prepare('SELECT count(*) AS count FROM booking_changes').get().count, 34);
  assert.equal(database.isTransaction, false);
});

test('a late foreign key failure rolls back schema, tutors, rooms, bookings, and history', (t) => {
  const database = databaseFor(t);
  const dataDirectory = fixture(t, lessonCsv.replace('Tran Bao Long,T1,R2,booked', 'Tran Bao Long,UNKNOWN,R2,booked'));
  assert.throws(() => setupDatabase(database, { dataDirectory }), /L034.*FOREIGN KEY/);
  assert.equal(database.prepare('PRAGMA user_version').get().user_version, 0);
  assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all(), []);
  assert.deepEqual(setupDatabase(database, { now }), expectedCounts);
});

test('audit insertion failure rolls back all seed data in an existing empty schema', (t) => {
  const database = databaseFor(t);
  database.exec(schemaSql);
  database.exec(`PRAGMA user_version = 1;
    CREATE TRIGGER reject_last_baseline BEFORE INSERT ON booking_changes
    WHEN NEW.lesson_id = 'L034'
    BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END;`);
  assert.throws(() => setupDatabase(database), /L034.*injected audit failure/);
  for (const table of Object.keys(expectedCounts)) {
    assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0);
  }
});

test('CSV parsing preserves BOM input, CRLF, quoted commas, quotes, Unicode, and multiline notes', (t) => {
  const database = databaseFor(t);
  const lessons = '\uFEFFlesson_id,date,start_time,duration_min,student,tutor_id,room,status,cancelled_at,note\r\n'
    + 'L999,2026-03-09,10:00,90,Nguyễn An,T1,R6,booked,,"needs, ""confirmation""\r\nnext line"\r\n';
  const dataDirectory = fixture(t, lessons, '\uFEFF' + tutorCsv);
  setupDatabase(database, { dataDirectory, now });
  const booking = database.prepare('SELECT * FROM bookings').get();
  assert.equal(booking.student, 'Nguyễn An');
  assert.equal(booking.note, 'needs, "confirmation"\r\nnext line');
  assert.equal(booking.cancelled_at, null);
  assert.equal(verifySeedDatabase(database, { dataDirectory }).bookings, 1);
});

test('malformed or structurally invalid CSV data fails without partial import', async (t) => {
  const cases = [
    ['impossible date', lessonCsv.replace('2026-03-03,09:00', '2026-02-30,09:00'), /real YYYY-MM-DD/],
    ['invalid time', lessonCsv.replace('2026-03-03,09:00', '2026-03-03,24:00'), /start_time/],
    ['invalid duration', lessonCsv.replace('09:00,60', '09:00,60minutes'), /duration_min/],
    ['invalid status', lessonCsv.replace('R1,booked', 'R1,pending'), /unsupported status/],
    ['invalid cancellation timestamp', lessonCsv.replace('2026-03-03T08:15:00+07:00', '2026-02-30T08:15:00+07:00'), /cancelled_at/],
    ['blank student', lessonCsv.replace('Le Minh Chau,T1', '   ,T1'), /student must be nonblank/],
    ['wrong headers', lessonCsv.replace('lesson_id,date', 'lesson_id,wrong'), /Expected columns/],
    ['missing headers and records', '', /Expected a header/],
    ['wrong field count', lessonCsv.replace('L001,2026', 'L001,extra,2026'), /Invalid Record Length/],
    ['unclosed quote', lessonCsv + '\n"unclosed', /Quote Not Closed/],
    ['duplicate ID', lessonCsv.replace('L034,', 'L001,'), /UNIQUE constraint/],
    ['invalid room', lessonCsv.replace('T1,R2,booked', 'T1,R7,booked'), /FOREIGN KEY/],
  ];
  for (const [name, lessons, expectedError] of cases) {
    await t.test(name, (subtest) => {
      const database = databaseFor(subtest);
      const dataDirectory = fixture(subtest, lessons);
      assert.throws(() => setupDatabase(database, { dataDirectory }), expectedError);
      assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all(), []);
    });
  }
});

test('SQLite enforces structural constraints and retains bookings and immutable history', (t) => {
  const database = databaseFor(t);
  setupDatabase(database, { now });
  for (const sql of [
    "UPDATE bookings SET duration_min = 45 WHERE lesson_id = 'L001'",
    "UPDATE bookings SET duration_min = 60.5 WHERE lesson_id = 'L001'",
    "UPDATE bookings SET tutor_id = 'UNKNOWN' WHERE lesson_id = 'L001'",
    "UPDATE bookings SET room = 'R7' WHERE lesson_id = 'L001'",
    "UPDATE bookings SET status = 'pending' WHERE lesson_id = 'L001'",
    "UPDATE bookings SET student = '' WHERE lesson_id = 'L001'",
    "UPDATE bookings SET start_time = '24:00' WHERE lesson_id = 'L001'",
    "UPDATE bookings SET date = '2026/03/03' WHERE lesson_id = 'L001'",
    "UPDATE bookings SET version = 0 WHERE lesson_id = 'L001'",
    "UPDATE bookings SET status = 'cancelled' WHERE lesson_id = 'L001'",
    "UPDATE bookings SET cancelled_at = NULL WHERE lesson_id = 'L005'",
    "UPDATE bookings SET cancelled_at = '2026-03-03T00:00:00Z' WHERE lesson_id = 'L001'",
    "INSERT INTO rooms VALUES ('R7')",
    "DELETE FROM tutors WHERE tutor_id = 'T1'",
    "DELETE FROM rooms WHERE room_id = 'R1'",
    "DELETE FROM bookings WHERE lesson_id = 'L001'",
    "UPDATE booking_changes SET reason = 'rewrite' WHERE id = 1",
    "DELETE FROM booking_changes WHERE id = 1",
    `INSERT INTO booking_changes (lesson_id, action, changed_at, after_snapshot)
      VALUES ('L001', 'imported', '2026-03-03T00:00:00Z', '[]')`,
    `INSERT INTO booking_changes (lesson_id, action, changed_at, after_snapshot)
      VALUES ('L001', 'imported', '2026-03-03T00:00:00Z', 'not-json')`,
    `INSERT INTO booking_changes (lesson_id, action, changed_at, before_snapshot,
      after_snapshot, needs_manual_communication)
      VALUES ('L001', 'updated', '2026-03-03T00:00:00Z', '{}', '{}', 1)`,
  ]) {
    assert.throws(() => database.exec(sql), undefined, sql);
  }
  assert.deepEqual(verifySeedDatabase(database), expectedCounts);
});

test('verification detects changed data and never rewrites it', (t) => {
  const database = databaseFor(t);
  setupDatabase(database, { now });
  database.exec("UPDATE bookings SET note = 'changed' WHERE lesson_id = 'L001'");
  assert.throws(() => verifySeedDatabase(database), /L001 differs from CSV/);
  assert.equal(database.prepare("SELECT note FROM bookings WHERE lesson_id = 'L001'").get().note, 'changed');
  assert.equal(database.isTransaction, false);
});

test('unknown database versions and unrelated tables are preserved and rejected', (t) => {
  const database = databaseFor(t);
  database.exec('PRAGMA user_version = 99');
  assert.throws(() => setupDatabase(database), /Unsupported database schema version 99/);
  database.exec('PRAGMA user_version = 0; CREATE TABLE unrelated (id INTEGER)');
  assert.throws(() => setupDatabase(database), /unrecognized nonempty database/);
  assert.equal(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'unrelated'").get().name, 'unrelated');
});

test('CLI works outside the project directory, persists data, and fails safely', (t) => {
  const directory = temporaryDirectory(t);
  const databasePath = join(directory, 'nested folder', 'seed.sqlite');
  const cli = join(projectRoot, 'src', 'db', 'cli.js');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, DATABASE_PATH: '' },
  });
  const setup = run('setup', '--db', databasePath);
  assert.equal(setup.status, 0, setup.stderr);
  assert.match(setup.stdout, /"bookings": 34/);
  assert.equal(run('verify', '--db', databasePath).status, 0);
  const repeated = run('setup', '--db', databasePath);
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /already contains data/);
  const missingPath = join(directory, 'does-not-exist.sqlite');
  assert.equal(run('verify', '--db', missingPath).status, 1);
  assert.equal(existsSync(missingPath), false);
  assert.equal(run('setup', '--unknown').status, 1);

  const database = openDatabase(databasePath, { readOnly: true });
  try {
    assert.deepEqual(verifySeedDatabase(database), expectedCounts);
    assert.throws(() => database.exec("UPDATE bookings SET note = 'write' WHERE lesson_id = 'L001'"), /readonly/);
  } finally {
    database.close();
  }
});
