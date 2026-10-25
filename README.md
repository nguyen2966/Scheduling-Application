# Bright Path Booking Management

A front-desk booking tool for Bright Path Learning Centre. The SQLite schema, CSV import, verification commands, and database tests are implemented. The booking API and Pug interface remain placeholders.

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

`npm test` runs the project's tests; `npm run test:db` runs only database tests. Tests use in-memory databases and isolated temporary files, clean up their own files, and never reset the default database. Coverage includes:

- Full seed preservation, including historical conflicts, no-shows, and cancellations.
- Repeated-import rejection without overwriting staff changes.
- Complete rollback after a late reference or audit-insert failure.
- Quoted/multiline CSV input and malformed data rejection.
- Database constraints, append-only history, and booking retention.
- Verification detecting modified records without rewriting them.
- CLI persistence, paths containing spaces, missing-file failures, and execution from another working directory.

Database details and the boundary between SQLite constraints and future API validation are documented in [designs/db_designs.md](designs/db_designs.md).
