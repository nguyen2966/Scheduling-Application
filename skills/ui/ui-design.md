---
name: ui-design
description: Build the Bright Path front-desk booking interface with Express, Pug server-side rendering, minimal vanilla JavaScript, and the existing REST API contract.
---

# UI Design Skill — Express + Pug (Server-Side Rendering)

## When to use

Apply this skill when designing, implementing, testing, or reviewing **any browser-facing page or interaction** in Bright Path Booking Management. **MUST**, **MUST NOT**, and **SHOULD** are normative.

## 1. Stack and architecture

- **MUST** use Node.js + Express for the web server and **Pug** for HTML server-side rendering (`res.render`).
- **MUST NOT** introduce React, Next.js, Vue, SPA routing, frontend state-management frameworks, or a frontend build pipeline.
- Use plain CSS and **minimal vanilla JavaScript** only for interactions that require it (calendar drag-and-drop, fetching updates, client-side feedback). No component framework is needed.
- The server renders the initial calendar, forms, data, and empty/error states; JavaScript progressively enhances the experience rather than generating the entire interface from scratch.
- Keep HTTP page routes (`/bookings` or `/`) separate from resource JSON routes (`/api/v1/...`). **SSR page responses are HTML**, not JSON envelopes; **all JSON API responses with a body** MUST follow the existing API Design Skill: top-level `data`, `code`, `timestamp`.
- The UI MUST use the same booking service and validation logic as the REST API. Do not duplicate backend business rules inside templates or browser JavaScript.
- Prefer built-in Express/static-file handling and native browser features over new dependencies.

## 2. Scope and navigation

**One primary screen: Room-based Weekly Calendar.**

- Display **7 consecutive days** in a calendar grid, with previous-week and next-week navigation.
- Include **one room dropdown** for R1–R6; the selected room determines what is **displayed**, not what the server **validates**.
- **Do not** build a tutor calendar, student calendar, separate dashboard, resource planner, or Google Calendar clone.
- Show the selected week and room in the URL to support refresh/share/back navigation, e.g. `GET /bookings?week=2026-03-03&room=R1` (week is the visible 7-day period, preferably Tuesday–Monday for the seed period). Canonicalize invalid or missing query values on the server.
- Include a prominent, labeled **New booking** action. Form fields: student, tutor, room (prefilled/locked to current room where appropriate), date, start time, duration **60 or 90**, and optional note.
- Clicking a booking opens a simple edit form/panel. Show booking ID, student, tutor, room, time range, and status. Provide cancellation as an explicit, confirmed action.
- Show status clearly: `booked`, `cancelled`, `no_show`. `cancelled` may be visible as a subdued historical item but must **not** appear as an occupied slot; `no_show` remains a booked resource for conflict purposes.
- Display **Monday as closed** (visually muted and unavailable for creating/rescheduling), but **never hide historical Monday bookings** such as L032.
- Preserve and visibly distinguish existing historical collisions (e.g. paired records); do not silently merge, clean, or drop imported lessons.
- Choose the visible time range from the data or owner-approved configuration. **MUST NOT invent exact centre opening/closing hours** from the phrase “mid-morning to mid-evening.”

## 3. Calendar interaction rules

- Use a 7-column day grid, 30-minute snapping for the MVP, and display event blocks at the correct **60- or 90-minute height**. 30-minute grid precision is a UI decision, not an assertion that the centre has a formally documented start-time policy.
- Same-room **drag-and-drop** reschedules a booking earlier/later or to another visible day. Preserve student, tutor, **room**, and `duration_min`.
- Cross-room drag-and-drop is **not supported**. A room change uses **Cancel old booking → choose destination room → Create new booking**, with a clear warning that these two steps are **not atomic** and the old booking may remain cancelled if the new booking is rejected.
- Room transfer cancellation must use `reason: "administrative_room_change"` and must not be presented as a billable family cancellation. Billing automation is out of scope.
- Before dropping, an optional local preview may show the proposed position; it MUST NOT claim availability has been confirmed.
- On drop: send a `PATCH` request to `/api/v1/bookings/{id}` containing proposed `date` and `start_time`, with a version precondition if supplied by the API. Display the changed block only on success.
- On **409**, **412**, **422**, network error, or any other failure: restore the original position (or re-render/refetch), show a plain-language error, and keep the user’s existing form input where safe.
- Do not make a room seem available based only on the selected room view. The server MUST check tutor and student overlaps **across all rooms**, room occupancy, six bookings per tutor per day, Monday closure, and permitted durations.
- Always provide an **edit form** as a keyboard/touch-accessible alternative to dragging.

