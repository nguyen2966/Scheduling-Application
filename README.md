# Bright Path Booking Management

A front-desk booking application for Bright Path Learning Centre.

## Delivery limitation

Due to time constraints, the UI for cancellation and rescheduling was not delivered. These operations are implemented in the backend, but are not available through the browser interface.

## Tech stack

| Technology | Purpose |
|---|---|
| Node.js 22.17+ and Express 5 | JavaScript runtime and web server |
| Pug 3 | Server-rendered HTML |
| Plain CSS and vanilla JavaScript | Calendar, dialogs, and booking form interactions |
| SQLite through Node's `node:sqlite` | Local database and transactions |
| Luxon | Scheduling in the `Asia/Ho_Chi_Minh` timezone |
| `csv-parse` | Importing the supplied CSV data |
| Node's built-in test runner | Automated tests |

No separate database server or frontend build step is required.

## Requirements

- Node.js **22.17.0 or newer**, with npm.
- Git to clone the repository.

Check your installed versions:

```sh
node --version
npm --version
```

## First-time setup

1. Clone the repository and enter its directory. Skip this step if you already have a checkout, and open a terminal in that project directory.

   ```sh
   git clone https://github.com/nguyen2966/Scheduling-Application.git
   cd Scheduling-Application
   ```

2. Install the locked dependencies.

   ```sh
   npm ci
   ```

3. Create the SQLite database and import the seed data, then verify the fresh import.

   ```sh
   npm run db:setup
   npm run db:verify
   ```

   This creates `data/bright-path.sqlite` from the CSV files in `data/`. Run setup once for a fresh database; it refuses to overwrite existing records. Verification checks the original seed baseline and is expected to fail after you create or change bookings.

4. Start the application and keep the terminal open.

   ```sh
   npm start
   ```

5. Open **http://127.0.0.1:3000/bookings** in your browser.

   The calendar opens in the pinned seed-data week in March 2026. Stop the application with **Ctrl+C** in the terminal.

## Run again

From the project directory, start the existing database without repeating setup:

```sh
npm start
```

For automatic restart when source files change:

```sh
npm run dev
```

If port 3000 is already in use, stop the other instance or choose another port. For example, in PowerShell:

```powershell
$env:PORT = '4000'
npm start
```

Then open **http://127.0.0.1:4000/bookings**. On macOS or Linux, use `PORT=4000 npm start` instead.

Node.js 22 may print an experimental SQLite warning; the application still runs normally.

## Run tests

```sh
npm test
```

Tests use isolated temporary databases and do not reset your application data.
