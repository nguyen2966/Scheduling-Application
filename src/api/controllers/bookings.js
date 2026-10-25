import { sendResponse } from '../response.js';

export function createBookingController({ bookingService, now = () => new Date() }) {
  return {
    async list(req, res) {
      const items = await bookingService.listBookings(req.query);
      return sendResponse(res, {
        data: { items }, key: 'BOOKINGS_RETRIEVED', message: 'Bookings retrieved successfully.',
      }, now);
    },
    async get(req, res) {
      const booking = await bookingService.getBooking(req.params.lesson_id);
      res.set('ETag', `"booking-${encodeURIComponent(booking.lesson_id)}-v${booking.version}"`);
      return sendResponse(res, {
        data: { booking }, key: 'BOOKING_RETRIEVED', message: 'Booking retrieved successfully.',
      }, now);
    },
  };
}
