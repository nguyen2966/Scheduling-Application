## 1. Understanding the Problem

### 1.1. Context

Bright Path Learning Centre manages its scheduling through a shared spreadsheet and WhatsApp. Mai is the only person who fully understands the process of creating, updating, and communicating bookings, but she will go on leave in eight weeks.

This creates three key problems:

- **Operational dependency:** Her replacement may struggle to manage bookings without Mai's knowledge of the spreadsheet and its unwritten rules.
- **Scheduling correctness:** The seed data contains student overlaps (L007/L008), tutor overlaps (L033/L034), an exceeded daily tutor limit, and a booking on a closed day (L032).
- **Communication gaps:** Tutors receive multiple versions of their schedules and have sometimes arrived for lessons that were already cancelled.

**Assessment:** The underlying problem is not simply the spreadsheet itself, but a booking workflow that lacks consistent enforcement of business rules and relies heavily on one person.

The immediate priority is to make daily booking operations understandable and manageable by someone other than Mai.

### 1.2. Contradictions & Ambiguities

| Issue | Evidence / Uncertainty |
|---|---|
| **One-to-one vs. paired lessons** | Mai regularly pairs two students with one tutor in the same room (L009/L010), despite the stated one-to-one model. |
| **Rules vs. actual operations** | T1 has seven bookings in one day, and L032 falls on Monday when the centre is closed. It is unclear whether exceptions are authorized. |
| **Operating hours** | "Mid-morning to mid-evening" does not define exact operating hours. |
| **16:00 cut-off** | Changes after the cut-off must remain visible, but the CSV does not record which schedule version tutors were previously told about. |
| **Cancellation policy** | The four-hour cancellation rule does not clearly address tutor-initiated cancellations, such as L017. |

### 1.3. Questions for the Owner

| Question | Impact on the solution |
|---|---|
| **Which responsibilities must Mai's replacement handle independently?** | Determines the essential booking operations and UI workflow. |
| **Are paired lessons and exceptions to scheduling rules officially allowed?** | Determines the data model, validation rules, and whether an approval mechanism is needed. |
| **Who must be informed about changes after the 16:00 cut-off, and is acknowledgment required?** | Determines audit, notification, and acknowledgment requirements. |
| **What are the centre's exact operating hours?** | Defines valid booking time boundaries. |
| **Who is authorized to create, update, or cancel bookings?** | Determines access control and approval requirements. |
| **Do tutor-initiated and family-initiated cancellations follow the same charging policy?** | Determines cancellation and billing behavior. |

### 1.4. Working Assumptions

- **Published rules take precedence:** New bookings follow the documented rules. Paired lessons and rule overrides are not supported without clarification.
- **Preserve seed data:** Existing records, including invalid bookings, remain unchanged during import.
- **Booking statuses:** `cancelled` releases the room and time slot; `no_show` does not.
- **Cut-off behavior:** Changes after 16:00 are allowed but must be recorded. A saved change does not imply successful notification.
- **Operating hours:** No exact opening or closing times will be invented.
- **MVP access:** The tool is assumed to be operated by an authorized staff member; full role-based access control is deferred.
- **Reference time:** Any logic requiring the current date uses a fixed timestamp within the seed data period.

---

## 2. Feature Prioritisation

### 2.1. Candidate Features

| Feature | Business Value |
|---|---|
| **Front-Desk Booking Management** | Enables staff to view, create, and update bookings with business rules enforced by the system. |
| **Daily Schedule Visibility** | Allows the owner and staff to access the current schedule without navigating the spreadsheet. |
| **Schedule Change Communication** | Ensures affected people are informed when bookings change. |
| **Cancellation & Billing** | Handles cancellation policies, lesson charges, and tutor payments. |
| **Tutor Self-Service** | Reduces reliance on the receptionist by allowing tutors to access schedules or request changes. |
| **Resource & Capacity Planning** | Helps manage tutor availability, rooms, and scheduling capacity. |

