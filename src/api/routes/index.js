import { Router } from 'express';
import { createRoomRouter } from './rooms.js';
import { createTutorRouter } from './tutors.js';
import { createBookingRouter } from './bookings.js';

export function createApiRouter({ roomController, tutorController, bookingController }) {
  const router = Router();
  router.use('/rooms', createRoomRouter({ roomController }));
  router.use('/tutors', createTutorRouter({ tutorController }));
  router.use('/bookings', createBookingRouter({ bookingController }));
  return router;
}
