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