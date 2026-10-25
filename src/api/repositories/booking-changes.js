export function createBookingChangeRepository({ database }) {
  const selectChanges = database.prepare(`
    SELECT id, lesson_id, action, changed_at, before_snapshot, after_snapshot,
      reason, needs_manual_communication
    FROM booking_changes WHERE lesson_id = ? ORDER BY id
  `);
  const insertChange = database.prepare(`INSERT INTO booking_changes
    (lesson_id, action, changed_at, before_snapshot, after_snapshot, reason, needs_manual_communication)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  return {
    findByLessonId(lessonId) {
      return selectChanges.all(lessonId).map((change) => ({ ...change }));
    },
    insert(change) {
      insertChange.run(change.lesson_id, change.action, change.changed_at,
        change.before_snapshot === null ? null : JSON.stringify(change.before_snapshot),
        JSON.stringify(change.after_snapshot), change.reason,
        change.needs_manual_communication === null ? null : Number(change.needs_manual_communication));
    },
  };
}
