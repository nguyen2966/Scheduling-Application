import { Router } from 'express';
import { createRoomRouter } from './rooms.js';
import { createTutorRouter } from './tutors.js';
import { createBookingRouter } from './bookings.js';
import { createBookingChangeRouter } from './booking-changes.js';

export function createApiRouter({ roomController, tutorController, bookingController, bookingChangeController }) {
  const router = Router();
  router.use('/rooms', createRoomRouter({ roomController }));
  router.use('/tutors', createTutorRouter({ tutorController }));
  router.use('/bookings/:lesson_id/changes', createBookingChangeRouter({ bookingChangeController }));
  router.use('/bookings', createBookingRouter({ bookingController }));
  return router;
}
