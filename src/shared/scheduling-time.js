import { DateTime } from 'luxon';
import { schedulingTimeZone } from '../config.js';

export function bookingInterval(booking) {
  const start = DateTime.fromISO(`${booking.date}T${booking.start_time}`, { zone: schedulingTimeZone });
  return { start: start.toMillis(), end: start.plus({ minutes: booking.duration_min }).toMillis() };
}

export function occupiedDates(booking) {
  const interval = bookingInterval(booking);
  const last = DateTime.fromMillis(interval.end - 1, { zone: schedulingTimeZone }).startOf('day');
  let day = DateTime.fromMillis(interval.start, { zone: schedulingTimeZone }).startOf('day');
  const dates = [];
  while (day <= last) {
    dates.push(day.toISODate());
    day = day.plus({ days: 1 });
  }
  return dates;
}

export function isMonday(date) {
  return DateTime.fromISO(date, { zone: schedulingTimeZone }).weekday === 1;
}

// Existing 60/90-minute lessons may have started on the previous local date.
export function availabilityWindow(booking) {
  const dates = occupiedDates(booking);
  return {
    from: DateTime.fromISO(dates[0], { zone: schedulingTimeZone }).minus({ days: 1 }).toISODate(),
    to: DateTime.fromISO(dates.at(-1), { zone: schedulingTimeZone }).plus({ days: 1 }).toISODate(),
  };
}

export function cutoffInstant(date) {
  return DateTime.fromISO(date, { zone: schedulingTimeZone }).minus({ days: 1 })
    .set({ hour: 16, minute: 0, second: 0, millisecond: 0 }).toMillis();
}
