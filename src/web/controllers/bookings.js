import { ApiClientError } from '../api-client.js';
import { buildCalendar, calendarUrl, localDate, normalizeSelection } from '../view-models/calendar.js';
import { buildBookingDetails } from '../view-models/booking-details.js';

export function createBookingsPageController({ apiClientForRequest, referenceNow }) {
  return {
    async show(req, res) {
      const client = apiClientForRequest(req);
      const id = req.params.lesson_id;
      const referenceTime = referenceNow();
      const [rooms, tutors, detail] = await Promise.all([
        client.getRooms(), client.getTutors(), id ? client.getBooking(id) : null,
      ]);
      if (!rooms.length) throw new ApiClientError(503, 'SCHEDULE_UNAVAILABLE', 'Rooms are not available yet. Please try again.');
      const selection = normalizeSelection(req.query, rooms, referenceTime, detail?.booking);
      const canonical = calendarUrl(selection.week, selection.room, id);
      res.set('Cache-Control', 'no-store');
      res.locals.calendarHref = calendarUrl(selection.week, selection.room);
      if (req.originalUrl !== canonical) return res.redirect(302, canonical);
      const [bookings, changes] = await Promise.all([
        client.getBookings({ from: localDate(selection.week).minus({ days: 1 }).toISODate(),
          to: localDate(selection.week).plus({ days: 7 }).toISODate() }),
        id ? client.getBookingChanges(id) : [],
      ]);
      const calendar = buildCalendar({ selection, bookings, tutors, rooms, referenceTime });
      const selected = detail ? buildBookingDetails({ ...detail, changes, tutors }) : null;
      return res.render('bookings/week', { ...calendar, selected,
        pageTitle: selected ? `${selected.student} · Bright Path` : 'Weekly schedule · Bright Path' });
    },
  };
}
