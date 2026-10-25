import { AppError } from '../errors/app-error.js';
import { isCalendarDate } from '../../shared/calendar-date.js';
import { bookingInterval, isMonday, occupiedDates } from '../../shared/scheduling-time.js';

function invalid(field, message) {
  return new AppError(422, 'INVALID_BOOKING_INPUT', message, { details: { field } });
}

export function validateCreationInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid('body', 'Provide a JSON object containing the booking details.');
  }
  const allowed = ['student', 'tutor_id', 'room', 'date', 'start_time', 'duration_min', 'note', 'reason'];
  for (const field of Object.keys(input)) {
    if (!allowed.includes(field)) throw invalid(field, 'Only editable booking fields may be supplied.');
  }
  for (const field of ['student', 'tutor_id', 'room']) {
    if (typeof input[field] !== 'string' || input[field].trim() === '') {
      throw invalid(field, `${field} must be nonblank text.`);
    }
  }
  if (!isCalendarDate(input.date)) throw invalid('date', 'Choose a real date in YYYY-MM-DD format.');
  if (typeof input.start_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.start_time)) {
    throw invalid('start_time', 'Start time must use HH:mm (00:00-23:59).');
  }
  if (!Number.isInteger(input.duration_min) || ![60, 90].includes(input.duration_min)) {
    throw invalid('duration_min', 'Duration must be the number 60 or 90.');
  }
  for (const field of ['note', 'reason']) {
    if (input[field] !== undefined && input[field] !== null && typeof input[field] !== 'string') {
      throw invalid(field, `${field} must be text or null.`);
    }
  }
  const candidate = {
    date: input.date, start_time: input.start_time, duration_min: input.duration_min,
    student: input.student.trim(), tutor_id: input.tutor_id, room: input.room,
    status: 'booked', cancelled_at: null, note: input.note === '' ? null : input.note ?? null,
    version: 1,
  };
  if (occupiedDates(candidate).some(isMonday)) {
    throw new AppError(422, 'CENTRE_CLOSED', 'The centre is closed on Monday. Choose Tuesday through Sunday.',
      { details: { field: 'date' } });
  }
  return { candidate, reason: input.reason?.trim() || null };
}

export function validateBookingReferences(candidate, { tutor, room }) {
  if (!tutor) throw invalid('tutor_id', 'Choose an existing tutor.');
  if (!room) throw invalid('room', 'Choose an existing room, R1 through R6.');
}

export function validateAvailability(candidate, occupyingBookings, tutorDailyCount) {
  const proposed = bookingInterval(candidate);
  const overlaps = occupyingBookings.filter((existing) => {
    if (!['booked', 'no_show'].includes(existing.status) || existing.lesson_id === candidate.lesson_id) return false;
    const interval = bookingInterval(existing);
    return interval.start < proposed.end && proposed.start < interval.end;
  });
  for (const [field, key, message] of [
    ['student', 'STUDENT_SCHEDULE_CONFLICT', 'This student already has a lesson during the requested time.'],
    ['tutor_id', 'TUTOR_SCHEDULE_CONFLICT', 'This tutor is already teaching during the requested time, possibly in another room.'],
    ['room', 'ROOM_SCHEDULE_CONFLICT', 'This room is already occupied during the requested time.'],
  ]) {
    const conflicts = overlaps.filter((existing) => existing[field] === candidate[field]);
    if (conflicts.length) throw new AppError(409, key, message, {
      details: { field, conflicting_lesson_ids: conflicts.map((existing) => existing.lesson_id) },
    });
  }
  if (tutorDailyCount >= 6) {
    throw new AppError(409, 'TUTOR_DAILY_LIMIT_EXCEEDED', 'This tutor already has six or more counted bookings on this date.',
      { details: { field: 'tutor_id', date: candidate.date, limit: 6 } });
  }
}
