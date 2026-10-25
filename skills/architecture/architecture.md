---
name: architecture
description: Keep the Bright Path Express backend and Pug SSR frontend modular, API-contract-driven, and easy to extend without unnecessary complexity.
---

# Architecture Skill — Express + Pug

Apply when designing, implementing, or reviewing the Bright Path booking tool. **MUST** means required.

## 1. Architecture principles

- **Backend:** Express REST API, application services, repositories, SQLite. The backend owns booking rules, validation, transactions, audit history, and persistence.
- **Frontend:** Express routes + Pug SSR, plain CSS, minimal vanilla JavaScript for calendar drag-and-drop. The frontend owns HTML, layout, form state, and displaying errors.
- **Contract-first separation:** FE and BE MUST communicate through the documented REST API contract (routes, request/response DTOs, status codes, error keys). Neither layer should depend on the other's private implementation.
- The UI's SSR route handlers MUST access booking data through a dedicated **API client adapter** using the same published contract. They MUST NOT import backend services, repositories, database connections, or SQL queries. Co-location in one project/process does not remove this boundary.
- The backend MUST NOT know about Pug, page templates, DOM state, or calendar layout. FE validation is for usability only; BE validation is authoritative.
- Prefer simple modules and dependency injection through ordinary functions. Do not introduce microservices, message brokers, large frameworks, or speculative abstractions.

## 2. Responsibilities

| Frontend (SSR / browser) | Backend (REST API) |
|---|---|
| Render 7-day room calendar and forms | Read/write bookings and history |
| Select R1–R6; navigate weeks | Validate room, tutor, student overlaps across **all rooms** |
| Collect create/edit/cancel requests | Enforce 60/90 minutes, daily tutor cap, Monday closure |
| Propose same-room drag-and-drop changes | Run atomic validation + persistence transactions |
| Render success and actionable API errors | Return stable DTOs, errors, and correct HTTP statuses |

Cross-room moves remain **Cancel + Create** (two separate requests). FE MUST explain that the steps are not atomic.

## 3. Suggested structure

```text
src/
  app.js                    # Express composition and middleware
  api/
    routes/                 # /api/v1 resources
    controllers/            # HTTP -> service -> JSON response
    services/               # Business rules and transactions
    repositories/           # SQLite access only
    errors/                 # AppError types and API error middleware
  web/
    routes/                 # HTML page routes
    controllers/            # API client -> view model -> res.render
    api-client.js           # Only FE-to-BE integration boundary
    views/                  # Pug templates
    public/                 # CSS and minimal JS
```

Keep API and page routers independent; both may be mounted by one Express app for simple deployment.

## 4. Centralized error handling (mandatory)

- Define typed application errors (`AppError`) with `httpStatus`, stable `code`, and safe `message`.
- API controllers MUST forward failures with `next(err)` (or an async-wrapper / Express 5 promise handling); do not repeat `try/catch` response formatting in every controller.
- Register **one centralized API error middleware after API routes**: `(err, req, res, next)`. Map known errors to appropriate HTTP statuses (`400`, `404`, `409`, `412`, `422`); use `500` for unexpected errors.
- The API error response MUST follow the API Design Skill envelope with exactly `data`, `code`, `timestamp`; `code.http_status` MUST match HTTP status. Never expose internal stack traces, SQL, or secrets.
- Page routes use a **separate HTML error presenter** (Pug error page / form feedback). They MUST NOT return JSON envelopes as HTML pages. A failed API call must be translated into a safe, readable UI message.
- Log unexpected errors once with enough context for debugging, without leaking personal data. Place the not-found handler after all registered routes.

## 5. Contract and extensibility rules

- Version JSON endpoints under `/api/v1`; use resource-oriented URLs and RESTful HTTP methods and statuses.
- Keep request/response schemas stable; API changes should not require FE knowledge of database fields or services.
- Use one shared API client module for SSR requests and browser-side changes; never scatter URLs or error parsing throughout Pug templates.
- Keep Pug templates presentation-only. Put mapping/formatting in page controllers or view-model helpers; put scheduling rules in backend services.
- Support future replacement of the SSR frontend or database by keeping the API contract and service/repository boundaries stable.
- Add tests for service rules, API contract/error middleware, and basic SSR rendering; prioritize behavior over architectural ceremony.

**Review checklist:** Can the FE be rewritten using only API documentation? Can the BE run and be tested without rendering Pug? Does every API failure reach the central error middleware? Are booking rules implemented only in the BE?
