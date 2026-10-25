import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/app.js';
import { verifySeedDatabase } from '../../src/db/verify-seed.js';
import { seededDatabase, serve } from '../api/helpers.js';

const week = '/bookings?week=2026-03-03&room=R1';

test('root and incomplete calendar URLs redirect to the pinned Tuesday–Monday week', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  const root = await fetch(origin, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/bookings');
  for (const path of ['/bookings', '/bookings?week=invalid&room=R7', '/bookings?week=2026-03-05&room=R1']) {
    const response = await fetch(`${origin}${path}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), week);
  }
});

test('weekly page renders real lessons, seven days, room options, and separate overlap lanes through the API', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database }));
  const response = await fetch(`${origin}${week}`);
  const html = await response.text();
  assert.equal(response.status, 200, html);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(html, /Weekly schedule/);
  assert.match(html, /3–9 March 2026/);
  assert.equal((html.match(/class="day-heading/g) || []).length, 7);
  for (let number = 1; number <= 6; number++) assert.match(html, new RegExp(`value="R${number}"`));
  for (const id of ['L001', 'L009', 'L010', 'L027']) assert.match(html, new RegExp(`data-booking-id="${id}"`));
  assert.match(html, /2 lessons overlap/);
  assert.match(html, /width:calc\(50%/);
  assert.match(html, /Ngoc Anh/);
  assert.equal(verifySeedDatabase(database).bookings, 34);
});

test('room/week navigation shows Monday seed records, no-shows, cancellations, and empty rooms accurately', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  const monday = await (await fetch(`${origin}/bookings?week=2026-03-03&room=R3`)).text();
  assert.match(monday, /data-booking-id="L032"/);
  assert.match(monday, /closed-label">Closed/);
  const secondRoom = await (await fetch(`${origin}/bookings?week=2026-03-03&room=R2`)).text();
  assert.match(secondRoom, /data-booking-id="L015"/);
  assert.match(secondRoom, /No-show/);
  assert.match(secondRoom, /Cancelled lessons/);
  assert.match(secondRoom, /data-booking-id="L005"/);
  assert.doesNotMatch(secondRoom.split('cancelled-section')[0], /data-booking-id="L005"/);
  const empty = await (await fetch(`${origin}/bookings?week=2026-03-03&room=R6`)).text();
  assert.match(empty, /No lessons scheduled/);
  assert.doesNotMatch(empty, /data-booking-id=/);
  const next = await (await fetch(`${origin}/bookings?week=2026-03-10&room=R1`)).text();
  assert.match(next, /data-booking-id="L033"/);
  assert.doesNotMatch(next, /data-booking-id="L001"/);
});

test('booking panel renders current ETag, details, and baseline history without inventing communication status', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  const response = await fetch(`${origin}/bookings/L009?week=2026-03-03&room=R1`);
  const html = await response.text();
  assert.equal(response.status, 200, html);
  assert.match(html, /<dialog[^>]+open/);
  assert.match(html, /data-booking-etag="&quot;booking-L009-v1&quot;"/);
  assert.match(html, /Tran Bao Long/);
  assert.match(html, /exam pair - half price/);
  assert.match(html, /Imported baseline/);
  assert.match(html, /Communication unknown/);
  assert.doesNotMatch(html, /Needs manual communication/);
  const wrongRoom = await fetch(`${origin}/bookings/L032?week=2026-03-03&room=R1`, { redirect: 'manual' });
  assert.equal(wrongRoom.status, 302);
  assert.equal(wrongRoom.headers.get('location'), '/bookings/L032?week=2026-03-03&room=R3');
});

test('HTML rendering escapes booking names, notes, and audit reasons', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  const created = await fetch(`${origin}/api/v1/bookings`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      student: '<script>alert(1)</script>', note: '<img src=x onerror=alert(2)>', reason: '<svg onload=alert(3)>',
      tutor_id: 'T2', room: 'R6', date: '2026-03-07', start_time: '13:00', duration_min: 60,
    }) });
  assert.equal(created.status, 201);
  const id = (await created.json()).data.booking.lesson_id;
  const response = await fetch(`${origin}/bookings/${id}?week=2026-03-03&room=R6`);
  const html = await response.text();
  assert.equal(response.status, 200, html);
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /&lt;svg onload/);
  assert.doesNotMatch(html, /<script>alert|<img src=x|<svg onload/);
});

test('missing/malformed pages use HTML errors while API errors remain JSON', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t), logger: { error() {} } }));
  for (const [path, status] of [['/bookings/missing?week=2026-03-03&room=R1', 404], ['/unknown', 404], ['/bookings/%E0%A4%A', 400]]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, status);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /Return to schedule/);
  }
  const api = await fetch(`${origin}/api/v1/bookings/missing`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-type'), /application\/json/);
  assert.equal((await api.json()).code.key, 'BOOKING_NOT_FOUND');
});

test('static assets load, private templates stay private, and a forged Host does not redirect SSR API requests', async (t) => {
  const origin = await serve(t, createApp({ database: seededDatabase(t) }));
  for (const path of ['/assets/css/app.css', '/assets/js/api-client.js', '/assets/js/booking-details.js']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).length > 100);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  const privateFile = await fetch(`${origin}/assets/views/layout.pug`);
  assert.equal(privateFile.status, 404);
  await privateFile.text();
  const forged = await fetch(`${origin}${week}`, { headers: { Host: 'example.invalid:9999' } });
  assert.equal(forged.status, 200);
  await forged.text();
});

test('an upstream database failure becomes a safe HTML unavailable page', async (t) => {
  const database = seededDatabase(t);
  const origin = await serve(t, createApp({ database, logger: { error() {} } }));
  database.close();
  const response = await fetch(`${origin}${week}`);
  const html = await response.text();
  assert.equal(response.status, 503);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(html, /schedule is unavailable/);
  assert.doesNotMatch(html, /SQLITE|database is closed|stack trace/);
});
