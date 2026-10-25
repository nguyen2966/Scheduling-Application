import assert from 'node:assert/strict';
import { schemaVersion } from './connection.js';
import { isInstant, loadSeedData } from './seed-data.js';

// Exact seed-baseline verification; expected to fail after staff edit bookings.
export function verifySeedDatabase(database, { dataDirectory } = {}) {
  const seed = loadSeedData(dataDirectory);
  database.exec('BEGIN');
  try {
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, schemaVersion,
      'Unexpected database schema version.');
    assert.equal(database.prepare('PRAGMA quick_check').get().quick_check, 'ok',
      'SQLite integrity check failed.');
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [],
      'Broken database references.');

    const expectedCounts = { tutors: seed.tutors.length, rooms: seed.rooms.length,
      bookings: seed.bookings.length, booking_changes: seed.bookings.length };
    for (const [table, count] of Object.entries(expectedCounts)) {
      assert.equal(database.prepare(`SELECT count(*) AS count FROM ${table}`).get().count,
        count, `Unexpected ${table} count.`);
    }
    for (const tutor of seed.tutors) {
      const saved = database.prepare('SELECT * FROM tutors WHERE tutor_id = ?').get(tutor.tutor_id);
      assert.deepEqual({ ...saved }, tutor, `Tutor ${tutor.tutor_id} differs from CSV.`);
    }
    assert.deepEqual(database.prepare('SELECT room_id FROM rooms ORDER BY room_id').all()
      .map((row) => row.room_id), seed.rooms);

    for (const booking of seed.bookings) {
      const saved = database.prepare('SELECT * FROM bookings WHERE lesson_id = ?').get(booking.lesson_id);
      assert.deepEqual({ ...saved }, booking, `Booking ${booking.lesson_id} differs from CSV.`);
      const history = database.prepare('SELECT * FROM booking_changes WHERE lesson_id = ?')
        .all(booking.lesson_id);
      assert.equal(history.length, 1, `Expected one baseline for ${booking.lesson_id}.`);
      const change = history[0];
      assert.equal(change.action, 'imported');
      assert.equal(change.before_snapshot, null);
      assert.equal(change.reason, null);
      assert.equal(change.needs_manual_communication, null);
      assert.ok(isInstant(change.changed_at), 'Invalid import timestamp.');
      assert.deepEqual(JSON.parse(change.after_snapshot), booking,
        `History snapshot differs for ${booking.lesson_id}.`);
    }
    database.exec('COMMIT');
    return expectedCounts;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
