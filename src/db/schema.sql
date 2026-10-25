PRAGMA foreign_keys = ON;

CREATE TABLE tutors (
    tutor_id   TEXT NOT NULL PRIMARY KEY CHECK (length(trim(tutor_id)) > 0),
    tutor_name TEXT NOT NULL CHECK (length(trim(tutor_name)) > 0),
    subject    TEXT NOT NULL CHECK (length(trim(subject)) > 0),
    phone      TEXT NOT NULL CHECK (length(trim(phone)) > 0)
);

CREATE TABLE rooms (
    room_id TEXT NOT NULL PRIMARY KEY
        CHECK (room_id IN ('R1', 'R2', 'R3', 'R4', 'R5', 'R6'))
);

CREATE TABLE bookings (
    lesson_id    TEXT NOT NULL PRIMARY KEY CHECK (length(trim(lesson_id)) > 0),
    date         TEXT NOT NULL CHECK (
        date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
    start_time   TEXT NOT NULL CHECK (
        start_time GLOB '[0-2][0-9]:[0-5][0-9]'
        AND substr(start_time, 1, 2) BETWEEN '00' AND '23'
    ),
    duration_min INTEGER NOT NULL CHECK (
        typeof(duration_min) = 'integer' AND duration_min IN (60, 90)
    ),
    student      TEXT NOT NULL CHECK (length(trim(student)) > 0),
    tutor_id     TEXT NOT NULL REFERENCES tutors(tutor_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    room         TEXT NOT NULL REFERENCES rooms(room_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    status       TEXT NOT NULL DEFAULT 'booked'
        CHECK (status IN ('booked', 'cancelled', 'no_show')),
    cancelled_at TEXT,
    note         TEXT,
    version      INTEGER NOT NULL DEFAULT 1
        CHECK (typeof(version) = 'integer' AND version >= 1),
    CHECK (
        (status = 'cancelled' AND cancelled_at IS NOT NULL
            AND length(trim(cancelled_at)) > 0)
        OR (status <> 'cancelled' AND cancelled_at IS NULL)
    )
);

CREATE TABLE booking_changes (
    id              INTEGER PRIMARY KEY,
    lesson_id       TEXT NOT NULL REFERENCES bookings(lesson_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    action          TEXT NOT NULL
        CHECK (action IN ('imported', 'created', 'updated', 'cancelled')),
    changed_at      TEXT NOT NULL CHECK (length(trim(changed_at)) > 0),
    before_snapshot TEXT CHECK (
        before_snapshot IS NULL OR
        CASE WHEN json_valid(before_snapshot)
            THEN json_type(before_snapshot) = 'object' ELSE 0 END
    ),
    after_snapshot  TEXT NOT NULL CHECK (
        CASE WHEN json_valid(after_snapshot)
            THEN json_type(after_snapshot) = 'object' ELSE 0 END
    ),
    reason          TEXT,
    needs_manual_communication INTEGER CHECK (
        needs_manual_communication IS NULL OR
        (typeof(needs_manual_communication) = 'integer'
            AND needs_manual_communication IN (0, 1))
    ),
    CHECK (
        (action IN ('imported', 'created') AND before_snapshot IS NULL)
        OR (action IN ('updated', 'cancelled')
            AND before_snapshot IS NOT NULL
            AND reason IS NOT NULL AND length(trim(reason)) > 0)
    ),
    CHECK (
        (action = 'imported' AND needs_manual_communication IS NULL)
        OR (action <> 'imported' AND needs_manual_communication IS NOT NULL)
    )
);

CREATE TRIGGER booking_changes_no_update
BEFORE UPDATE ON booking_changes
BEGIN
    SELECT RAISE(ABORT, 'Booking history is append-only');
END;

CREATE TRIGGER booking_changes_no_delete
BEFORE DELETE ON booking_changes
BEGIN
    SELECT RAISE(ABORT, 'Booking history is append-only');
END;

CREATE TRIGGER bookings_no_delete
BEFORE DELETE ON bookings
BEGIN
    SELECT RAISE(ABORT, 'Cancel bookings instead of deleting them');
END;

CREATE INDEX bookings_room_date_time
    ON bookings(room, date, start_time);
CREATE INDEX bookings_tutor_date
    ON bookings(tutor_id, date);
CREATE INDEX bookings_student_date
    ON bookings(student, date);
CREATE INDEX booking_changes_lesson_sequence
    ON booking_changes(lesson_id, id);
