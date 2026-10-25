import { AppError } from './errors/app-error.js';

export function bookingEtag(booking) {
  return `"booking-${encodeURIComponent(booking.lesson_id)}-v${booking.version}"`;
}

export function parseIfMatch(value) {
  if (value === undefined || (typeof value === 'string' && value.trim() === '')) {
    throw new AppError(428, 'PRECONDITION_REQUIRED', 'Read the booking and send its current ETag in If-Match.');
  }
  const invalid = () => new AppError(400, 'INVALID_IF_MATCH', 'If-Match must contain concrete quoted ETags; wildcard updates are not supported.');
  if (typeof value !== 'string') throw invalid();
  const tags = [];
  let remaining = value.trim();
  while (remaining) {
    const match = /^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"/.exec(remaining);
    if (!match) throw invalid();
    tags.push(match[0]);
    remaining = remaining.slice(match[0].length).trim();
    if (!remaining) break;
    if (!remaining.startsWith(',')) throw invalid();
    remaining = remaining.slice(1).trim();
    if (!remaining) throw invalid();
  }
  // A weak tag can be parsed but cannot equal the strong booking-version tag.
  return tags;
}

export function staleBookingError() {
  return new AppError(412, 'PRECONDITION_FAILED', 'This booking changed. Reload it before saving.');
}
