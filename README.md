# Bright Path Booking Management

A front-desk booking tool for Bright Path Learning Centre. SQLite setup/import and all read-only APIs (Rooms, Tutors, Booking list/detail, and Booking history) are implemented. Booking mutations and the Pug interface remain placeholders.

## Requirements

- Node.js **22.17.0 or newer** and npm. Tested with Node.js 22.17.1 and npm 10.9.2.
- Run the commands below from the repository root after cloning the project.

SQLite uses Node's built-in [`node:sqlite`](https://nodejs.org/download/release/v22.17.0/docs/api/sqlite.html) module; no separate SQLite server, command-line tool, Python installation, or native database npm addon is required. Node.js 22 may print an `ExperimentalWarning` for this module; the commands still run normally.

Dependencies, including [`csv-parse`](https://csv.js.org/parse/api/sync/), are recorded in `package-lock.json`. Use `npm ci` to reproduce the locked installation.

## Set up a fresh database

```sh
npm ci
npm run db:setup
npm run db:verify
npm test
```

The setup command creates **`data/bright-path.sqlite`**, applies `src/db/schema.sql`, and imports:

- `data/tutors.csv`
- `data/lessons_export.csv`
- Fixed room reference records R1–R6

Successful setup and verification report these counts:

```json
{
  "tutors": 3,
  "rooms": 6,
  "bookings": 34,
  "booking_changes": 34
}
```

The local database and its journal/sidecar files are ignored by Git. Keep the CSV files and lockfile in the repository so another device can reproduce the baseline.

## Repeat the process with another database

Setup is deliberately **first-import-only**. Running it again against populated application tables exits with code 1 and preserves existing records and history. Application startup does not automatically import data.

To run another fresh import without changing an existing database, choose an unused path:

```sh
npm run db:setup -- --db data/bright-path-demo.sqlite
npm run db:verify -- --db data/bright-path-demo.sqlite
```

These npm commands work in Windows PowerShell, macOS shells, and Linux shells. Quote paths containing spaces. Setup creates missing parent directories.

Path precedence is `--db`, then the exported `DATABASE_PATH` environment variable, then `data/bright-path.sqlite`. Relative paths resolve against the repository root. The scripts do not automatically load `.env` files.

There is no automatic reset or overwrite command. Schema version 1 is stored in SQLite's `user_version`; unsupported versions and unrelated existing databases are rejected rather than migrated or replaced.

## Import behavior

Schema creation, tutor/room insertion, bookings, and baseline history are committed in one `BEGIN IMMEDIATE` transaction. A failure rolls back the operation. A failed first setup can leave an empty database file, which can be retried after the input problem is corrected.

The importer validates CSV headers, field counts, required values, real calendar dates, times, durations, statuses, cancellation timestamps, and database references. It supports UTF-8 BOMs, CRLF/LF line endings, quoted commas, escaped quotes, and multiline fields. Invalid input fails the command with a filename/record or database constraint error; records are not silently skipped.

Seed values remain unchanged except for the documented storage mapping: durations become integers, and empty optional `note`/`cancelled_at` fields become SQL `NULL`. Every imported booking starts at version 1. Names, notes, masked tutor phone numbers, and supplied cancellation timestamp offsets are preserved.

Historical scheduling violations are intentionally retained, including L007/L008, L009/L010, L032, L033/L034, and T1's seven bookings on 2026-03-06. New-booking overlap, capacity, and Monday rules belong to the future API service; those policy checks do not run during seed import.

Each booking receives one immutable `imported` history record containing its full baseline snapshot. `changed_at` records the actual import instant in UTC, while previous state and communication status remain unknown (`NULL`). This timestamp does not assert when the spreadsheet booking was last edited or communicated. Tests inject a fixed import clock for repeatability.

Booking dates and start times retain their `Asia/Ho_Chi_Minh` local meaning. Import does not convert them using the executing device's timezone.

## Verification and tests

```sh
npm run db:verify
npm run test:db
```

`db:verify` opens the existing database **read-only** and checks schema version, SQLite integrity, foreign keys, counts, every tutor and booking against the CSV source, all six rooms, and each baseline history snapshot. It does not create a missing database. It is an exact **seed-baseline check**, so it is expected to fail after staff intentionally change bookings or the source CSV files.

`npm test` runs all tests; `npm run test:db` runs only database tests; `npm run test:api` runs API tests. Tests use in-memory databases and isolated temporary files, clean up their own files, and never reset the default database. Database coverage includes:

- Full seed preservation, including historical conflicts, no-shows, and cancellations.
- Repeated-import rejection without overwriting staff changes.
- Complete rollback after a late reference or audit-insert failure.
- Quoted/multiline CSV input and malformed data rejection.
- Database constraints, append-only history, and booking retention.
- Verification detecting modified records without rewriting them.
- CLI persistence, paths containing spaces, missing-file failures, and execution from another working directory.

Database details and the boundary between SQLite constraints and future API validation are documented in [designs/db_designs.md](designs/db_designs.md).

## Start the API

After setting up the database, run:

```sh
npm start
```

The default address is **http://127.0.0.1:3000/api/v1/rooms**. `npm run dev` starts the same entry point with Node's file watcher. Stop the application with Ctrl+C; the server stops accepting requests and closes its database connection. Startup opens the existing database and never creates a schema or imports CSV data. A missing database or unsupported/uninitialized schema produces an error and exits with code 1.

| Environment variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | Listening hostname/IP |
| `PORT` | `3000` | Port 0–65535; 0 asks the OS for an available port |
| `DATABASE_PATH` | `data/bright-path.sqlite` | Existing database, relative to the project root or absolute |

Set exported environment variables before `npm start` to override these values. For example, in PowerShell:

```powershell
$env:PORT = '3100'
$env:DATABASE_PATH = 'data/bright-path-demo.sqlite'
npm start
```

The database selected here must already have been initialized using `npm run db:setup -- --db data/bright-path-demo.sqlite`. `.env` files are not automatically loaded.

## Room API

`GET /api/v1/rooms` returns every stored room, sorted by `room_id`. It takes no required parameters and does not mutate the database. On the seeded database it returns R1–R6, including rooms with no bookings.

Test it from another PowerShell terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/rooms | ConvertTo-Json -Depth 5
```

Or use curl (`curl.exe` in Windows PowerShell):

```sh
curl http://127.0.0.1:3000/api/v1/rooms
```

The response is HTTP 200 with `Content-Type: application/json`:

```json
{
  "data": {
    "items": [
      { "room_id": "R1" },
      { "room_id": "R2" },
      { "room_id": "R3" },
      { "room_id": "R4" },
      { "room_id": "R5" },
      { "room_id": "R6" }
    ]
  },
  "code": {
    "http_status": 200,
    "key": "ROOMS_RETRIEVED",
    "message": "Rooms retrieved successfully."
  },
  "timestamp": {
    "iso": "2026-03-03T06:00:00.000Z"
  }
}
```

The timestamp above is illustrative; actual responses use the current server instant, independent of a future pinned booking-demo clock.

`HEAD` returns headers without a body. `OPTIONS` returns bodyless 204 and `Allow: GET, HEAD, OPTIONS`. Room mutations return 405 with the same `Allow` header; unknown `/api/v1` paths return 404. JSON parse errors return 400, oversized JSON bodies return 413 (16 KiB limit), and unsupported JSON charset/content encoding returns 415. Unexpected failures return a safe 500 response. All API JSON bodies use the same `data`, `code`, and `timestamp` envelope.

The feature follows routes → controller → service → repository. `createApp` composes these layers without opening a database or listening on a port; `index.js` owns startup and shutdown. API tests cover isolated routing, controllers, services, SQL reads, HTTP contracts/error handling, configuration, and starting/restarting the actual entry point on localhost with a disposable seeded database.

## Tutor API

`GET /api/v1/tutors` returns `data.items`, sorted by `tutor_id`. Each tutor contains `tutor_id`, `tutor_name`, `subject`, and `phone`. The seeded response contains T1–T3 and preserves masked phone numbers as text.

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/tutors | ConvertTo-Json -Depth 5
```

Success uses the standard JSON envelope with code `TUTORS_RETRIEVED`. `HEAD` and `OPTIONS` are supported; mutation methods return 405. Run `npm run test:api` for repository, service, controller, routing, and HTTP tests.

## Booking reads

| Endpoint | Success data | Success code |
|---|---|---|
| `GET /api/v1/bookings` | `{ "items": [...] }` | `BOOKINGS_RETRIEVED` |
| `GET /api/v1/bookings/{lesson_id}` | `{ "booking": {...} }` | `BOOKING_RETRIEVED` |

The list accepts optional `from`, `to`, and `room` query parameters. `from` includes the given local start date; `to` excludes the given local start date. For a seven-day schedule use, for example, `from=2026-03-03&to=2026-03-10`. Omitted bounds are unrestricted, and omitting all filters returns every booking. Filtering uses the lesson's start date, not interval intersection.

Dates must be real `YYYY-MM-DD` dates, `to` must be later than `from` when both are supplied, and `room` must identify an existing room. Unknown filters, empty values, and repeated filter parameters return 422 with code `INVALID_BOOKING_FILTER` and `data.details.field`. A valid query with no matches returns 200 and an empty array.

```powershell
Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/bookings?from=2026-03-03&to=2026-03-10&room=R1' | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:3000/api/v1/bookings/L001 | ConvertTo-Json -Depth 5
```

Booking objects contain `lesson_id`, `date`, `start_time`, `duration_min`, `student`, `tutor_id`, `room`, `status`, `cancelled_at`, `note`, and `version`. Lists are sorted by `date`, `start_time`, then `lesson_id`. All statuses and historical anomalies remain readable; overlapping records are not merged or hidden. No new history is created by reads.

Detail responses include a strong booking-version ETag, for example `ETag: "booking-L001-v1"`. A matching `If-None-Match` returns bodyless 304; `HEAD` returns headers including the ETag without a body. A missing booking returns 404 with code `BOOKING_NOT_FOUND`; invalid URL encoding returns 400 with code `INVALID_PATH`. `OPTIONS` returns bodyless 204; unsupported mutation methods currently return 405. These version ETags will be used as edit preconditions when booking mutations are implemented.

## Booking history

`GET /api/v1/bookings/{lesson_id}/changes` returns `data.items` with code `BOOKING_CHANGES_RETRIEVED`. Records are sorted by ascending audit `id` (append order), rather than timestamps that could differ because of clock adjustments.

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/bookings/L001/changes | ConvertTo-Json -Depth 8
```

Each history item includes `id`, `lesson_id`, `action`, `changed_at`, `before_snapshot`, `after_snapshot`, `reason`, and `needs_manual_communication`. Snapshots are JSON objects in the API response, rather than encoded JSON strings. `before_snapshot` can be `null`. The communication flag is `true`, `false`, or `null` (unknown); imported baselines have a null flag, no before snapshot, and no reason. `changed_at` for those baselines is the import instant and does not reconstruct earlier spreadsheet edits or prove notification delivery.

A missing booking returns 404 (`BOOKING_NOT_FOUND`), while an existing booking with no audit records returns 200 with an empty array. A blank ID returns 422 (`INVALID_BOOKING_ID`). `HEAD` and `OPTIONS` follow the same bodyless behavior as the other read APIs; mutation methods return 405. Reading history never inserts or modifies audit records.

`npm run test:api` tests all read features at their repository, service, controller, routing, and HTTP boundaries. It also starts the actual `index.js` process against a temporary seeded database, calls all read endpoints on localhost, restarts it, and verifies the seed remains unchanged.
