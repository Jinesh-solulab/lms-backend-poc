# HungerStation LMS – POC Backend

NestJS + MongoDB. No Redis, no queue. Videos and PDFs are stored on local disk (`./uploads`).

## Run

```bash
npm install
cp .env.example .env      # fill values
npm run seed              # admin + 10 riders + "Food Safety Basics" module/quiz, assigned to all riders
npm run start:dev         # or: npm run build && npm start
```

- Swagger: `http://localhost:3000/api/docs`
- Postman: import `http://localhost:3000/api/docs-json`
- Seed logins: admin `admin@hungerstation.local` / `Admin@123`; riders `0500000001` … `0500000010`, OTP `126`

Every response has the shape `{ success, message, data }`. `message` is in the user's saved language (`ar` or `en`). Before login it follows the `Accept-Language` header.

## Endpoints (prefix `/api`)

| Area | Method & path | Notes |
|---|---|---|
| Auth | `POST /auth/send-otp` | Saudi numbers only (05…, +9665…, Arabic digits OK) |
| | `POST /auth/verify-otp` | Static OTP; a new number is registered as a rider; returns a JWT |
| | `POST /auth/admin/login` | Email + password |
| Me | `GET /users/me` | Includes `isBlocked` and a localized `block.message` |
| | `PATCH /users/me/language` | `{ language: "ar" \| "en" }` |
| | `PATCH /users/me` | Name |
| Rider | `GET /rider/modules` | Assigned modules, localized, with progress / due date / status |
| | `GET /rider/modules/:id/package?lang=ar\|en\|all` | Offline package: video and PDF URLs, quiz without answers, `version` |
| | `GET /rider/modules/:id/progress` | |
| | `POST /rider/sync` | Batch events; the same `eventId` is never counted twice |
| Admin modules | `POST /admin/modules`, `GET /admin/modules`, `GET/PATCH /admin/modules/:id` | Titles and descriptions in `{ ar, en, ur }` (`ur` optional, falls back to English) |
| | `POST /admin/modules/:id/video`, `POST /admin/modules/:id/pdf` | multipart, field `file` |
| | `PUT /admin/modules/:id/quiz` | `passMark` (e.g. 3) + questions with `correctIndex` |
| | `POST /admin/modules/:id/assign` | `userIds` and/or `city`; due date from `dueAt`, `dueInMinutes` (demo) or `deadlineDays` |
| Admin riders | `GET /admin/riders?status=blocked&city=&search=` | |
| | `POST /admin/riders`, `GET/PATCH /admin/riders/:id` | Details include assignments, progress, block history |
| | `POST /admin/riders/:id/block` | `{ reason }` |
| | `POST /admin/riders/:id/unblock` | `{ note, newDueAt? }` |
| | `GET /admin/block-logs` | |
| | `POST /admin/jobs/deadline-check` | Demo: run the auto-block check now |
| Dashboard | `GET /admin/dashboard/summary`, `/by-city`, `/modules/:id`, `/modules/:id/riders` | |

## Sync events (mobile app)

```json
{ "events": [
  { "eventId": "<objectId>", "moduleId": "<objectId>", "type": "VIDEO_PROGRESS", "payload": { "percent": 95 }, "occurredAt": "..." },
  { "eventId": "<objectId>", "moduleId": "<objectId>", "type": "PDF_VIEWED", "payload": {}, "occurredAt": "..." },
  { "eventId": "<objectId>", "moduleId": "<objectId>", "type": "QUIZ_SUBMITTED", "payload": { "answers": [{ "questionId": "<objectId>", "selectedIndex": 0 }] }, "occurredAt": "..." }
]}
```

- All IDs are MongoDB ObjectIds (24 hex chars), never UUIDs.
- Generate `eventId` as a new ObjectId once per action on the phone (works offline: e.g. `bson` `new ObjectId().toHexString()`). Keep the event in a local queue until sync returns it as `accepted` or `duplicate`.
- The server grades the quiz. The result comes back in `quizResults`.
- A module is complete when every part it has is done: video watched past `videoCompletePercent` (default 90%), PDF viewed, and quiz passed.

## Blocking

- A cron runs every minute. Any `assigned` row past its `dueAt` becomes `overdue`, and the rider is blocked with reason `MODULE_OVERDUE`. Each block is logged in `block_logs`.
- The admin unblocks manually. An overdue row stays `overdue`, so the cron does not block the rider again. If the admin passes `newDueAt`, the row goes back to `assigned` with that date.
- Completing the module does **not** auto-unblock the rider. The admin decides.
