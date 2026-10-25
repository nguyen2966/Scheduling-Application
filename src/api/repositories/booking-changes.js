export function createBookingChangeRepository({ database }) {
  const selectChanges = database.prepare(`
    SELECT id, lesson_id, action, changed_at, before_snapshot, after_snapshot,
      reason, needs_manual_communication
    FROM booking_changes WHERE lesson_id = ? ORDER BY id
  `);
  return {
    findByLessonId(lessonId) {
      return selectChanges.all(lessonId).map((change) => ({ ...change }));
    },
  };
}
