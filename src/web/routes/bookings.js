import { Router, urlencoded } from 'express';
export function createWebRouter({ bookingPageController }) {
  const router = Router();
  router.get('/', (req, res) => res.redirect(302, '/bookings'));
  router.get('/bookings', bookingPageController.show);
  router.get('/bookings/new', bookingPageController.newBooking);
  router.post('/bookings', urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 }), bookingPageController.create);
  router.get('/bookings/:lesson_id', bookingPageController.show);
  return router;
}
