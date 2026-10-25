import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { createApiClient } from '../../src/web/api-client.js';
import { createFormTokens } from '../../src/web/form-tokens.js';
import { bookingInput, createBookingSubmitHandler } from '../../src/web/public/js/booking-form-actions.js';
import { verifySeedDatabase } from '../../src/db/verify-seed.js';
import { seededDatabase, serve } from '../api/helpers.js';

const context = 'week=2026-03-03&room=R6';
const values = { student: 'New UI Student', tutor_id: 'T2', room: 'R6', date: '2026-03-07',
  start_time: '13:00', duration_min: '90', note: 'Extra lesson' };
const tokenFrom = (html) => {
  const match = /name="_csrf" value="([^"]+)"/.exec(html);
  assert.ok(match, 'Missing HTML form token');
  return match[1];
};
const postForm = (origin, body, query = context) => fetch(`${origin}/bookings?${query}`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body), redirect: 'manual',
});

test('new booking form renders tutors, locked room, date/time prefill, and accessible calendar entry points', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  const response = await fetch(`${origin}/bookings/new?${context}&date=2026-03-07&start_time=13%3A00`);
  const html = await response.text();
  assert.equal(response.status, 200, html);
  assert.match(html, /data-booking-create/);
  assert.match(html, /name="date"[^>]+value="2026-03-07"/);
  assert.match(html, /name="start_time"[^>]+value="13:00"/);
  assert.match(html, /Ngoc Anh · Maths/);
  assert.match(html, /Pham Duc · English/);
  assert.match(html, /Le Thu · Physics/);
  assert.match(html, /value="90"[^>]*>90 minutes/);
  assert.match(html, /value="Room 6" readonly/);
  assert.match(html, /data-create-url=/);
  assert.doesNotMatch(html, /aria-label="New booking on Mon/);
  tokenFrom(html);
});

test('HTML form fallback creates through the API and redirects to a saved booking and its history', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  const form = await fetch(`${origin}/bookings/new?${context}`);
  const token = tokenFrom(await form.text());
  const response = await postForm(origin, { ...values, _csrf: token });
  assert.equal(response.status, 303);
  assert.match(response.headers.get('location'), /^\/bookings\/B-[a-f0-9-]+\?created=1$/);
  const detail = await fetch(`${origin}${response.headers.get('location')}`);
  const html = await detail.text();
  assert.equal(detail.status, 200, html);
  assert.match(html, /Booking created successfully/);
  assert.match(html, /New UI Student/);
  assert.match(html, /Booking created/);
  const booking = database.prepare("SELECT * FROM bookings WHERE student = 'New UI Student'").get();
  assert.equal(booking.duration_min, 90);
  assert.equal(booking.room, 'R6');
  assert.equal(booking.status, 'booked');
  assert.equal(database.prepare('SELECT count(*) AS count FROM bookings').get().count, 35);
  const change = database.prepare('SELECT * FROM booking_changes WHERE lesson_id = ?').get(booking.lesson_id);
  assert.equal(change.action, 'created');
  assert.equal(JSON.parse(change.after_snapshot).student, values.student);
});

test('a rejected booking preserves inputs and field feedback and can be corrected and resubmitted', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  const query = 'week=2026-03-03&room=R1';
  const form = await fetch(`${origin}/bookings/new?${query}`);
  const input = { ...values, student: 'Keep This Student', tutor_id: 'T1', room: 'R1', date: '2026-03-03',
    start_time: '09:00', duration_min: '60', note: 'Keep <this> note', _csrf: tokenFrom(await form.text()) };
  const rejected = await postForm(origin, input, query);
  const html = await rejected.text();
  assert.equal(rejected.status, 409, html);
  assert.match(html, /value="Keep This Student"/);
  assert.match(html, /Keep &lt;this&gt; note/);
  assert.match(html, /value="T1" selected/);
  assert.match(html, /This tutor is already teaching/);
  assert.equal(verifySeedDatabase(database).bookings, 34);
  const corrected = await postForm(origin, { ...input, start_time: '12:00', _csrf: tokenFrom(html) }, query);
  assert.equal(corrected.status, 303);
  assert.equal(database.prepare("SELECT start_time FROM bookings WHERE student = 'Keep This Student'").get().start_time, '12:00');
});

