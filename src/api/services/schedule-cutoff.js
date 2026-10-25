import { cutoffInstant, occupiedDates } from '../../shared/scheduling-time.js';

export function needsManualCommunication({ before = null, after = null, changedAt }) {
  return [before, after].filter((booking) => booking && ['booked', 'no_show'].includes(booking.status))
    .flatMap(occupiedDates).some((date) => changedAt.getTime() >= cutoffInstant(date));
}
