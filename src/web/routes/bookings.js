import { Router } from 'express';
export function createWebRouter({ bookingPageController }) {
  const router = Router();
  router.get('/', (req, res) => res.redirect(302, '/bookings'));
  router.get('/bookings', bookingPageController.show);
  router.get('/bookings/:lesson_id', bookingPageController.show);
  return router;
}
