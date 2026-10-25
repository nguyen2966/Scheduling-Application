import { ApiClientError } from '../api-client.js';

export function createPageErrorHandler({ logger = console } = {}) {
  return function pageErrorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    const known = error instanceof ApiClientError;
    if (!known) logger.error('Unexpected page error', { name: error.name });
    const status = known ? error.status : error instanceof URIError ? 400 : 500;
    const title = status === 404 ? 'Booking not found' : status >= 500 ? 'The schedule is unavailable' : 'Unable to open this schedule';
    return res.status(status).set('Cache-Control', 'no-store').render('error', {
      pageTitle: `${title} · Bright Path`, title, status,
      message: known ? error.message : 'Please try again or return to the weekly schedule.',
      calendarHref: res.locals.calendarHref || '/bookings',
    });
  };
}
