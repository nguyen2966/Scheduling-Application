import { Router } from 'express';
import { AppError } from '../errors/app-error.js';

const allowedMethods = 'GET, HEAD, OPTIONS';

export function createBookingRouter({ bookingController }) {
  const router = Router();
  for (const [path, handler] of [['/', bookingController.list], ['/:lesson_id', bookingController.get]]) {
    router.route(path)
      .get(handler)
      .options((req, res) => res.set('Allow', allowedMethods).status(204).end())
      .all((req, res, next) => {
        res.set('Allow', allowedMethods);
        next(new AppError(405, 'METHOD_NOT_ALLOWED', 'Bookings can only be read at this stage.'));
      });
  }
  return router;
}
