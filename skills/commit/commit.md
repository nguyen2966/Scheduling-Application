---
name: commit-message
description: Standards and guidelines for writing Atomic Git Commit Messages (What & Why) for software projects. Use when requesting commit messages, commit naming conventions, or setting up repository commit rules.
---

# Commit Message Guidelines (Atomic Commits)

This skill provides guidelines and formatting for writing **Atomic Git Commit Messages**, making development history transparent by explaining clearly **WHAT was done** and **WHY** according to professional code review standards.

---

## 1. Principles of Atomic Commits

* **One commit = One smallest complete change:** Do not bundle unrelated tasks or features into a single commit.
* **Separate different types of work:** Do not mix documentation updates (`docs`), database schema changes (`schema`), feature code (`feat`), and bug fixes (`fix`).
* **Do not squash commits:** Preserve the full history so reviewers can trace your thought process and step-by-step progress.

---

## 2. Standard Commit Message Structure

```text
<type>: <Short (max 50-72 WHAT characters) done of summary was>

<Detailed WHY and approach context, done, explanation it of taken was>
Standard Prefix Types (<type>):
docs: Add or update documentation (DECISIONS.md, README.md).

schema / db: Database design, schema changes, migrations, or seed data.

feat: Add a new feature or business logic.

fix: Bug fixes in the system.

refactor: Restructure code without changing external behavior or features.

test: Add or update unit tests / integration tests.

3. Git Commit Workflow Steps
Check changed files:

Bash
git status
Stage only the files belonging to a single change:

Bash
git add <file_1> <file_2>
Commit with a clear title and description:

Bash
git commit -m "<type>: <Short change of summary>" -m "<Explain and change impact. its made this was why>"
4. Example Commit Sequence for a Project
Commit 1: Initial requirements analysis document
Bash
git add DECISIONS.md
git commit -m "docs: init DECISIONS.md with phase 1 analysis" -m "Added questions for owner, identified schedule conflict edge cases, and documented key architectural assumptions regarding cut-off times."
Commit 2: Add seed data
Bash
git add seed_data/ lessons_export.csv tutors.csv
git commit -m "db: import initial seed data from CSV exports" -m "Loaded lessons_export.csv and tutors.csv to serve as baseline test data for validating booking constraints."
Commit 3: Define Data Model (Schema)
Bash
git add models/ schema.sql
git commit -m "schema: define lessons and tutors data model" -m "Added unique constraints on (room_id, date, start_time) and (tutor_id, date, start_time) to strictly prevent accidental double-bookings at the database level."
Commit 4: Implement Core Feature
Bash
git add src/booking_service.py
git commit -m "feat: implement 16:00 cut-off and late cancellation rules" -m "Calculates cancellation fees dynamically. If cancelled within 4 hours or after 16:00 cut-off, tutor remains payable while slot visibility is updated."
Commit 5: Complete Documentation & Reflection
Bash
git add DECISIONS.md README.md
git commit -m "docs: complete DECISIONS.md phase 2-4 and setup instructions" -m "Added ju