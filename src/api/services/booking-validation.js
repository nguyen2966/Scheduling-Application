import { AppError } from '../errors/app-error.js';
import { isCalendarDate } from '../../shared/calendar-date.js';
import { bookingInterval, isMonday, occupiedDates } from '../../shared/scheduling-time.js';

function invalid(field, message) {
  return new AppError(422, 'INVALID_BOOKING_INPUT', message, { details: { field } });
}

function validateObject(input, allowed) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid('body', 'Provide a JSON object containing the booking details.');
  }
  for (const field of Object.keys(input)) {
    if (!allowed.includes(field)) throw invalid(field, 'Only editable booking fields may be supplied.');
  }
}

function validateValues(input) {
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
  if (input.note !== undefined && input.note !== null && typeof input.note !== 'string') {
    throw invalid('note', 'note must be text or null.');
  }
}

function validateOperatingDays(candidate) {
  if (occupiedDates(candidate).some(isMonday)) {
    throw new AppError(422, 'CENTRE_CLOSED', 'The centre is closed on Monday. Choose Tuesday through Sunday.',
      { details: { field: 'date' } });
  }
}

export function validateCreationInput(input) {
  validateObject(input, ['student', 'tutor_id', 'room', 'date', 'start_time', 'duration_min', 'note', 'reason']);
  validateValues(input);
  if (input.reason !== undefined && input.reason !== null && typeof input.reason !== 'string') {
    throw invalid('reason', 'reason must be text or null.');
  }
  const candidate = {
    date: input.date, start_time: input.start_time, duration_min: input.duration_min,
    student: input.student.trim(), tutor_id: input.tutor_id, room: input.room,
    status: 'booked', cancelled_at: null, note: input.note === '' ? null : input.note ?? null,
    version: 1,
  };
  validateOperatingDays(candidate);
  return { candidate, reason: input.reason?.trim() || null };
}

const scheduleFields = ['date', 'start_time', 'duration_min', 'student', 'tutor_id'];

export function validateUpdateInput(input) {
  validateObject(input, [...scheduleFields, 'room', 'status', 'note', 'reason']);
  if (typeof input.reason !== 'string' || input.reason.trim() === '') {
    throw invalid('reason', 'A nonblank reason is required for every booking change.');
  }
  const { reason, ...patch } = input;
  if (Object.hasOwn(patch, 'student') && typeof patch.student === 'string') patch.student = patch.student.trim();
  if (patch.note === '') patch.note = null;
  return { patch, reason: reason.trim() };
}

export function prepareBookingUpdate(current, patch, changedAt) {
  const candidate = { ...current, ...patch };
  if (candidate.room !== current.room) {
    throw new AppError(422, 'ROOM_CHANGE_NOT_SUPPORTED', 'Change rooms by cancelling this booking and creating another one.',
      { details: { field: 'room' } });
  }
  validateValues(candidate);
  if (!['booked', 'cancelled', 'no_show'].includes(candidate.status)) throw invalid('status', 'Unsupported booking status.');
  const cancelling = current.status !== 'cancelled' && candidate.status === 'cancelled';
  const restoring = current.status === 'cancelled' && candidate.status === 'booked';
  if (candidate.status !== current.status && !cancelling && !restoring) {
    throw new AppError(409, 'INVALID_BOOKING_TRANSITION', 'This status transition is not supported by booking management.');
  }
  const scheduleChanged = scheduleFields.some((field) => candidate[field] !== current[field]);
  if (cancelling && scheduleChanged) throw invalid('status', 'Cancel the existing lesson without changing its scheduling details.');
  if (current.status === 'cancelled' && candidate.status === 'cancelled' && scheduleChanged) {
    throw new AppError(409, 'BOOKING_CANCELLED', 'Restore this booking with status booked before rescheduling it.');
  }
  if (!scheduleChanged && candidate.status === current.status && candidate.note === current.note) {
    if (patch.status === 'cancelled') throw new AppError(409, 'BOOKING_ALREADY_CANCELLED', 'This booking is already cancelled.');
    throw new AppError(422, 'NO_BOOKING_CHANGES', 'Provide at least one changed booking field.');
  }
  candidate.cancelled_at = cancelling ? changedAt.toISOString() : restoring ? null : current.cancelled_at;
  candidate.version = current.version + 1;
  const requiresAvailability = candidate.status !== 'cancelled' && (scheduleChanged || restoring);
  // Note-only corrections and cancellations preserve unchanged imported anomalies.
  if (requiresAvailability) validateOperatingDays(candidate);
  return { candidate, action: cancelling ? 'cancelled' : 'updated', requiresAvailability };
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