test('HTML fallback rejects missing/tampered tokens and invalid durations without writing', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  for (const _csrf of ['', 'tampered']) {
    const response = await postForm(origin, { ...values, _csrf });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /form expired/);
  }
  const form = await fetch(`${origin}/bookings/new?${context}`);
  const invalid = await postForm(origin, { ...values, duration_min: '45', _csrf: tokenFrom(await form.text()) });
  assert.equal(invalid.status, 422);
  assert.match(await invalid.text(), /Duration must be/);
  assert.equal(verifySeedDatabase(database).booking_changes, 34);
});

test('API client sends numeric booking JSON and preserves actionable conflict details', async () => {
  const input = bookingInput(values);
  const client = createApiClient({ baseUrl: 'http://localhost/api/v1', fetchImpl: async (url, options) => {
    assert.equal(url, 'http://localhost/api/v1/bookings');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), input);
    return new Response(JSON.stringify({ data: { booking: { ...input, lesson_id: 'B-unit' } },
      code: { http_status: 201 } }), { status: 201 });
  } });
  assert.equal((await client.createBooking(input)).lesson_id, 'B-unit');
  assert.equal(input.duration_min, 90);
  const rejected = createApiClient({ fetchImpl: async () => new Response(JSON.stringify({
    data: { details: { field: 'tutor_id' } }, code: { key: 'TUTOR_SCHEDULE_CONFLICT', message: 'Tutor is busy.' },
  }), { status: 409 }) });
  await assert.rejects(rejected.createBooking(input), (error) => error.status === 409 && error.details.field === 'tutor_id');
});

test('browser submit flow prevents concurrent duplicate submits and navigates after creation', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const saving = [];
  const navigation = [];
  const submit = createBookingSubmitHandler({
    client: { createBooking(input) { calls++; assert.equal(input.duration_min, 90); return pending; } },
    readValues: () => values, setSaving: (value) => saving.push(value), showError() {},
    navigate: (url) => navigation.push(url),
  });
  const first = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  assert.equal(calls, 1);
  release({ lesson_id: 'B-saved' });
  await first;
  assert.deepEqual(saving, [true, false]);
  assert.deepEqual(navigation, ['/bookings/B-saved?created=1']);
});

test('browser submit failure retains input and shows field errors or an unconfirmed-save message', async () => {
  for (const error of [{ status: 409, message: 'Tutor is busy.', details: { field: 'tutor_id' } }, { status: 503 }]) {
    const errors = [];
    const original = { ...values };
    const submit = createBookingSubmitHandler({ client: { async createBooking() { throw error; } },
      readValues: () => original, setSaving() {}, showError: (value) => errors.push(value),
      navigate() { assert.fail('Rejected submission navigated away'); },
    });
    await submit({ preventDefault() {} });
    assert.deepEqual(original, values);
    if (error.status === 409) assert.deepEqual(errors.at(-1), { message: 'Tutor is busy.', field: 'tutor_id' });
    else assert.match(errors.at(-1).message, /Check the schedule before trying again/);
  }
});

test('form tokens expire and cannot be changed or reused across app secrets', () => {
  let time = 1000;
  const tokens = createFormTokens({ now: () => time });
  const token = tokens.issue();
  assert.equal(tokens.verify(token), true);
  assert.equal(tokens.verify(`${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`), false);
  assert.equal(createFormTokens({ now: () => time }).verify(token), false);
  time += 2 * 60 * 60 * 1000;
  assert.equal(tokens.verify(token), false);
});
