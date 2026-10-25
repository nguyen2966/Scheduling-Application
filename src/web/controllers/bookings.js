import { ApiClientError } from '../api-client.js';
import { buildCalendar, calendarUrl, localDate, normalizeSelection } from '../view-models/calendar.js';
import { buildBookingDetails } from '../view-models/booking-details.js';
import { createFormTokens } from '../form-tokens.js';
import { isCalendarDate } from '../../shared/calendar-date.js';

export function createBookingsPageController({ apiClientForRequest, referenceNow, formTokens = createFormTokens() }) {
  async function showNew(req, res, { values = null, error = null, status = 200 } = {}) {
    const client = apiClientForRequest(req);
    const referenceTime = referenceNow();
    const [rooms, tutors] = await Promise.all([client.getRooms(), client.getTutors()]);
    if (!rooms.length) throw new ApiClientError(503, 'SCHEDULE_UNAVAILABLE', 'Rooms are not available yet. Please try again.');
    const selection = normalizeSelection(req.query, rooms, referenceTime);
    let canonical = calendarUrl(selection.week, selection.room).replace('/bookings?', '/bookings/new?');
    const date = isCalendarDate(req.query.date) ? req.query.date : null;
    const startTime = typeof req.query.start_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(req.query.start_time)
      ? req.query.start_time : null;
    if (date) canonical += `&date=${date}`;
    if (startTime) canonical += `&start_time=${encodeURIComponent(startTime)}`;
    if (req.method === 'GET' && req.originalUrl !== canonical) return res.redirect(302, canonical);
    const bookings = await client.getBookings({ from: localDate(selection.week).minus({ days: 1 }).toISODate(),
      to: localDate(selection.week).plus({ days: 7 }).toISODate() });
    const calendar = buildCalendar({ selection, bookings, tutors, rooms, referenceTime });
    const defaultDate = selection.referenceDate >= selection.week
      && selection.referenceDate < localDate(selection.week).plus({ days: 7 }).toISODate()
      && localDate(selection.referenceDate).weekday !== 1 ? selection.referenceDate : selection.week;
    const form = { student: '', tutor_id: '', room: selection.room, date: date || defaultDate,
      start_time: startTime || '', duration_min: '60', note: '', ...values };
    res.set('Cache-Control', 'no-store');
    return res.status(status).render('bookings/week', { ...calendar, selected: null,
      form, formError: error, tutors, formToken: formTokens.issue(), creationSuccess: false,
      pageTitle: 'New booking · Bright Path' });
  }
  return {
    newBooking(req, res) { return showNew(req, res); },
    async create(req, res) {
      const body = req.body || {};
      const values = Object.fromEntries(['student', 'tutor_id', 'room', 'date', 'start_time', 'duration_min', 'note']
        .map((field) => [field, body[field] ?? '']));
      try {
        if (!formTokens.verify(body._csrf)) throw new ApiClientError(403, 'FORM_EXPIRED', 'This form expired. Review the details and submit again.');
        const input = { ...values, duration_min: /^(60|90)$/.test(values.duration_min) ? Number(values.duration_min) : values.duration_min };
        const booking = await apiClientForRequest(req).createBooking(input);
        return res.redirect(303, `/bookings/${encodeURIComponent(booking.lesson_id)}?created=1`);
      } catch (error) {
        if (!(error instanceof ApiClientError)) throw error;
        return showNew(req, res, { values, status: error.status, error: {
          message: error.status >= 500 ? "We couldn't confirm the booking. Check the schedule before trying again." : error.message,
          field: error.details?.field || '',
        } });
      }
    },
    async show(req, res) {
      const client = apiClientForRequest(req);
      const id = req.params.lesson_id;
      const referenceTime = referenceNow();
      const [rooms, tutors, detail] = await Promise.all([
        client.getRooms(), client.getTutors(), id ? client.getBooking(id) : null,
      ]);
      if (!rooms.length) throw new ApiClientError(503, 'SCHEDULE_UNAVAILABLE', 'Rooms are not available yet. Please try again.');
      const selection = normalizeSelection(req.query, rooms, referenceTime, detail?.booking);
      const creationSuccess = Boolean(id && req.query.created === '1');
      const canonical = calendarUrl(selection.week, selection.room, id) + (creationSuccess ? '&created=1' : '');
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
      return res.render('bookings/week', { ...calendar, selected, form: null, formError: null, creationSuccess,
        pageTitle: selected ? `${selected.student} · Bright Path` : 'Weekly schedule · Bright Path' });
    },
  };
}
