# HungerStation LMS – POC Backend

NestJS + MongoDB. No Redis, no queue. Videos and PDFs are stored on local disk (`./uploads`).

## Run

```bash
npm install
cp .env.example .env      # fill values
npm run seed              # admin + 10 riders + "Food Safety Basics" module/quiz, assigned to all riders
npm run start:dev         # or: npm run build && npm start
```

- Health: `http://localhost:3000/` (or `/api/health`) returns `{ success: true, message: "HungerStation LMS server is running", data: { status, database, uptimeSeconds, ... } }`
- Swagger: `http://localhost:3000/api/docs`
- Postman: import `http://localhost:3000/api/docs-json`
- Seed logins: admin `admin@hungerstation.local` / `Admin@123`; riders `0500000001` … `0500000010`, OTP `126`

Every response has the shape `{ success, message, data }`. `message` is in the user's saved language (`ar` or `en`). Before login it follows the `Accept-Language` header.

## Endpoints (prefix `/api`)

| Area | Method & path | Notes |
|---|---|---|
| Auth | `POST /auth/send-otp` | Saudi numbers only (05…, +9665…, Arabic digits OK) |
| | `POST /auth/verify-otp` | Static OTP; a new number is registered as a rider; optional `city` (saved only if the rider has none); returns a JWT |
| | `POST /auth/admin/login` | Email + password |
| Me | `GET /users/me` | Includes `isBlocked` and a localized `block.message` |
| | `PATCH /users/me/language` | `{ language: "ar" \| "en" }` |
| | `PATCH /users/me` | Name; a rider can set `city` once (409 `city_already_set` after that) |
| Meta (public) | `GET /meta/cities`, `/meta/worker-types`, `/meta/zones` | Dropdown data with ar/en/ur labels |
| Rider | `GET /rider/modules` | Assigned modules, localized, with progress / due date / status |
| | `GET /rider/modules/:id/package?lang=ar\|en\|all` | Offline package: video and PDF URLs, quiz without answers, `version` |
| | `GET /rider/modules/:id/progress` | |
| | `POST /rider/sync` | Batch events; the same `eventId` is never counted twice |
| Admin modules | `POST /admin/modules`, `GET /admin/modules`, `GET/PATCH /admin/modules/:id` | Titles and descriptions in `{ ar, en, ur }` (`ur` optional, falls back to English) |
| | `POST /admin/modules/:id/video`, `POST /admin/modules/:id/pdf` | multipart, field `file` |
| | `PUT /admin/modules/:id/quiz` | `passMark` (e.g. 3) + questions with `correctIndex` |
| | `POST /admin/modules/:id/assign` | One-off: `userIds` and/or `city` / `workerType`; due date from `dueAt`, `dueInMinutes` (demo) or `deadlineDays` |
| Assignment rules | `GET /admin/rules?moduleId=` | Each rule has `assignedCount`, `lastRunAt`, `matchedNow` |
| | `POST /admin/rules` | `{ name, moduleId, criteria: { city?, workerType?, zone? }, deadlineDays?, deadlineMinutes? (demo), isActive? }`; applies now (`assignedNow`) |
| | `PATCH /admin/rules/:id`, `DELETE /admin/rules/:id` | Edit / toggle (re-applies when active). Delete keeps existing assignments |
| | `POST /admin/rules/preview` | `{ criteria, moduleId? }` -> `{ matched, alreadyAssigned, willAssign, sample }` |
| | `POST /admin/rules/:id/apply` | Demo: run now |
| Admin riders | `GET /admin/riders?status=blocked&city=&workerType=&search=` | |
| | `POST /admin/riders`, `GET/PATCH /admin/riders/:id` | `workerType` (rider/picker/bpo), `zone`. Create, and a city/type/zone change, run the rules (`assignedByRules`) |
| | `POST /admin/riders/:id/block` | `{ reason }` |
| | `POST /admin/riders/:id/unblock` | `{ note, newDueAt? }` |
| | `GET /admin/block-logs` | |
| | `POST /admin/jobs/deadline-check` | Demo: run the auto-block check now |
| Dashboard | `GET /admin/dashboard/summary`, `/by-city?groupBy=city\|workerType\|zone`, `/by-module` | Filters: `moduleId, city, workerType, zone, from, to` (assignedAt). Includes `onTime, late, pastDue, notDueYet, complianceRate` |
| | `GET /admin/dashboard/modules/:id`, `/modules/:id/riders` | Compliance per module / per rider (`on_time`, `late`, `overdue`, `not_due_yet`) |
| | `GET /admin/dashboard/trend?days=30` | `[{ date, completed, onTime, late, overdue }]`, Riyadh days, same filters |
| | `GET /admin/dashboard/non-compliant?limit=&includeLate=` | Overdue riders with module, due date, days overdue, blocked flag |
| | `GET /admin/dashboard/export.csv?type=summary\|by-city\|by-module\|non-compliant` | CSV (UTF-8 BOM). Browser links can pass `?access_token=<jwt>` |

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
- **Auto-unblock:** when a rider blocked by the cron (`MODULE_OVERDUE`) syncs and the overdue module is now complete, the system unblocks them and logs `AUTO_UNBLOCK` (by `SYSTEM`). If another module from the same block period is still overdue, the rider stays blocked, the block reason moves to that module, and `STILL_BLOCKED` is logged. Manual (admin) blocks are never auto-lifted. The sync response has `account: { isBlocked, autoUnblocked, block }`.
- Admin sees all of this in `GET /admin/block-logs` (filters: `userId`, `action=AUTO_UNBLOCK,STILL_BLOCKED`, `by=SYSTEM`) and in `blockHistory` on `GET /admin/riders/:id`.
