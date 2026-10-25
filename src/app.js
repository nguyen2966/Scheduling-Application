import express from 'express';
import { createRoomRepository } from './api/repositories/rooms.js';
import { createRoomService } from './api/services/rooms.js';
import { createRoomController } from './api/controllers/rooms.js';
import { createTutorRepository } from './api/repositories/tutors.js';
import { createTutorService } from './api/services/tutors.js';
import { createTutorController } from './api/controllers/tutors.js';
import { createBookingRepository } from './api/repositories/bookings.js';
import { createBookingService } from './api/services/bookings.js';
import { createBookingController } from './api/controllers/bookings.js';
import { createApiRouter } from './api/routes/index.js';
import { AppError } from './api/errors/app-error.js';
import { createErrorHandler } from './api/middleware/error-handler.js';

// Constructing the app does not open a database, import data, or bind a port.
export function createApp({ database, now = () => new Date(), logger = console }) {
  const roomRepository = createRoomRepository({ database });
  const roomService = createRoomService({ roomRepository });
  const roomController = createRoomController({ roomService, now });
  const tutorRepository = createTutorRepository({ database });
  const tutorService = createTutorService({ tutorRepository });
  const tutorController = createTutorController({ tutorService, now });
  const bookingRepository = createBookingRepository({ database });
  const bookingService = createBookingService({ bookingRepository, roomRepository });
  const bookingController = createBookingController({ bookingService, now });
  const app = express();
  app.disable('x-powered-by');
  app.use('/api/v1', express.json({ limit: '16kb' }));
  app.use('/api/v1', createApiRouter({ roomController, tutorController, bookingController }));
  app.use('/api/v1', (req, res, next) => {
    next(new AppError(404, 'RESOURCE_NOT_FOUND', 'The requested API resource does not exist.'));
  });
  app.use('/api/v1', createErrorHandler({ now, logger }));
  return app;
}