## 4. Rendering, forms, and API contract

### Page routes (HTML)

| Method | Path | Result |
|---|---|---|
| `GET` | `/` | Redirect to or render the booking calendar |
| `GET` | `/bookings?week=YYYY-MM-DD&room=R1` | `200 text/html`: Pug weekly room calendar |

The page controller obtains prevalidated view data from a booking/calendar service. It passes plain view-models to Pug (e.g. `weekDays`, `roomOptions`, `events`, `timeLabels`, `selectedRoom`, `csrfToken` if applicable). It MUST NOT query raw CSV files or execute database statements in the template.

### Booking mutations (JSON)

Use the **existing** REST API; do not add UI-specific RPC endpoints:

| Action | Endpoint | Expected success |
|---|---|---|
| Read bookings for a week/room | `GET /api/v1/bookings?from=&to=&room=` | `200` |
| Fetch tutor options | `GET /api/v1/tutors` | `200` |
| Fetch rooms | `GET /api/v1/rooms` | `200` |
| Create | `POST /api/v1/bookings` | `201` and `Location` |
| Edit / same-room drag | `PATCH /api/v1/bookings/{id}` | `200` or bodyless `204` |
| Cancel | `PATCH /api/v1/bookings/{id}` with `status: "cancelled"` and `reason` | `200` or bodyless `204` |
| Inspect history (optional detail panel) | `GET /api/v1/bookings/{id}/changes` | `200` |

- `fetch` mutation requests MUST use `Content-Type: application/json`; include `If-Match` when the API requires an ETag and handle `412 Precondition Failed` as “This booking changed; reload before saving.”
- The JSON envelope is `{ "data": {}, "code": { "http_status": 200, "key": "SUCCESS", "message": "..." }, "timestamp": { "iso": "..." } }`. **Use the actual HTTP status** to determine success; do not rely solely on `code.key` or a message string.
- Handle `204 No Content` without attempting `response.json()`.
- Map `409` to scheduling conflict, `422` to invalid input, `404` to missing booking, `412` to stale version, and unexpected errors to a neutral retry message. Do not show raw SQL errors or stack traces.
- Use user-facing clear field labels and error text, for example: **“T1 is already teaching in another room at this time.”**
- For cancellations, include explicit confirmation and a required/appropriate cancellation reason. Do not silently delete or hide the source record.

## 5. Data source and schedule formatting

- Source initial bookings from **`lessons_export.csv`** and tutor options from **`tutors.csv`**, imported into SQLite by the backend. The browser and Pug templates MUST NOT read CSV files directly.
- Preserve `lesson_id`, tutor IDs (T1–T3 in seed), and existing statuses/notes. Define R1–R6 as rooms even if the seed uses only R1–R3.
- Render local times in `Asia/Ho_Chi_Minh`; treat event intervals as half-open `[start, end)` and derive the end time from `start_time + duration_min`.
- Use a **pinned reference date in the seed-data period** for demos that depend on “today”; do not silently switch to the real current date and display an empty week.
- Distinguish an imported historical scheduling anomaly from an invalid **new** operation. Historical records remain visible, but newly submitted invalid changes are rejected.
- Do not assume a record's `cancelled_at` means a tutor was informed. If the change is after the 16:00 previous-day cut-off, show “Needs manual communication” only when actually supported by the server's audit/notification-intent model.

## 6. Pug and Express conventions

Recommended minimal file layout:

```text
src/
  app.js
  routes/
    pages.js
    api.js
  controllers/
    bookings-page.js
  services/
    bookings.js
  views/
    layout.pug
    bookings/
      week.pug
      _booking-card.pug
      _booking-form.pug
  public/
    css/app.css
    js/calendar.js
```

Express view configuration:

