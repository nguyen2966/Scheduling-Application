import { AppError } from '../errors/app-error.js';
import { isCalendarDate } from '../../shared/calendar-date.js';
import { randomUUID } from 'node:crypto';
import { defaultReferenceTime } from '../../config.js';
import { availabilityWindow } from '../../shared/scheduling-time.js';
import { validateCreationInput, validateBookingReferences, validateAvailability } from './booking-validation.js';
import { needsManualCommunication } from './schedule-cutoff.js';

function invalidFilter(field, message) {
  return new AppError(422, 'INVALID_BOOKING_FILTER', message, { details: { field } });
}

export function createBookingService({ bookingRepository, roomRepository, tutorRepository,
  bookingChangeRepository, runInTransaction, businessNow = () => new Date(defaultReferenceTime),
  generateId = () => `B-${randomUUID()}` }) {
  return {
    async createBooking(input) {
      const { candidate, reason } = validateCreationInput(input);
      // Every database read used to approve a booking occurs after BEGIN IMMEDIATE.
      // All repositories below are synchronous and share the transaction's connection.
      return runInTransaction(() => {
        validateBookingReferences(candidate, {
          tutor: tutorRepository.findById(candidate.tutor_id),
          room: roomRepository.findById(candidate.room),
        });
        validateAvailability(candidate,
          bookingRepository.findOccupying(availabilityWindow(candidate)),
          bookingRepository.countTutorDaily(candidate.tutor_id, candidate.date));
        const changedAt = businessNow();
        const booking = bookingRepository.insert({ lesson_id: generateId(), ...candidate });
        bookingChangeRepository.insert({
          lesson_id: booking.lesson_id, action: 'created', changed_at: changedAt.toISOString(),
          before_snapshot: null, after_snapshot: booking, reason,
          needs_manual_communication: needsManualCommunication({ after: booking, changedAt }),
        });
        return booking;
      });
    },
    async listBookings(filters = {}) {
      if (filters === null || typeof filters !== 'object' || Array.isArray(filters)) {
        throw invalidFilter('query', 'Booking filters must be query parameters.');
      }
      for (const field of Object.keys(filters)) {
        if (!['from', 'to', 'room'].includes(field)) {
          throw invalidFilter(field, 'Supported booking filters are from, to, and room.');
        }
      }
      const { from, to, room } = filters;
      for (const [field, value] of [['from', from], ['to', to]]) {
        if (value !== undefined && !isCalendarDate(value)) {
          throw invalidFilter(field, `${field} must be a real date in YYYY-MM-DD format.`);
        }
      }
      if (from !== undefined && to !== undefined && from >= to) {
        throw invalidFilter('to', 'to must be later than from; the end date is exclusive.');
      }
      if (room !== undefined) {
        if (typeof room !== 'string' || !(await roomRepository.findAll()).some((item) => item.room_id === room)) {
          throw invalidFilter('room', 'Choose an existing room, R1 through R6.');
        }
      }
      return bookingRepository.findAll({ from, to, room });
    },
    async getBooking(lessonId) {
      if (typeof lessonId !== 'string' || lessonId.trim() === '') {
        throw new AppError(422, 'INVALID_BOOKING_ID', 'A nonblank booking ID is required.');
      }
      const booking = await bookingRepository.findById(lessonId);
      if (!booking) throw new AppError(404, 'BOOKING_NOT_FOUND', 'The requested booking does not exist.');
      return booking;
    },
  };
}
