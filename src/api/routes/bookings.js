import { Router } from 'express';
import { AppError } from '../errors/app-error.js';

const detailMethods = 'GET, HEAD, PATCH, OPTIONS';

export function requireJson(req, res, next) {
  const type = req.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json to change a booking.'));
  }
  return next();
}

export function createBookingRouter({ bookingController }) {
  const router = Router();
  for (const [path, handler] of [['/', bookingController.list], ['/:lesson_id', bookingController.get]]) {
    const route = router.route(path).get(handler);
    const allowedMethods = path === '/' ? 'GET, HEAD, POST, OPTIONS' : detailMethods;
    if (path === '/') route.post(requireJson, bookingController.create);
    else route.patch(requireJson, bookingController.update);
    route
      .options((req, res) => res.set('Allow', allowedMethods).status(204).end())
      .all((req, res, next) => {
        res.set('Allow', allowedMethods);
        next(new AppError(405, 'METHOD_NOT_ALLOWED', 'This booking operation is not supported.'));
      });
  }
  return router;
}
