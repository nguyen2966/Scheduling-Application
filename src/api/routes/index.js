import { Router } from 'express';
import { createRoomRouter } from './rooms.js';

export function createApiRouter({ roomController }) {
  const router = Router();
  router.use('/rooms', createRoomRouter({ roomController }));
  return router;
}
