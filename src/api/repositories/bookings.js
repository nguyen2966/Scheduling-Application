const columns = `lesson_id, date, start_time, duration_min, student,
  tutor_id, room, status, cancelled_at, note, version`;

export function createBookingRepository({ database }) {
  const selectBooking = database.prepare(`SELECT ${columns} FROM bookings WHERE lesson_id = ?`);
  return {
    findAll({ from, to, room } = {}) {
      const conditions = [];
      const parameters = [];
      for (const [value, predicate] of [[from, 'date >= ?'], [to, 'date < ?'], [room, 'room = ?']]) {
        if (value !== undefined) {
          conditions.push(predicate);
          parameters.push(value);
        }
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      return database.prepare(`SELECT ${columns} FROM bookings ${where}
        ORDER BY date, start_time, lesson_id`).all(...parameters).map((booking) => ({ ...booking }));
    },
    findById(lessonId) {
      const booking = selectBooking.get(lessonId);
      return booking ? { ...booking } : null;
    },
  };
}
