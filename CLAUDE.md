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
- **Login:** Saudi mobile numbers only, **static OTP `123456`** (env `STATIC_OTP`). Admin logs in with email + password.
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
| `auth.controller.ts` | `/auth/*`, `/users/me*` (incl. `POST/DELETE /users/me/avatar`: jpg/png/webp ≤ 5 MB in `uploads/avatars`; `publicUser` returns `avatarUrl`) |
| `rider.controller.ts` | `/rider/modules` (`hasDownload` = has video or PDF), `/rider/modules/:id/package`, `/rider/modules/:id/progress`, `/rider/modules/:id/attempts` (quiz history, newest first, isBest/isLatest), `/rider/sync` |
| `rules.service.ts` | Assignment rules: `applyRule`, `applyForRider` (hook), `preview`, 5-min sweep cron |
| `rules.controller.ts` | `/admin/rules*` CRUD + preview + apply; `MetaController` `/meta/cities|worker-types|zones` (public) |
| `common/meta.ts` | Saudi city list + `canonicalCity()` ("riyad"/"الرياض" -> "Riyadh"), worker types, `riderFilter()` / `riderMatches()` |
| `progress.service.ts` | Sync logic, quiz grading, completion check, auto-unblock (`autoUnblockIfDone`), views |
| `admin-modules.controller.ts` | Module CRUD, video/PDF upload, quiz PUT, assign (one-off; userIds and/or city/workerType/zone via shared `riderFilter`; due = dueAt > dueInMinutes > deadlineDays > module deadlineDays > 7) |
| `admin-riders.controller.ts` | Rider list/create/details/edit, `GET /admin/riders/:id/modules/:moduleId/attempts`, block, unblock (with optional `newDueAt`), block logs, `POST /admin/jobs/deadline-check` |
| `blocking.service.ts` | Deadline cron: `assigned` + past `dueAt` → `overdue` + block user + log |
| `rooster.controller.ts` | `GET /admin/rooster/riders`: admin "Rooster" screen (POC stand-in for the dispatch integration). Riders with training counts + completion %, `dispatch` ON_HOLD/ALLOWED, overall summary; `training=incomplete` (default) / complete / all. Block/unblock and "View" reuse `/admin/riders/:id*` |
| `dashboard.controller.ts` | summary, by-city (groupBy), by-module, trend, non-compliant, export.csv, per-module stats and rider list. Shared filters + one compliance definition |
| `seed.ts` | Admin `admin@hs-demo.com`; 36 riders (+966500000001..36, Riyadh/Jeddah/Dammam/Makkah); "Food Safety Basics" + "Road Safety for Riders" (ar/en/ur, 5-question quizzes). 3 weeks of history for trend/compliance: on-time + late completions with module_progress, quiz_attempts, BLOCK/AUTO_UNBLOCK logs; 2 riders still blocked (Rahul Nair, Adnan Qureshi). Riders 1-10 get a fresh Food Safety for the live demo. Only adds missing rows (raw collection writes keep historical dates). `--reset --yes` drops the DB first. Attaches `seed-assets/{food-safety,road-safety}.{mp4,pdf}` when present |

## Key rules (don't break these)
- **IDs:** use MongoDB ObjectIds for every ID (DB, API, docs/Swagger examples, filenames). Never UUIDs.
- **No double counting:** `progress_events` has a unique index on (userId, eventId), where `eventId` is a MongoDB ObjectId generated on the phone. A duplicate key (11000) means "already received". An event stored but never `applied` (e.g. the server crashed mid-way) gets re-applied.
- **Completion:** done when every part the module has is done: video ≥ `videoCompletePercent` (default 90), PDF viewed, quiz passed. Empty modules never complete.
- **Progress `percent`** (`buildProgressView`) is weighted: each required part is an equal share, the video share fills with videoPercent / videoCompletePercent, PDF/quiz count when viewed/passed. Capped at 99 until complete, so 100 always means complete. `partsDone`/`partsTotal` give the step view. Score percents: `lastScorePercent`, `bestScorePercent`, `quizPassMarkPercent` (progress), `scorePercent` (sync quizResults), `avgBestScorePercent` (admin module stats). Admin FE uses `percent` for its bar unchanged. `certificate` (null until complete) = { issuedAt, score, total, scorePercent, quizAttempts } and always uses the BEST score.
- **No re-block after an admin unblock:** the cron only picks `status: 'assigned'`. An admin unblock leaves the row `overdue` unless `newDueAt` is given; in that case the row goes back to `assigned` with the new date.
- **Assignment rules only ADD** assignments (upsert on userId+moduleId, `ruleId` stored). They never reset, move or remove rows; deleting a rule keeps its assignments. Rules run on create / switch-on / edit, on rider create, OTP registration, city/workerType/zone change, and in a 5-minute sweep.
- **City** is stored canonical (English name from `SAUDI_CITIES`); unknown cities are kept as typed. A rider can set their city once (at OTP registration or `PATCH /users/me` while empty); after that only an admin changes it.
- **workerType** `rider | picker | bpo`; users without it count as `rider` (`workerTypeFilter`).
- **Compliance:** onTime = completed and completedAt <= dueAt; late = completed after dueAt; pastDue = not completed and dueAt < now; complianceRate = onTime / (onTime + late + pastDue). Not-yet-due rows are excluded. Note: an admin unblock with `newDueAt` moves dueAt, so a later completion counts as on time.
- A blocked rider can still log in and study. `GET /users/me` returns `block.message` in the rider's language.

## Status (2026-11-12)
- All 7 planned blocks are built. `tsc` compiles cleanly.
- `scripts/smoke.mjs` end-to-end test: 34/35 checks passed. The one failure was the test expecting 200 from assign, which returns 201 (POST default), so the API is fine.
- Swagger at `/api/docs`; Postman can import `/api/docs-json`.

## Possible next steps (not done)
- B4 (later): module draft/publish/archive, unassign, quiz timer + randomization, quiz-save warning, preview as rider.
- Worker ID + PIN login.
- Fake Rooster stub + call log with timings (demo item 3), and webhooks (demo item 5), if the scope comes back.
- Integration design diagram (LMS ↔ Rooster, LMS ↔ Bayzat) and the delivery plan doc.

## Working preferences (user)
- **Do not run `npm install`.** Add dependencies to `package.json` only; the user installs them.
- Wants fast execution: build directly, minimal back-and-forth.
- Local MongoDB at `mongodb://127.0.0.1:27017` was available on the original machine.

## Commands
```
npm run seed        # seed demo data (only adds what is missing)
npm run seed:reset -- --yes   # DROP the MONGO_URI database, then seed (refuses without --yes)
npm run start:dev   # dev server (ts-node-dev)
npm run build && npm start
node scripts/smoke.mjs   # needs the server on SMOKE_API (default http://localhost:3999/api) and a DB whose name contains "smoke"
```
