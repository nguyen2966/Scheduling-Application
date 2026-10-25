const columns = `lesson_id, date, start_time, duration_min, student,
  tutor_id, room, status, cancelled_at, note, version`;

export function createBookingRepository({ database }) {
  const selectBooking = database.prepare(`SELECT ${columns} FROM bookings WHERE lesson_id = ?`);
  const insertBooking = database.prepare(`INSERT INTO bookings (${columns})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${columns}`);
  const selectOccupying = database.prepare(`SELECT ${columns} FROM bookings
    WHERE date >= ? AND date < ? AND status IN ('booked', 'no_show')
    ORDER BY date, start_time, lesson_id`);
  const countTutor = database.prepare(`SELECT count(*) AS count FROM bookings
    WHERE tutor_id = ? AND date = ? AND status IN ('booked', 'no_show')`);
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
    findOccupying({ from, to }) {
      return selectOccupying.all(from, to).map((booking) => ({ ...booking }));
    },
    countTutorDaily(tutorId, date) {
      return countTutor.get(tutorId, date).count;
    },
    insert(booking) {
      return { ...insertBooking.get(booking.lesson_id, booking.date, booking.start_time,
        booking.duration_min, booking.student, booking.tutor_id, booking.room, booking.status,
        booking.cancelled_at, booking.note, booking.version) };
    },
  };
}
