import { Router } from 'express';
import { AppError } from '../errors/app-error.js';

const allowedMethods = 'GET, HEAD, OPTIONS';

export function createBookingChangeRouter({ bookingChangeController }) {
  const router = Router({ mergeParams: true });
  router.route('/')
    .get(bookingChangeController.list)
    .options((req, res) => res.set('Allow', allowedMethods).status(204).end())
    .all((req, res, next) => {
      res.set('Allow', allowedMethods);
      next(new AppError(405, 'METHOD_NOT_ALLOWED', 'Booking history can only be read.'));
    });
  return router;
}