### 2.2. Selected Feature: Front-Desk Booking Management

**I chose to build a simple web-based booking management tool that allows staff to view, create, and update bookings instead of editing the spreadsheet directly.**

The core workflow includes:

1. **View:** Browse bookings by date and tutor.
2. **Create / Update:** Manage bookings through a shared form.
3. **Validate:** Enforce student, tutor, and room availability, the six-booking daily tutor limit, and operating days.
4. **Persist:** Save valid changes and preserve booking history, including changes after the 16:00 cut-off.
5. **Feedback:** Display clear success messages or explain why a booking was rejected.

Conflict detection and change tracking are safeguards within booking management, rather than separate competing features.

### 2.3. Why This Feature First?

**Operational continuity:** Mai's upcoming leave creates an immediate need for a workflow that another staff member can understand and operate without relying on her knowledge of the spreadsheet.

**Evidence-based impact:** The seed data demonstrates actual scheduling violations. Validating bookings when they are created or updated helps prevent similar problems.

**Practical usability:** A simple interface makes scheduling accessible to non-technical staff and allows the owner to inspect the current schedule without interacting with an API.

**Consistent operations:** Centralizing booking changes behind a validated workflow reduces manual spreadsheet errors and preserves a record of what changed.

### 2.4. Trade-offs & Alternatives

- **Daily Schedule Visibility** is useful but does not allow staff to manage bookings. A basic schedule view is therefore included in the selected workflow.
- **Schedule Change Communication** directly addresses delayed notifications, but reliable delivery requires additional handling of recipients, failures, and acknowledgments.
- **Cancellation & Billing** addresses financial rules, but important exceptions remain unclear and require confirmation before implementation.

**What remains unsolved:** The tool does not automatically notify tutors or families, enforce cancellation charges, or replace every responsibility currently handled by Mai. These limitations will be discussed further in the Reflection section.

**Decision:** Prioritize one reliable, end-to-end booking management workflow that staff can use independently, rather than several partially implemented capabilities.

## 3. Design & Implementation

### 3.1. User Interface & Booking Workflow

The tool provides a **Google Calendar-like weekly view**, displaying seven days at a time with a dropdown to select one of six rooms (R1–R6).

Staff can:

- **View:** Browse the selected room's weekly schedule.
- **Create:** Click an empty time slot to create a 60- or 90-minute booking.
- **Edit:** Click an existing booking to update its details.
- **Reschedule:** Drag a booking to an earlier or later time, or another day, within the same room.
- **Cancel:** Cancel a booking without deleting its history.

The calendar uses 30-minute time increments. Monday remains visible but is marked as closed. Existing historical bookings on closed days are still displayed.

**Same-room rescheduling**

Drag-and-drop changes only the booking's date and start time, preserving its student, tutor, room, and duration.

Before accepting the change, the backend validates the tutor's availability **across all six rooms**, as well as student availability, room availability, daily tutor limits, and operating-day rules.

If validation fails, the booking returns to its original position with a clear error message.

**Changing rooms**

Cross-room drag-and-drop is deliberately excluded.

To move a lesson to another room, staff:

1. Cancel the original booking, specifying an administrative room-change reason.
2. Select the destination room from the dropdown.
3. Create a new booking using the existing validated creation workflow.

These are separate operations, not an atomic transfer. If the new booking fails validation, the original remains cancelled and staff must manually restore or reschedule it.

An administrative room change must not automatically trigger a late-cancellation charge.

### 3.2. Data Model

The supplied `lessons_export.csv` and `tutors.csv` are imported into SQLite without modifying the original files.

| Entity | Key Fields | Purpose |
|---|---|---|
| **Tutor** | `tutor_id`, `tutor_name`, `subject`, `phone` | Tutor data imported from CSV |
| **Room** | `room_id` | Six rooms, R1–R6 |
| **Booking** | `lesson_id`, `date`, `start_time`, `duration_min`, `student`, `tutor_id`, `room`, `status`, `cancelled_at`, `note`, `version` | Current booking state |
| **BookingChange** | `id`, `lesson_id`, `action`, `changed_at`, `before_snapshot`, `after_snapshot`, `reason` | Immutable history of booking changes |

