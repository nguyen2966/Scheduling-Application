import { sendResponse } from '../response.js';

export function createBookingChangeController({ bookingChangeService, now = () => new Date() }) {
  return {
    async list(req, res) {
      const items = await bookingChangeService.listChanges(req.params.lesson_id);
      return sendResponse(res, {
        data: { items },
        key: 'BOOKING_CHANGES_RETRIEVED',
        message: 'Booking history retrieved successfully.',
      }, now);
    },
  };
}
