# HungerStation LMS – POC Backend (Solulab bid)

## Context
- **Client:** HungerStation, a Saudi food-delivery company with 90k+ riders and field workers. They issued an RFP for an LMS/LXP that trains riders on mobile, including offline.
- **Solulab** is bidding. This repo is the **backend POC for the client demo**. The source docs (the RFP PDF, damaged: only the cover page opens; and 2 evaluation Excel sheets) were in `d:\Solulab\Hungerstation\Doc` before the project moved.
- **Scoring:** price 60%, 9 hard requirements 20% (pass/fail, disqualifying), 27 functional items 10%, SLA 10%.
  - The 9 hard requirements: native Android/iOS, offline download, auto-sync, Arabic RTL, Arabic/English/Urdu, REST APIs, webhooks, Rooster integration, Bayzat integration.
- **External systems:** Rooster = HungerStation's dispatch system (blocking there stops a rider getting orders). Bayzat = their HR system.

## Demo items the client asked for
1. Mobile app on a low-end Android phone: phone/worker-ID login, language switch, download a module (video + PDF + quiz).
2. Offline: airplane mode → finish the course and quiz → back online → result appears in admin with **no duplicate entries**.
3. Rooster lockout/unlock with message logs and timings.
4. Admin: create a course, assign it by rule (role/city) with a deadline, completion dashboard.
5. API docs, webhooks, Rooster/Bayzat integration design.
6. Delivery plan: timeline, team, what exists vs. what gets built new.

## Scope decisions for this POC (agreed with the user, 2026-11-12)
- **Out of scope:** Bayzat, Rooster, webhooks, Redis, BullMQ.
- **Stack:** NestJS 10 + MongoDB (Mongoose 8) only.
- **Login:** Saudi mobile numbers only, **static OTP `126`** (env `STATIC_OTP`). Admin logs in with email + password.
- **Languages:** **Arabic, English and Urdu** (`ar | en | ur`). The preference is stored on the user; API messages are returned in it. Content (`{ ar, en, ur }`) has `ur` optional: riders fall back to English (then Arabic) when it is empty (`loc()`).
- **Storage:** videos and PDFs on **local disk** (`./uploads`), served at `/uploads/...`.
- **Blocking:** **automatic by cron** (every minute) when the deadline passes. Admin can unblock any time. **Auto-unblock** (added 2026-11-12, user request): when the rider syncs and has finished the overdue module(s) of the current block period, the system unblocks (`AUTO_UNBLOCK` log); if another one is still overdue the reason moves to it (`STILL_BLOCKED` log). Manual blocks are never auto-lifted.
- **Quiz:** pass mark set per quiz (e.g. 3 of 5). Graded on the server; the app never receives the correct answers.

## Architecture (all in `src/`, one Nest module)
| File | Purpose |
|---|---|
| `main.ts` | bootstrap, Swagger, health route at `GET /` and `GET /api/health` |
| `config.ts` | env loading (dotenv); `fileUrl()` builds absolute URLs from `BASE_URL` (stored paths are relative) |
| `schemas/index.ts` | Collections: users, modules, quizzes, assignments, progress_events, module_progress, quiz_attempts, block_logs. `DbModel = any` (loose typing on purpose) |
| `common/messages.ts` | ar/en/ur message dictionary, `t()`, `isLang()`, `resolveLang()` (user language, then Accept-Language, then en) |
| `common/http.ts` | `AppException(key)`, `ok(key, data)`, response interceptor and exception filter that localize messages |
| `common/auth.ts` | `JwtAuthGuard` (reloads the user every request), `@Auth('admin' \| 'rider')`, `@CurrentUser()` |
| `common/util.ts` | Saudi phone normalizer, `loc()`, `publicUser()`, `blockInfo()`, multer upload options |
| `auth.controller.ts` | `/auth/*`, `/users/me*` |
| `rider.controller.ts` | `/rider/modules`, `/rider/modules/:id/package`, `/rider/modules/:id/progress`, `/rider/sync` |
| `progress.service.ts` | Sync logic, quiz grading, completion check, auto-unblock (`autoUnblockIfDone`), views |
| `admin-modules.controller.ts` | Module CRUD, video/PDF upload, quiz PUT, assign (by userIds/city; dueAt, dueInMinutes or deadlineDays) |
| `admin-riders.controller.ts` | Rider list/create/details/edit, block, unblock (with optional `newDueAt`), block logs, `POST /admin/jobs/deadline-check` |
| `blocking.service.ts` | Deadline cron: `assigned` + past `dueAt` → `overdue` + block user + log |
| `dashboard.controller.ts` | summary, by-city, per-module stats, per-module rider list |
| `seed.ts` | 1 admin, 10 riders (+966500000001..10, Riyadh/Jeddah), "Food Safety Basics" module + 5-question ar/en/ur quiz, assigned to all riders (re-running backfills Urdu on an old seed) |

## Key rules (don't break these)
- **IDs:** use MongoDB ObjectIds for every ID (DB, API, docs/Swagger examples, filenames). Never UUIDs.
- **No double counting:** `progress_events` has a unique index on (userId, eventId), where `eventId` is a MongoDB ObjectId generated on the phone. A duplicate key (11000) means "already received". An event stored but never `applied` (e.g. the server crashed mid-way) gets re-applied.
- **Completion:** done when every part the module has is done: video ≥ `videoCompletePercent` (default 90), PDF viewed, quiz passed. Empty modules never complete.
- **No re-block after an admin unblock:** the cron only picks `status: 'assigned'`. An admin unblock leaves the row `overdue` unless `newDueAt` is given; in that case the row goes back to `assigned` with the new date.
- A blocked rider can still log in and study. `GET /users/me` returns `block.message` in the rider's language.

## Status (2026-11-12)
- All 7 planned blocks are built. `tsc` compiles cleanly.
- `scripts/smoke.mjs` end-to-end test: 34/35 checks passed. The one failure was the test expecting 200 from assign, which returns 201 (POST default), so the API is fine.
- Swagger at `/api/docs`; Postman can import `/api/docs-json`.

## Possible next steps (not done)
- Worker ID + PIN login.
- Fake Rooster stub + call log with timings (demo item 3), and webhooks (demo item 5), if the scope comes back.
- Integration design diagram (LMS ↔ Rooster, LMS ↔ Bayzat) and the delivery plan doc.

## Working preferences (user)
- **Do not run `npm install`.** Add dependencies to `package.json` only; the user installs them.
- Wants fast execution: build directly, minimal back-and-forth.
- Local MongoDB at `mongodb://127.0.0.1:27017` was available on the original machine.

## Commands
```
npm run seed        # seed demo data
npm run start:dev   # dev server (ts-node-dev)
npm run build && npm start
node scripts/smoke.mjs   # needs the server on SMOKE_API (default http://localhost:3999/api) and a DB whose name contains "smoke"
```
