import { Router } from 'express';
import { createRoomRouter } from './rooms.js';
import { createTutorRouter } from './tutors.js';

export function createApiRouter({ roomController, tutorController }) {
  const router = Router();
  router.use('/rooms', createRoomRouter({ roomController }));
  router.use('/tutors', createTutorRouter({ tutorController }));
  return router;
}
