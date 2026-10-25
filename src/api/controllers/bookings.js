import { sendResponse } from '../response.js';
import { bookingEtag } from '../booking-etag.js';

export function createBookingController({ bookingService, now = () => new Date() }) {
  return {
    async update(req, res) {
      const { booking, action } = await bookingService.updateBooking(req.params.lesson_id, req.body, req.get('If-Match'));
      res.set('ETag', bookingEtag(booking));
      const cancelled = action === 'cancelled';
      return sendResponse(res, {
        data: { booking }, key: cancelled ? 'BOOKING_CANCELLED' : 'BOOKING_UPDATED',
        message: cancelled ? 'Booking cancelled successfully.' : 'Booking updated successfully.',
      }, now);
    },
    async create(req, res) {
      const booking = await bookingService.createBooking(req.body);
      res.set('Location', `/api/v1/bookings/${encodeURIComponent(booking.lesson_id)}`);
      res.set('ETag', bookingEtag(booking));
      return sendResponse(res, {
        status: 201, data: { booking }, key: 'BOOKING_CREATED', message: 'Booking created successfully.',
      }, now);
    },
    async list(req, res) {
      const items = await bookingService.listBookings(req.query);
      return sendResponse(res, {
        data: { items }, key: 'BOOKINGS_RETRIEVED', message: 'Bookings retrieved successfully.',
      }, now);
    },
    async get(req, res) {
      const booking = await bookingService.getBooking(req.params.lesson_id);
      res.set('ETag', bookingEtag(booking));
      return sendResponse(res, {
        data: { booking }, key: 'BOOKING_RETRIEVED', message: 'Booking retrieved successfully.',
      }, now);
    },
  };
}