**Design decisions:**

- Preserve original `lesson_id` values for traceability.
- Derive `end_time` from `start_time + duration_min`.
- Use `Asia/Ho_Chi_Minh` for scheduling and cut-off calculations.
- Support `booked`, `cancelled`, and `no_show` statuses.
- Rescheduling updates the existing booking rather than creating a new one.
- Each successful update or cancellation creates a `BookingChange` record in the same transaction.
- Student names are used for matching because the CSV does not provide stable student IDs.

**Changes after the 16:00 cut-off**

Tomorrow's schedule is finalized at 16:00 today. Changes after this cut-off remain allowed but must be traceable.

The system records the previous and new booking states, timestamp, and reason. Changes affecting a schedule whose cut-off has passed are flagged for manual communication.

The CSV contains no notification history, so the system does not assume that a tutor has received the latest schedule.

### 3.3. Business Rules & Enforcement

| Rule | Enforcement |
|---|---|
| Duration must be 60 or 90 minutes | Database `CHECK` |
| Valid booking status and tutor reference | Database constraints |
| No overlapping bookings for the same student | Backend validation |
| No overlapping bookings for the same tutor, across all rooms | Backend validation |
| One active lesson per room at a time | Backend validation |
| Maximum 6 bookings per tutor per day | Backend validation |
| No new bookings on Monday | Backend validation |
| `cancelled` releases occupied resources | Booking lifecycle logic |
| `no_show` retains occupied resources | Booking lifecycle logic |
| Booking changes preserve history | Database transaction |

Two bookings overlap when:

`existing.start < proposed.end AND proposed.start < existing.end`

For updates, the current booking is excluded from its own conflict check.

Only `booked` and `no_show` records block availability; `cancelled` records do not.

**All validation is performed server-side across the complete dataset**, regardless of the room currently displayed in the UI.

Validation and persistence run within a SQLite write transaction to prevent concurrent requests from creating conflicting bookings.

Existing violations in the seed data are preserved. Published rules apply to new operations, while paired lessons and exact operating hours remain subject to owner clarification.

### 3.4. API Design

