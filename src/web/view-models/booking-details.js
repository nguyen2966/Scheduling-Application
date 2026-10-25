import { DateTime } from 'luxon';
import { schedulingTimeZone } from '../../config.js';
import { bookingPresentation } from './calendar.js';

const labels = { date: 'Date', start_time: 'Start time', duration_min: 'Duration', student: 'Student',
  tutor_id: 'Tutor', room: 'Room', status: 'Status', cancelled_at: 'Cancelled at', note: 'Note' };

function displayValue(field, value, tutors) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'date') return DateTime.fromISO(value).toFormat('d LLL yyyy');
  if (field === 'duration_min') return `${value} minutes`;
  if (field === 'tutor_id') return tutors.find((tutor) => tutor.tutor_id === value)?.tutor_name || value;
  if (field === 'status') return { booked: 'Booked', cancelled: 'Cancelled', no_show: 'No-show' }[value] || value;
  if (field === 'cancelled_at') return DateTime.fromISO(value).setZone(schedulingTimeZone).toFormat('d LLL yyyy, HH:mm');
  return String(value);
}

export function buildBookingDetails({ booking, etag, changes, tutors }) {
  const history = changes.map((change) => ({
    ...change,
    actionLabel: { imported: 'Imported baseline', created: 'Booking created', updated: 'Booking updated', cancelled: 'Booking cancelled' }[change.action] || change.action,
    timeLabel: DateTime.fromISO(change.changed_at).setZone(schedulingTimeZone).toFormat('d LLL yyyy · HH:mm'),
    communicationLabel: change.needs_manual_communication === true ? 'Needs manual communication'
      : change.needs_manual_communication === null ? 'Communication unknown' : 'No follow-up flag',
    differences: change.before_snapshot ? Object.entries(labels)
      .filter(([field]) => change.before_snapshot[field] !== change.after_snapshot[field])
      .map(([field, label]) => ({ label, before: displayValue(field, change.before_snapshot[field], tutors),
        after: displayValue(field, change.after_snapshot[field], tutors) })) : [],
    snapshot: Object.entries(labels).map(([field, label]) => ({ label, value: displayValue(field, change.after_snapshot[field], tutors) })),
  }));
  return { ...bookingPresentation(booking, tutors), etag, history,
    needsCommunication: changes.some((change) => change.needs_manual_communication === true) };
}
