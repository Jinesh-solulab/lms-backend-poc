// Usage: start the API with MONGO_URI pointing at a *smoke* DB, then: node scripts/smoke.mjs
// The script DROPS that database at the end, so it refuses to run unless the DB name contains 'smoke'.
import mongoose from 'mongoose';
const oid = () => new mongoose.Types.ObjectId().toHexString();
const B = process.env.SMOKE_API || 'http://localhost:3999/api';
const SMOKE_DB = process.env.SMOKE_MONGO_URI || 'mongodb://127.0.0.1:27017/hs_lms_smoke';
if (!/smoke/i.test(SMOKE_DB)) { console.error('SMOKE_MONGO_URI must point to a database whose name contains "smoke"'); process.exit(1); }
const log = (...a) => console.log(...a);
async function call(method, path, { token, body, lang, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (lang) headers['Accept-Language'] = lang;
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(B + path, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}
const check = (name, cond, extra = '') => log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
for (let i = 0; i < 30; i++) { try { await fetch(B + '/docs-json'); break; } catch { await new Promise(r => setTimeout(r, 500)); } }

// 1. login
let r = await call('POST', '/auth/send-otp', { body: { phone: '12345' }, lang: 'ar' });
check('invalid phone rejected (ar msg)', r.status === 400, r.message);
r = await call('POST', '/auth/verify-otp', { body: { phone: '0500000001', otp: '999' } });
check('wrong otp rejected', r.status === 401, r.message);
r = await call('POST', '/auth/verify-otp', { body: { phone: '٠٥٠٠٠٠٠٠٠١', otp: '126' } });
check('arabic-digit phone + otp login', r.status === 200 && r.data?.token, `${r.message} lang=${r.data?.user?.language}`);
const rider = r.data.token;
r = await call('PATCH', '/users/me/language', { token: rider, body: { language: 'en' } });
check('language -> en', r.data?.language === 'en', r.message);
r = await call('PATCH', '/users/me/language', { token: rider, body: { language: 'ar' } });
check('language -> ar', r.data?.language === 'ar', r.message);

// admin
r = await call('POST', '/auth/admin/login', { body: { email: 'admin@hungerstation.local', password: 'Admin@123' } });
check('admin login', !!r.data?.token);
const admin = r.data.token;
r = await call('GET', '/admin/modules', { token: rider });
check('rider blocked from admin api', r.status === 403, r.message);

// 2. admin module + uploads + quiz
r = await call('POST', '/admin/modules', { token: admin, body: { title: { ar: 'وحدة تجريبية', en: 'Demo Module' }, description: { ar: 'وصف', en: 'desc' }, deadlineDays: 7 } });
check('create module', r.status === 201, r.message);
const mid = r.data.id;
const fd = new FormData(); fd.append('file', new Blob([new Uint8Array(2048)], { type: 'video/mp4' }), 'clip.mp4');
r = await call('POST', `/admin/modules/${mid}/video`, { token: admin, form: fd });
check('upload video', r.status === 201 && r.data?.video?.url, r.data?.video?.url);
const fd2 = new FormData(); fd2.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'guide.pdf');
r = await call('POST', `/admin/modules/${mid}/pdf`, { token: admin, form: fd2 });
check('upload pdf', r.status === 201 && r.data?.pdf?.url);
const fd3 = new FormData(); fd3.append('file', new Blob(['x'], { type: 'text/plain' }), 'bad.txt');
r = await call('POST', `/admin/modules/${mid}/pdf`, { token: admin, form: fd3 });
check('reject wrong file type', r.status === 400, r.message);
const q = (n, c) => ({ text: { ar: `سؤال ${n}`, en: `Q${n}` }, options: [{ ar: 'أ', en: 'A' }, { ar: 'ب', en: 'B' }, { ar: 'ج', en: 'C' }], correctIndex: c });
r = await call('PUT', `/admin/modules/${mid}/quiz`, { token: admin, body: { passMark: 3, questions: [q(1, 0), q(2, 1), q(3, 2), q(4, 0), q(5, 1)] } });
check('save quiz 3/5', r.status === 200 && r.data?.quiz?.totalQuestions === 5);
const correct = r.data.quiz.questions.map((x) => ({ questionId: x.id, selectedIndex: x.correctIndex }));

// assign to riders in Riyadh (5 seeded + new rider has no city -> set city first)
r = await call('GET', '/users/me', { token: rider });
const riderId = r.data.id;
r = await call('POST', `/admin/modules/${mid}/assign`, { token: admin, body: { city: 'riyadh', dueInMinutes: 60 } });
check('assign by city (case-insensitive)', r.data?.matchedRiders >= 5, JSON.stringify(r.data));

// 3. rider package
r = await call('GET', '/rider/modules', { token: rider });
check('rider module list localized (ar)', r.data?.some((m) => m.title === 'وحدة تجريبية'), `count=${r.data?.length}`);
r = await call('GET', `/rider/modules/${mid}/package`, { token: rider });
check('package has video/pdf/quiz, no answers', r.data?.video?.url && r.data?.pdf?.url && r.data?.quiz?.questions?.length === 5 && r.data.quiz.questions[0].correctIndex === undefined);
const vr = await fetch(r.data.video.url, { headers: { Range: 'bytes=0-99' } });
check('video served with range', vr.status === 206, `status=${vr.status}`);

// 4. offline sync with duplicate
const ev = [
  { eventId: oid(), moduleId: mid, type: 'VIDEO_PROGRESS', payload: { percent: 50 }, occurredAt: new Date(Date.now() - 60000).toISOString() },
  { eventId: oid(), moduleId: mid, type: 'VIDEO_PROGRESS', payload: { percent: 95 }, occurredAt: new Date(Date.now() - 50000).toISOString() },
  { eventId: oid(), moduleId: mid, type: 'PDF_VIEWED', payload: {}, occurredAt: new Date(Date.now() - 40000).toISOString() },
  { eventId: oid(), moduleId: mid, type: 'QUIZ_SUBMITTED', payload: { answers: correct.map((a, i) => (i < 2 ? { ...a, selectedIndex: (a.selectedIndex + 1) % 3 } : a)) }, occurredAt: new Date(Date.now() - 30000).toISOString() },
];
r = await call('POST', '/rider/sync', { token: rider, body: { events: ev } });
check('sync accepted 4', r.data?.accepted === 4, `${r.message} quiz=${JSON.stringify(r.data?.quizResults?.[0])}`);
check('quiz 3/5 passes', r.data?.quizResults?.[0]?.passed === true && r.data.quizResults[0].score === 3);
check('module completed', r.data?.progress?.[0]?.completed === true && r.data.progress[0].assignmentStatus === 'completed');
r = await call('POST', '/rider/sync', { token: rider, body: { events: ev } });
check('re-sync = all duplicates', r.data?.accepted === 0 && r.data?.duplicates === 4, r.message);
r = await call('GET', `/rider/modules/${mid}/progress`, { token: rider });
check('attempts still 1 after re-sync', r.data?.quizAttempts === 1, `attempts=${r.data?.quizAttempts}`);

// 5. auto-block via deadline check
const r2 = await call('POST', '/auth/verify-otp', { body: { phone: '0500000002', otp: '126' } });
const rider2 = r2.data.token;
r = await call('POST', `/admin/modules/${mid}/assign`, { token: admin, body: { userIds: [r2.data.user.id], dueInMinutes: 1, updateExisting: true } });
check('assign rider2 due in 1 min', r.status === 201);
// fast-forward: move dueAt into the past directly via API is not possible -> wait 61s would be slow; use mongo
await mongoose.connect(SMOKE_DB);
await mongoose.connection.collection('assignments').updateOne({ userId: new mongoose.Types.ObjectId(r2.data.user.id), moduleId: new mongoose.Types.ObjectId(mid) }, { $set: { dueAt: new Date(Date.now() - 1000) } });
r = await call('POST', '/admin/jobs/deadline-check', { token: admin });
check('deadline check blocks rider2', r.data?.blocked >= 1, r.message);
r = await call('GET', '/users/me', { token: rider2 });
check('rider2 sees block reason (ar)', r.data?.isBlocked && r.data.block?.message, r.data?.block?.message);
r = await call('POST', '/admin/jobs/deadline-check', { token: admin });
check('second check does not re-block', r.data?.blocked === 0);
r = await call('GET', '/admin/riders?status=blocked', { token: admin });
check('admin blocked list', r.data?.items?.some((x) => x.id === r2.data.user.id));
r = await call('POST', `/admin/riders/${r2.data.user.id}/unblock`, { token: admin, body: { note: 'ok', newDueAt: new Date(Date.now() + 3600e3).toISOString() } });
check('admin unblock + reschedule', r.data?.rider?.isBlocked === false && r.data.rescheduledAssignments >= 1, r.message);
r = await call('POST', '/admin/jobs/deadline-check', { token: admin });
check('no re-block after unblock', r.data?.blocked === 0);
r = await call('POST', `/admin/riders/${r2.data.user.id}/block`, { token: admin, body: { reason: 'manual test' } });
check('manual block', r.data?.isBlocked === true);
r = await call('GET', `/admin/riders/${r2.data.user.id}`, { token: admin });
check('rider details + history', r.data?.blockHistory?.length >= 3, `history=${r.data?.blockHistory?.map((h) => h.action).join(',')}`);

// 6. dashboard
r = await call('GET', '/admin/dashboard/summary', { token: admin });
check('dashboard summary', r.data?.totalRiders >= 10, JSON.stringify(r.data));
r = await call('GET', '/admin/dashboard/by-city', { token: admin });
check('dashboard by city', Array.isArray(r.data) && r.data.length >= 2, JSON.stringify(r.data));
r = await call('GET', `/admin/dashboard/modules/${mid}`, { token: admin });
check('dashboard module', r.data?.completed >= 1 && r.data?.quiz?.passed >= 1, JSON.stringify(r.data));
r = await call('GET', `/admin/dashboard/modules/${mid}/riders`, { token: admin });
check('dashboard module riders', r.data?.length >= 5);
r = await call('GET', '/admin/block-logs', { token: admin });
check('block logs', r.data?.length >= 3);

await mongoose.connection.dropDatabase();
await mongoose.disconnect();
log('smoke db dropped');
