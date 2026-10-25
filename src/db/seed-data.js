import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { seedDataDirectory } from '../config.js';
import { isCalendarDate } from '../shared/calendar-date.js';

export { isCalendarDate };

const tutorColumns = ['tutor_id', 'tutor_name', 'subject', 'phone'];
const bookingColumns = [
  'lesson_id', 'date', 'start_time', 'duration_min', 'student',
  'tutor_id', 'room', 'status', 'cancelled_at', 'note',
];

export function isInstant(value) {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  return parts !== null && isCalendarDate(parts[1]) && Number.isFinite(Date.parse(value));
}

function readCsv(directory, filename, expectedColumns) {
  try {
    let hasHeader = false;
    const rows = parse(readFileSync(resolve(directory, filename), 'utf8'), {
      bom: true,
      skip_empty_lines: true,
      columns(header) {
        hasHeader = true;
        if (header.length !== expectedColumns.length
          || header.some((column, index) => column !== expectedColumns[index])) {
          throw new Error(`Expected columns: ${expectedColumns.join(',')}`);
        }
        return header;
      },
    });
    if (!hasHeader || rows.length === 0) throw new Error('Expected a header and at least one data record.');
    return rows;
  } catch (error) {
    throw new Error(`${filename}: ${error.message}`, { cause: error });
  }
}

function requireText(row, columns, label) {
  for (const column of columns) {
    if (typeof row[column] !== 'string' || row[column].trim() === '') {
      throw new Error(`${label}: ${column} must be nonblank text.`);
    }
  }
}

export function loadSeedData(directory = seedDataDirectory) {
  const tutors = readCsv(directory, 'tutors.csv', tutorColumns);
  tutors.forEach((row, index) => requireText(row, tutorColumns, `tutors.csv record ${index + 1}`));

  const bookings = readCsv(directory, 'lessons_export.csv', bookingColumns).map((row, index) => {
    const label = `lessons_export.csv record ${index + 1} (${row.lesson_id || 'missing ID'})`;
    requireText(row, bookingColumns.filter((column) => !['cancelled_at', 'note'].includes(column)), label);
    if (!isCalendarDate(row.date)) throw new Error(`${label}: date must be a real YYYY-MM-DD date.`);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.start_time)) {
      throw new Error(`${label}: start_time must use HH:mm (00:00-23:59).`);
    }
    if (!['60', '90'].includes(row.duration_min)) {
      throw new Error(`${label}: duration_min must be 60 or 90.`);
    }
    if (!['booked', 'cancelled', 'no_show'].includes(row.status)) {
      throw new Error(`${label}: unsupported status.`);
    }
    const cancelledAt = row.cancelled_at === '' ? null : row.cancelled_at;
    if (row.status === 'cancelled' ? !isInstant(cancelledAt) : cancelledAt !== null) {
      throw new Error(`${label}: cancelled_at must be an ISO instant exactly when status is cancelled.`);
    }
    return {
      ...row,
      duration_min: Number(row.duration_min),
      cancelled_at: cancelledAt,
      note: row.note === '' ? null : row.note,
      version: 1,
    };
  });

  return { tutors, bookings, rooms: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] };
}
