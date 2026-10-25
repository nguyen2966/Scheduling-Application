import { DateTime } from 'luxon';
import { schedulingTimeZone } from '../../config.js';
import { isCalendarDate } from '../../shared/calendar-date.js';

const zone = schedulingTimeZone;
const rowHeight = 32;
const statusLabels = { booked: 'Booked', cancelled: 'Cancelled', no_show: 'No-show' };
export const localDate = (value) => DateTime.fromISO(value, { zone });

export function calendarUrl(week, room, lessonId) {
  const path = lessonId ? `/bookings/${encodeURIComponent(lessonId)}` : '/bookings';
  return `${path}?${new URLSearchParams({ week, room })}`;
}

export function weekContaining(date) {
  const value = localDate(date);
  return value.minus({ days: (value.weekday + 5) % 7 }).toISODate();
}

export function normalizeSelection(query, rooms, referenceTime, booking = null) {
  const referenceDate = DateTime.fromJSDate(referenceTime, { zone }).toISODate();
  const requestedWeek = isCalendarDate(query.week) ? weekContaining(query.week) : weekContaining(booking?.date || referenceDate);
  // Keep both API range bounds representable by the date contract.
  const week = isCalendarDate(localDate(requestedWeek).minus({ days: 1 }).toISODate())
    && isCalendarDate(localDate(requestedWeek).plus({ days: 7 }).toISODate())
    ? requestedWeek : weekContaining(referenceDate);
  const room = booking?.room || (rooms.some((item) => item.room_id === query.room) ? query.room : rooms[0].room_id);
  return { week, room, referenceDate, referenceWeek: weekContaining(referenceDate) };
}

export function bookingPresentation(booking, tutors) {
  const start = localDate(`${booking.date}T${booking.start_time}`);
  const end = start.plus({ minutes: booking.duration_min });
  const tutor = tutors.find((item) => item.tutor_id === booking.tutor_id);
  return {
    ...booking,
    tutorName: tutor?.tutor_name || booking.tutor_id,
    subject: tutor?.subject || '',
    statusLabel: statusLabels[booking.status] || booking.status,
    dateLabel: start.toFormat('cccc, d LLLL yyyy'),
    timeLabel: `${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}${start.toISODate() !== end.toISODate() ? ' (+1 day)' : ''}`,
    roomLabel: `Room ${booking.room.slice(1)}`,
  };
}

function segmentsFor(bookings, days) {
  return days.flatMap((day) => bookings.flatMap((booking) => {
    const start = localDate(`${booking.date}T${booking.start_time}`);
    const end = start.plus({ minutes: booking.duration_min });
    const dayStart = localDate(day.date);
    const dayEnd = dayStart.plus({ days: 1 });
    if (start >= dayEnd || end <= dayStart) return [];
    return [{ ...booking, day: day.date,
      startMinute: start <= dayStart ? 0 : start.hour * 60 + start.minute,
      endMinute: end >= dayEnd ? 1440 : end.hour * 60 + end.minute,
      continuation: start < dayStart,
    }];
  }));
}

function positionEvents(events, rangeStart) {
  const sorted = [...events].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute
    || a.lesson_id.localeCompare(b.lesson_id));
  const groups = [];
  for (const event of sorted) {
    let group = groups.at(-1);
    if (!group || event.startMinute >= group.end) {
      group = { end: event.endMinute, events: [] };
      groups.push(group);
    }
    group.events.push(event);
    group.end = Math.max(group.end, event.endMinute);
  }
  return groups.flatMap((group) => {
    const laneEnds = [];
    const assigned = group.events.map((event) => {
      let lane = laneEnds.findIndex((end) => end <= event.startMinute);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = event.endMinute;
      return { ...event, lane };
    });
    return assigned.map((event) => ({ ...event, overlapping: laneEnds.length > 1,
      style: `top:${(event.startMinute - rangeStart) / 30 * rowHeight}px;height:${(event.endMinute - event.startMinute) / 30 * rowHeight - 4}px;left:calc(${event.lane / laneEnds.length * 100}% + 3px);width:calc(${100 / laneEnds.length}% - 6px)`,
    }));
  });
}

export function buildCalendar({ selection, bookings, tutors, rooms, referenceTime }) {
  const { week, room, referenceDate, referenceWeek } = selection;
  const start = localDate(week);
  const end = start.plus({ days: 6 });
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = start.plus({ days: index });
    return { date: date.toISODate(), weekday: date.toFormat('ccc'), number: date.toFormat('d'),
      closed: date.weekday === 1, today: date.toISODate() === referenceDate };
  });
  const allSegments = segmentsFor(bookings, days);
  const rangeStart = allSegments.length ? Math.floor(Math.min(...allSegments.map((item) => item.startMinute)) / 30) * 30 : 0;
  const rangeEnd = allSegments.length ? Math.ceil(Math.max(...allSegments.map((item) => item.endMinute)) / 30) * 30 : 0;
  const selectedSegments = allSegments.filter((item) => item.room === room && item.status !== 'cancelled');
  const visibleIds = new Set(allSegments.filter((item) => item.room === room).map((item) => item.lesson_id));
  const selectedBookings = bookings.filter((item) => visibleIds.has(item.lesson_id));
  const decorate = (booking) => ({ ...bookingPresentation(booking, tutors),
    href: calendarUrl(week, room, booking.lesson_id) });
  for (const day of days) {
    day.events = positionEvents(selectedSegments.filter((event) => event.day === day.date), rangeStart).map((event) => ({
      ...decorate(event), ...event,
      ariaLabel: `${event.student}, ${bookingPresentation(event, tutors).tutorName}, ${event.date}, ${bookingPresentation(event, tutors).timeLabel}, ${statusLabels[event.status]}${event.overlapping ? ', overlapping lesson' : ''}`,
    }));
  }
  const formatMinute = (minute) => minute === 1440 ? '24:00'
    : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const timeLabels = [];
  for (let minute = rangeStart; minute < rangeEnd; minute += 30) {
    if (minute % 60 === 0 || minute === rangeStart) timeLabels.push({ text: formatMinute(minute), top: (minute - rangeStart) / 30 * rowHeight });
  }
  return {
    ...selection, days, rooms, timeLabels, timelineHeight: rangeEnd > rangeStart ? (rangeEnd - rangeStart) / 30 * rowHeight : 320,
    weekLabel: start.month === end.month && start.year === end.year
      ? `${start.toFormat('d')}–${end.toFormat('d LLLL yyyy')}` : `${start.toFormat('d LLL yyyy')}–${end.toFormat('d LLL yyyy')}`,
    referenceLabel: DateTime.fromJSDate(referenceTime, { zone }).toFormat('cccc, d LLLL'),
    calendarHref: calendarUrl(week, room),
    previousHref: calendarUrl(start.minus({ days: 7 }).toISODate(), room),
    nextHref: calendarUrl(start.plus({ days: 7 }).toISODate(), room),
    referenceHref: calendarUrl(referenceWeek, room),
    lessonCount: selectedBookings.filter((item) => item.status !== 'cancelled').length,
    overlapCount: new Set(days.flatMap((day) => day.events.filter((event) => event.overlapping).map((event) => event.lesson_id))).size,
    cancelled: selectedBookings.filter((item) => item.status === 'cancelled').map(decorate),
  };
}