The frontend communicates with a minimal REST API.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/bookings?from=&to=&room=R1` | Retrieve the selected room's weekly schedule |
| `GET` | `/api/tutors` | Populate tutor options |
| `GET` | `/api/rooms` | Retrieve R1–R6 |
| `POST` | `/api/bookings` | Create a validated booking |
| `PATCH` | `/api/bookings/{id}` | Edit or reschedule within the same room |
| `POST` | `/api/bookings/{id}/cancel` | Cancel a booking and record its reason |
| `GET` | `/api/bookings/{id}/changes` | Retrieve booking change history |

**Create booking**

`POST /api/bookings`

```json
{
  "student": "Le Minh Chau",
  "tutor_id": "T2",
  "room": "R2",
  "date": "2026-03-07",
  "start_time": "13:00",
  "duration_min": 90
}
```

**Same-room rescheduling**

`PATCH /api/bookings/L001`

```json
{
  "date": "2026-03-03",
  "start_time": "13:00",
  "version": 1
}
```

Drag-and-drop preserves the original duration and room. The edit form may change the student, tutor, or duration, but room transfers follow the separate Cancel + Create workflow.

The `version` field prevents outdated UI changes from silently overwriting newer booking updates.

**Cancel booking**

`POST /api/bookings/L001/cancel`

```json
{
  "reason": "administrative_room_change",
  "version": 1
}
```

Cancellation records its reason, releases the occupied slot, and preserves the original booking for historical reference.

**API responses**

- `201 Created` — Booking created.
- `200 OK` — Booking updated or cancelled.
- `404 Not Found` — Booking does not exist.
- `409 Conflict` — Scheduling conflict or stale booking version.
- `422 Unprocessable Entity` — Invalid duration, operating day, or request data.

Errors return machine-readable codes and clear explanations for the receptionist.

**Rejected endpoint: `POST /api/bookings/{id}/transfer-room`**

A dedicated room-transfer API is unnecessary for the selected workflow. Staff can use the existing cancellation and creation operations, with the non-atomic limitation documented.

Automated notification delivery is also deferred; recording a change does not guarantee that affected people have been informed.

### 3.5. Seed Data & Testing

The application uses the supplied CSV files as its initial dataset.

Key validation scenarios:

| Seed Records | Scenario |
|---|---|
| L007/L008 | Student overlap |
| L009/L010 | Paired-lesson ambiguity and tutor/room overlap |
| L033/L034 | Tutor overlap across different rooms |
| L018–L027 | Daily tutor booking limit |
| L032 | Booking on a closed Monday |
| L005/L017 | Cancellation and changes after the cut-off |
| L015 | No-show retains its occupied slot |

Additional tests cover:

- Creating a valid 60- or 90-minute booking.
- Rescheduling earlier or later within the same room.
- Detecting tutor conflicts in another room.
- Rejecting invalid operations without modifying data.
- Cancelling an existing booking.
- Creating a new booking in another room after cancellation.
- Preserving booking change history.
- Rejecting concurrent or stale conflicting updates.

The README documents CSV import, database initialization, application startup, reproducible tests, and a fixed reference timestamp within the seed data period.

## 4. Reflection & Next Steps

### 4.1. What I Would Build Next With One More Week

My next priority would be **reliable schedule change communication**.

The booking management tool provides a consistent source of truth, but tutors and families still depend on manual WhatsApp messages to learn about changes.

With another week, I would prioritize:

1. **Change notifications:** Notify affected tutors when bookings are created, rescheduled, or cancelled, with delivery status and failure handling.
2. **Schedule acknowledgment:** Let tutors confirm they have seen changes made after the 16:00 cut-off.
3. **Business exceptions:** Support paired lessons and authorized scheduling overrides once the owner clarifies the rules.

These improvements would further reduce the operational dependency on the receptionist.

### 4.2. Known Weaknesses

- **Manual communication:** Booking changes are recorded but do not guarantee that tutors or families have been informed.
- **Non-atomic room transfers:** Moving a lesson between rooms requires Cancel + Create. If creation fails, the original booking remains cancelled.
- **Incomplete business rules:** Paired lessons, exceptional opening days, and exact operating hours require owner clarification.
- **Student identification:** The CSV provides student names rather than stable IDs, making name-based conflict detection imperfect.
- **Limited access control:** The MVP assumes an authorized staff operator rather than implementing full authentication and role management.
- **Historical inconsistencies:** Invalid seed records are preserved, so existing scheduling conflicts remain visible until manually resolved.

The tool improves booking correctness and usability, but does not completely replace Mai's coordination responsibilities.

### 4.3. How AI Assisted

I used AI to help:

- Analyze the assessment brief and CSV data for scheduling conflicts and ambiguous business rules.
- Compare candidate features and challenge the initial prioritization.
- Review the data model, REST API design, and separation of frontend and backend responsibilities.
- Identify potential over-engineering and security concerns in implementation patterns.

AI-generated suggestions were treated as proposals rather than final decisions. I reviewed them against the assessment requirements, business constraints, and maintainability goals.

### 4.4. One AI Suggestion I Rejected

**Rejected: Treating conflict detection and rescheduling as separate competing features.**

The initial AI-assisted analysis proposed scheduling conflict detection and safe rescheduling as independent feature candidates.

I rejected this distinction because conflict validation is a necessary safeguard within booking management, not a standalone business workflow.

Instead, I chose **Front-Desk Booking Management** as one cohesive capability, combining booking creation, editing, validation, and change tracking behind a simple interface.

This better addresses the operational need for someone other than Mai to manage bookings, while keeping the implementation focused on a single business outcome.