```js
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));
app.use('/assets', express.static(path.join(__dirname, 'public')));
```

Example Pug (server renders the initial page):

```pug
extends ../layout

block content
  main
    h1 Booking Calendar
    form(method='GET', action='/bookings')
      label(for='room') Room
      select#room(name='room')
        each room in roomOptions
          option(value=room.id, selected=room.id === selectedRoom)= room.label
      input(type='hidden', name='week', value=weekStart)
      button(type='submit') View room
    //- Render day columns and booking cards from server-provided view models.
    //- Do not build domain rules or perform DB access inside Pug.
```

- Use a shared `layout.pug`, reusable Pug includes/mixins, and meaningful semantic markup (`main`, `form`, `button`, `label`).
- Prefer normal **escaped Pug interpolation** (`=` or `#{}`) for all data from CSV or users; **MUST NOT** use unescaped interpolation (`!=` or `!{}`) for untrusted fields.
- Use ordinary Pug `if` and `each` for presentation, not business logic.
- Bundle local CSS/JS under `/assets`, without a frontend compiler or CDN dependency.
- Do not inject entire API JSON objects into unsafe inline scripts; if passing state to JavaScript, use minimal escaped `data-*` attributes or carefully serialized JSON with safe HTML escaping.

## 7. UX, accessibility, and safety

- Favor legible, compact, responsive UI. The calendar should remain usable on narrower screens via horizontal scroll; do not squeeze seven columns below readable width.
- Every input needs a visible label; errors must be next to the relevant field or announced in a clear error summary.
- Never rely solely on color to communicate `booked` / `cancelled` / `no_show`, conflict, or Monday closure; use text/status labels.
- Provide keyboard-operable buttons/forms for every drag-and-drop outcome and visible focus states; provide an `aria-live` result message for successful and failed mutations.
- Show a loading/saving state to avoid accidental duplicate submits. Disable only the in-flight control, not the entire UI.
- Treat all data (including CSV `note` fields) as untrusted text: escape output, validate input, prevent reflected/stored XSS, and protect state-changing requests against CSRF if cookie/session authentication is used. Same-origin requests alone are not an adequate CSRF defense.
- Use secure default HTTP headers (e.g. `helmet` if available) and keep error messages free of internal details. Never trust client-provided room, tutor, time, status, or booking version without server-side verification.

## 8. Testing and acceptance

**Functional:**

- [ ] Initial SSR page loads using data imported from both CSVs; R1–R6 dropdown works.
- [ ] Seven days are shown and week navigation retains the selected room.
- [ ] Monday is visibly closed but imported Monday lesson L032 is still visible in its week.
- [ ] Existing conflicts such as L009/L010 are visible without being silently collapsed.
- [ ] Booking form creates valid 60- and 90-minute bookings; invalid duration is rejected.
- [ ] Same-room dragging preserves 60/90-minute duration and booking identity.
- [ ] Moving a booking into a tutor conflict **in another room** is rejected and the event returns to its original position.
- [ ] Room transfer is offered only as Cancel + Create and the UI explains its non-atomic behavior.
- [ ] Cancelling shows a confirmation and preserves the original booking history.
- [ ] API errors and stale versions are displayed without destroying unsaved UI state.
- [ ] Page refresh reflects persisted changes; no synthetic bookings replace seed data.

**Non-functional:**

- [ ] HTML renders even when JavaScript is unavailable; forms remain understandable, though drag-and-drop requires JS.
- [ ] No React, SPA framework, calendar SDK, or frontend build step was added.
- [ ] Pug escapes user-controlled strings; mutations are validated on the server.
- [ ] Error messages are understandable to a receptionist and HTML is keyboard navigable.

## 9. Explicit non-goals

Do **not** add tutor/student calendar screens, full Google Calendar feature parity, cross-room dragging, live multiplayer updates, automatic WhatsApp/email delivery, billing, role-management dashboards, or advanced schedule optimization. These are outside the selected front-desk workflow.

## Related project contract

This skill complements `API_DESIGN_SKILL.md` (or `.agents/skills/api-design/SKILL.md`). **Follow the API Design Skill for all `/api/v1` routes and JSON envelopes; this UI skill governs HTML SSR, forms, and client interactions.**
