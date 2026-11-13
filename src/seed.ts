/*
 * npm run seed                  -> add demo data (safe to re-run: only adds what is missing)
 * npm run seed:reset -- --yes   -> DROP the whole database, then seed. Run before the demo.
 *
 * Demo data:
 *  - admin (ADMIN_EMAIL / ADMIN_PASSWORD)
 *  - 36 riders (+966500000001 .. +966500000036, OTP STATIC_OTP) in Riyadh / Jeddah / Dammam / Makkah
 *  - 2 modules with ar/en/ur text + 5-question quizzes: "Food Safety Basics", "Road Safety for Riders"
 *  - 3 weeks of history (riders 11-36 + some of 1-10): on-time and late completions, 2 riders still blocked,
 *    with matching module_progress, quiz_attempts and block_logs, so the trend chart, compliance card,
 *    module stats and Rooster screen all have data.
 *  - Riders 1-10 have a fresh "Food Safety Basics" (due in 7 days, no progress) for the live offline demo.
 *  - Videos / PDFs: put files in ./seed-assets (food-safety.mp4|pdf, road-safety.mp4|pdf). They are uploaded
 *    into MongoDB GridFS and attached when the module has none. Missing files are skipped (upload via the admin panel).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import { config, safeMongoUri } from './config';
import { putFile } from './common/storage';
import {
  AssignmentRuleSchema,
  AssignmentSchema,
  BlockLogSchema,
  M,
  ModuleProgressSchema,
  ProgressEventSchema,
  QuizAttemptSchema,
  QuizSchema,
  TrainingModuleSchema,
  UserSchema,
} from './schemas';

const DAY = 86_400_000;
const MIN = 60_000;
const L = (en: string, ar: string, ur: string) => ({ en, ar, ur });

/* ---------------- Module content ---------------- */

const FOOD = {
  key: 'food-safety',
  deadlineDays: 7,
  title: L('Food Safety Basics', 'أساسيات سلامة الغذاء', 'فوڈ سیفٹی کی بنیادی باتیں'),
  description: L(
    'Learn how to keep food safe during delivery.',
    'تعلّم كيفية الحفاظ على سلامة الطعام أثناء التوصيل.',
    'ڈیلیوری کے دوران کھانے کو محفوظ رکھنے کا طریقہ سیکھیں۔',
  ),
  questions: [
    {
      text: L('What should you do before picking up an order?', 'ماذا يجب أن تفعل قبل استلام الطلب؟', 'آرڈر اٹھانے سے پہلے آپ کو کیا کرنا چاہیے؟'),
      options: [
        L('Wash or sanitize your hands', 'اغسل يديك أو عقّمهما', 'ہاتھ دھوئیں یا سینیٹائز کریں'),
        L('Check your phone', 'تفقد هاتفك', 'اپنا فون چیک کریں'),
        L('Nothing', 'لا شيء', 'کچھ نہیں'),
      ],
      correctIndex: 0,
    },
    {
      text: L('Hot and cold food should be...', 'يجب وضع الطعام الساخن والبارد...', 'گرم اور ٹھنڈا کھانا...'),
      options: [
        L('Kept in separate bags', 'في أكياس منفصلة', 'الگ الگ تھیلوں میں رکھا جائے'),
        L('Mixed in one bag', 'معًا في كيس واحد', 'ایک ہی تھیلے میں ملا دیا جائے'),
        L('Left open', 'مكشوفًا', 'کھلا چھوڑ دیا جائے'),
      ],
      correctIndex: 0,
    },
    {
      text: L('If the food seal is broken, you should...', 'إذا كان ختم الطعام مكسورًا، يجب عليك...', 'اگر کھانے کی سیل ٹوٹی ہو تو آپ کو...'),
      options: [
        L('Deliver it anyway', 'توصيله على أي حال', 'پھر بھی ڈیلیور کر دینا چاہیے'),
        L('Report it and not deliver', 'الإبلاغ وعدم التوصيل', 'اطلاع دینی چاہیے اور ڈیلیور نہیں کرنا چاہیے'),
        L('Fix it yourself', 'إصلاحه بنفسك', 'خود ٹھیک کر دینا چاہیے'),
      ],
      correctIndex: 1,
    },
    {
      text: L('How often should your delivery bag be cleaned?', 'كم مرة يجب تنظيف حقيبة التوصيل؟', 'ڈیلیوری بیگ کتنی بار صاف کرنا چاہیے؟'),
      options: [L('Once a month', 'مرة في الشهر', 'مہینے میں ایک بار'), L('Every day', 'كل يوم', 'ہر روز'), L('Never', 'أبدًا', 'کبھی نہیں')],
      correctIndex: 1,
    },
    {
      text: L('What is the safe way to hand over food?', 'ما الطريقة الآمنة لتسليم الطعام؟', 'کھانا حوالے کرنے کا محفوظ طریقہ کیا ہے؟'),
      options: [
        L('Throw it to the customer', 'رميه للعميل', 'گاہک کی طرف پھینک دیں'),
        L('Leave it on the ground', 'تركه على الأرض', 'زمین پر چھوڑ دیں'),
        L('Hand it over politely and safely', 'تسليمه بلطف وأمان', 'شائستگی اور حفاظت سے حوالے کریں'),
      ],
      correctIndex: 2,
    },
  ],
};

const ROAD = {
  key: 'road-safety',
  deadlineDays: 14,
  title: L('Road Safety for Riders', 'السلامة المرورية للمندوبين', 'رائیڈرز کے لیے روڈ سیفٹی'),
  description: L(
    'Ride safely: helmet, speed, phone use and bad weather.',
    'قُد بأمان: الخوذة، السرعة، استخدام الهاتف، والطقس السيئ.',
    'محفوظ طریقے سے سواری کریں: ہیلمٹ، رفتار، فون کا استعمال اور خراب موسم۔',
  ),
  questions: [
    {
      text: L('When must you wear a helmet?', 'متى يجب أن ترتدي الخوذة؟', 'آپ کو ہیلمٹ کب پہننا چاہیے؟'),
      options: [
        L('On every ride, even short ones', 'في كل رحلة، حتى القصيرة', 'ہر سواری پر، چاہے فاصلہ کم ہو'),
        L('Only on highways', 'على الطرق السريعة فقط', 'صرف ہائی وے پر'),
        L('Only at night', 'في الليل فقط', 'صرف رات کو'),
      ],
      correctIndex: 0,
    },
    {
      text: L('Can you use your phone while riding?', 'هل يمكنك استخدام هاتفك أثناء القيادة؟', 'کیا آپ سواری کے دوران فون استعمال کر سکتے ہیں؟'),
      options: [
        L('Yes, to reply to customers quickly', 'نعم، للرد على العملاء بسرعة', 'ہاں، گاہک کو جلدی جواب دینے کے لیے'),
        L('No, stop safely first', 'لا، توقف بأمان أولًا', 'نہیں، پہلے محفوظ جگہ پر رکیں'),
        L('Only at traffic lights', 'فقط عند الإشارات', 'صرف ٹریفک سگنل پر'),
      ],
      correctIndex: 1,
    },
    {
      text: L('The road is wet after rain. You should...', 'الطريق مبلل بعد المطر. يجب عليك...', 'بارش کے بعد سڑک گیلی ہے۔ آپ کو...'),
      options: [
        L('Ride faster to finish early', 'القيادة بسرعة أكبر لتنتهي مبكرًا', 'جلدی ختم کرنے کے لیے تیز چلانا چاہیے'),
        L('Slow down and keep more distance', 'تخفيف السرعة وترك مسافة أكبر', 'رفتار کم کر کے زیادہ فاصلہ رکھنا چاہیے'),
        L('Brake hard on turns', 'الضغط على الفرامل بقوة في المنعطفات', 'موڑ پر زور سے بریک لگانی چاہیے'),
      ],
      correctIndex: 1,
    },
    {
      text: L('What does a red traffic light mean?', 'ماذا تعني الإشارة الحمراء؟', 'سرخ ٹریفک لائٹ کا کیا مطلب ہے؟'),
      options: [
        L('Stop completely and wait', 'توقف تمامًا وانتظر', 'پوری طرح رکیں اور انتظار کریں'),
        L('Go if the road is empty', 'تابع إذا كان الطريق فارغًا', 'سڑک خالی ہو تو چلے جائیں'),
        L('Slow down only', 'خفف السرعة فقط', 'صرف رفتار کم کریں'),
      ],
      correctIndex: 0,
    },
    {
      text: L('Before you start your shift, check...', 'قبل بدء ورديتك، تحقق من...', 'شفٹ شروع کرنے سے پہلے چیک کریں...'),
      options: [
        L('Only your fuel', 'الوقود فقط', 'صرف پیٹرول'),
        L('Nothing, the bike is fine', 'لا شيء، الدراجة بخير', 'کچھ نہیں، بائیک ٹھیک ہے'),
        L('Brakes, lights and tyres', 'الفرامل والأضواء والإطارات', 'بریک، لائٹس اور ٹائر'),
      ],
      correctIndex: 2,
    },
  ],
};

/* ---------------- Riders ---------------- */
// [name, city, language, workerType?, zone?]. Riders 1-10 are the original demo logins (unchanged).
const RIDERS: [string, string, string, string?, string?][] = [
  ['Ahmed Ali', 'Riyadh', 'ar'],
  ['Mohammed Saleh', 'Riyadh', 'ar'],
  ['Imran Khan', 'Riyadh', 'ur'],
  ['Faisal Omar', 'Riyadh', 'ar'],
  ['Bilal Hussain', 'Riyadh', 'en'],
  ['Khalid Nasser', 'Jeddah', 'ar'],
  ['Yousef Hamad', 'Jeddah', 'ar'],
  ['Asif Mahmood', 'Jeddah', 'ur'],
  ['Omar Zaid', 'Jeddah', 'ar'],
  ['Rashid Iqbal', 'Jeddah', 'en'],
  // 11-36: history riders
  ['Saad Al-Harbi', 'Riyadh', 'ar', 'rider', 'North'],
  ['Tariq Mehmood', 'Riyadh', 'ur', 'rider', 'South'],
  ['Naveed Akhtar', 'Riyadh', 'ur', 'rider', 'North'],
  ['John Mathew', 'Riyadh', 'en', 'rider', 'South'],
  ['Abdullah Al-Qahtani', 'Riyadh', 'ar', 'picker', 'North'],
  ['Hassan Raza', 'Riyadh', 'ur', 'rider', 'South'],
  ['Sultan Al-Otaibi', 'Riyadh', 'ar', 'rider', 'North'],
  ['Rahul Nair', 'Riyadh', 'en', 'rider', 'South'],
  ['Majed Al-Ghamdi', 'Jeddah', 'ar', 'rider', 'North'],
  ['Zubair Ahmed', 'Jeddah', 'ur', 'rider', 'South'],
  ['Fahad Al-Zahrani', 'Jeddah', 'ar', 'picker', 'North'],
  ['Shahid Nawaz', 'Jeddah', 'ur', 'rider', 'South'],
  ['Mohammed Rafiq', 'Jeddah', 'en', 'bpo', 'North'],
  ['Nasser Al-Shehri', 'Jeddah', 'ar', 'rider', 'South'],
  ['Kamran Butt', 'Jeddah', 'ur', 'rider', 'North'],
  ['Turki Al-Dossary', 'Dammam', 'ar', 'rider', 'East'],
  ['Waqas Ali', 'Dammam', 'ur', 'rider', 'East'],
  ['Anwar Hossain', 'Dammam', 'en', 'rider', 'West'],
  ['Hamad Al-Mutairi', 'Dammam', 'ar', 'picker', 'East'],
  ['Adnan Qureshi', 'Dammam', 'ur', 'rider', 'West'],
  ['Ibrahim Al-Shammari', 'Makkah', 'ar', 'rider', 'North'],
  ['Usman Ghani', 'Makkah', 'ur', 'rider', 'South'],
  ['Salman Al-Harthi', 'Makkah', 'ar', 'picker', 'North'],
  ['Arif Hussain', 'Makkah', 'en', 'rider', 'South'],
  ['Mazen Al-Subaie', 'Makkah', 'ar', 'rider', 'North'],
  ['Junaid Iqbal', 'Makkah', 'ur', 'rider', 'South'],
];
const phoneOf = (i: number) => `+9665000000${String(i + 1).padStart(2, '0')}`; // i=0 -> +966500000001

/* ---------------- Helpers ---------------- */

type Outcome =
  | { kind: 'pending'; videoPercent?: number }
  | { kind: 'onTime' | 'late'; completedAt: Date; score: number; attempts: number }
  | { kind: 'pastDue' };

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.pdf': 'application/pdf' };

/** Upload seed-assets/<key>.<ext> into GridFS and return the module file object, or null when missing. */
async function seedFile(key: string, kind: 'video' | 'pdf') {
  const ext = kind === 'video' ? '.mp4' : '.pdf';
  const src = path.resolve('seed-assets', key + ext);
  if (!fs.existsSync(src)) return null;
  const sub = kind === 'video' ? 'videos' : 'pdfs';
  const rel = `/uploads/${sub}/${new Types.ObjectId().toHexString()}${ext}`;
  await putFile(mongoose.connection.db as any, src, rel, MIME[ext], key + ext, false);
  return { path: rel, originalName: key + ext, sizeBytes: fs.statSync(src).size, mimeType: MIME[ext], uploadedAt: new Date() };
}

async function main() {
  const args = process.argv.slice(2);
  const reset = args.includes('--reset');

  await mongoose.connect(config.mongoUri);
  const db = mongoose.connection;

  if (reset) {
    const target = `${safeMongoUri()} (database "${db.name}")`;
    if (!args.includes('--yes')) {
      console.error(`\nseed:reset will DROP ${target}.\nThis cannot be undone. Re-run with:  npm run seed:reset -- --yes\n`);
      await mongoose.disconnect();
      process.exit(1);
    }
    await db.dropDatabase();
    console.log(`database dropped: ${target}`);
  }

  const User = mongoose.model(M.User, UserSchema);
  const Mod = mongoose.model(M.TrainingModule, TrainingModuleSchema);
  const Quiz = mongoose.model(M.Quiz, QuizSchema);
  const Assignment = mongoose.model(M.Assignment, AssignmentSchema);
  const Progress = mongoose.model(M.ModuleProgress, ModuleProgressSchema);
  const Attempt = mongoose.model(M.QuizAttempt, QuizAttemptSchema);
  const BlockLog = mongoose.model(M.BlockLog, BlockLogSchema);
  const Event = mongoose.model(M.ProgressEvent, ProgressEventSchema);
  const Rule = mongoose.model(M.AssignmentRule, AssignmentRuleSchema);
  // All indexes, incl. the unique (userId, eventId) on progress_events that stops double counting.
  await Promise.all([User, Mod, Quiz, Assignment, Progress, Attempt, BlockLog, Event, Rule].map((m) => m.syncIndexes()));

  // Admin
  let admin: any = await User.findOne({ email: config.adminEmail });
  if (!admin) {
    admin = await User.create({
      email: config.adminEmail,
      password: await bcrypt.hash(config.adminPassword, 10),
      name: 'HS Admin',
      role: 'admin',
      language: 'en',
    });
    console.log(`admin created: ${config.adminEmail} / ${config.adminPassword}`);
  } else console.log(`admin exists: ${config.adminEmail}`);

  // Riders (created ~4 weeks ago so the history makes sense)
  const riderIds: Types.ObjectId[] = [];
  const joined = new Date(Date.now() - 28 * DAY);
  for (let i = 0; i < RIDERS.length; i++) {
    const [name, city, language, workerType = 'rider', zone = null] = RIDERS[i];
    const phone = phoneOf(i);
    const u = await User.findOneAndUpdate(
      { phone },
      { $setOnInsert: { phone, name, city, language, workerType, zone, role: 'rider', createdAt: joined, updatedAt: joined } },
      { upsert: true, new: true, timestamps: false },
    );
    riderIds.push(u._id);
  }
  console.log(`riders ready: ${riderIds.length} (${phoneOf(0)} .. ${phoneOf(RIDERS.length - 1)}, OTP ${config.staticOtp})`);

  // Modules + quizzes
  async function ensureModule(def: typeof FOOD) {
    let mod: any = await Mod.findOne({ 'title.en': def.title.en });
    if (!mod) {
      mod = await Mod.create({
        title: def.title,
        description: def.description,
        deadlineDays: def.deadlineDays,
        videoCompletePercent: 90,
        createdBy: admin._id,
      });
      await Quiz.create({ moduleId: mod._id, passMark: 3, questions: def.questions });
      console.log(`module created: ${def.title.en} (${mod._id})`);
    } else {
      console.log(`module exists: ${def.title.en} (${mod._id})`);
      // Backfill Urdu on a module seeded before Urdu existed. Question _ids are kept so synced answers still match.
      if (!mod.title?.ur) {
        await Mod.updateOne({ _id: mod._id }, { $set: { 'title.ur': def.title.ur, 'description.ur': def.description.ur }, $inc: { version: 1 } });
        const quiz: any = await Quiz.findOne({ moduleId: mod._id });
        if (quiz && quiz.questions.length === def.questions.length) {
          quiz.questions.forEach((q: any, i: number) => {
            q.text.ur = def.questions[i].text.ur;
            q.options.forEach((o: any, j: number) => (o.ur = def.questions[i].options[j]?.ur || ''));
          });
          await quiz.save();
        }
        console.log(`  Urdu text added`);
      }
    }
    // Attach video / PDF from ./seed-assets when the module has none
    const set: any = {};
    for (const kind of ['video', 'pdf'] as const) {
      if (mod[kind]?.path) continue;
      const f = await seedFile(def.key, kind);
      if (f) set[kind] = f;
      else console.log(`  no ${kind}: add seed-assets/${def.key}.${kind === 'video' ? 'mp4' : 'pdf'} or upload in the admin panel`);
    }
    if (Object.keys(set).length) {
      mod = await Mod.findByIdAndUpdate(mod._id, { $set: set, $inc: { version: 1 } }, { new: true });
      console.log(`  attached: ${Object.keys(set).join(', ')}`);
    }
    const quiz: any = await Quiz.findOne({ moduleId: mod._id }).lean();
    return { mod, quiz };
  }
  const food = await ensureModule(FOOD);
  const road = await ensureModule(ROAD);

  /**
   * Creates one assignment with its history. Only when the (rider, module) row is new, so a re-run never
   * changes existing data. Raw collection writes keep the historical createdAt / updatedAt.
   */
  let created = 0;
  const stats = { onTime: 0, late: 0, pastDue: 0, pending: 0 };
  async function assign(i: number, m: { mod: any; quiz: any }, assignedAt: Date, dueAt: Date, o: Outcome) {
    const userId = riderIds[i];
    const moduleId = m.mod._id;
    const done = o.kind === 'onTime' || o.kind === 'late' ? o : null;
    const overdueAt = new Date(dueAt.getTime() + MIN);
    const res = await Assignment.collection.updateOne(
      { userId, moduleId },
      {
        $setOnInsert: {
          userId,
          moduleId,
          assignedAt,
          dueAt,
          status: done ? 'completed' : o.kind === 'pastDue' ? 'overdue' : 'assigned',
          completedAt: done ? done.completedAt : null,
          overdueAt: o.kind === 'late' || o.kind === 'pastDue' ? overdueAt : null,
          assignedBy: admin._id,
          ruleId: null,
          createdAt: assignedAt,
          updatedAt: done ? done.completedAt : assignedAt,
        },
      },
      { upsert: true },
    );
    if (!res.upsertedCount) return;
    created++;
    stats[o.kind]++;

    const title = m.mod.title;
    const titleEn = title.en;
    const blockLog = (action: string, at: Date, reason: string) =>
      BlockLog.collection.insertOne({ userId, action, kind: 'MODULE_OVERDUE', moduleId, reason, by: 'SYSTEM', dueAt, createdAt: at });

    if (done) {
      const { completedAt, score, attempts } = done;
      const total = m.quiz.questions.length;
      // Quiz attempts: an optional failed first try, then the passing one
      for (let a = 0; a < attempts; a++) {
        const last = a === attempts - 1;
        const s = last ? score : Math.max(0, m.quiz.passMark - 1);
        const at = new Date(completedAt.getTime() - (attempts - 1 - a) * 25 * MIN);
        await Attempt.collection.insertOne({
          userId,
          moduleId,
          eventId: new Types.ObjectId(),
          answers: m.quiz.questions.map((q: any, qi: number) => ({
            questionId: String(q._id),
            selectedIndex: qi < s ? q.correctIndex : (q.correctIndex + 1) % q.options.length,
          })),
          score: s,
          total,
          passMark: m.quiz.passMark,
          passed: s >= m.quiz.passMark,
          attemptedAt: at,
          createdAt: at,
          updatedAt: at,
        });
      }
      const started = new Date(completedAt.getTime() - (attempts * 25 + 30) * MIN);
      await Progress.collection.insertOne({
        userId,
        moduleId,
        videoPercent: 100,
        videoCompleted: true,
        pdfViewed: true,
        pdfViewedAt: new Date(completedAt.getTime() - (attempts * 25 + 5) * MIN),
        quizAttempts: attempts,
        bestScore: score,
        lastScore: score,
        quizPassed: true,
        completed: true,
        completedAt,
        lastActivityAt: completedAt,
        createdAt: started,
        updatedAt: completedAt,
      });
      if (done.kind === 'late') {
        // The cron blocked them at the deadline; finishing the module lifted it (same logs as the live flow)
        await blockLog('BLOCK', overdueAt, `Module "${titleEn}" not completed before deadline ${dueAt.toISOString()}`);
        const mins = Math.round((completedAt.getTime() - overdueAt.getTime()) / MIN);
        await blockLog('AUTO_UNBLOCK', completedAt, `Auto-unblocked: rider completed overdue module "${titleEn}" (was blocked ${mins} min)`);
      }
    } else if (o.kind === 'pastDue') {
      await blockLog('BLOCK', overdueAt, `Module "${titleEn}" not completed before deadline ${dueAt.toISOString()}`);
      await User.updateOne(
        { _id: userId, isBlocked: { $ne: true } },
        {
          $set: {
            isBlocked: true,
            blockedAt: overdueAt,
            blockedBy: 'SYSTEM',
            blockReason: { kind: 'MODULE_OVERDUE', moduleId, moduleTitle: title, dueAt },
          },
        },
      );
      // Started the video, never finished
      await Progress.collection.insertOne({
        userId,
        moduleId,
        videoPercent: 30,
        videoCompleted: false,
        pdfViewed: false,
        quizAttempts: 0,
        completed: false,
        lastActivityAt: new Date(assignedAt.getTime() + 2 * DAY),
        createdAt: new Date(assignedAt.getTime() + 2 * DAY),
        updatedAt: new Date(assignedAt.getTime() + 2 * DAY),
      });
    } else if (o.kind === 'pending' && o.videoPercent) {
      const at = new Date(Date.now() - (1 + (i % 3)) * DAY);
      await Progress.collection.insertOne({
        userId,
        moduleId,
        videoPercent: o.videoPercent,
        videoCompleted: o.videoPercent >= 90,
        pdfViewed: false,
        quizAttempts: 0,
        completed: false,
        lastActivityAt: at,
        createdAt: at,
        updatedAt: at,
      });
    }
  }

  const now = Date.now();
  const hrs = (k: number) => ((k * 5) % 10) * 60 * MIN + 8 * 60 * MIN; // spread over the working day
  const scoreOf = (k: number) => (k % 3 === 0 ? 5 : 4);
  const attemptsOf = (k: number) => (k % 4 === 0 ? 2 : 1);

  // Riders 1-10: fresh Food Safety for the live demo; Road Safety started 6 days ago, riders 6-9 already done
  for (let i = 0; i < 10; i++) {
    await assign(i, food, new Date(now), new Date(now + FOOD.deadlineDays * DAY), { kind: 'pending' });
    const rAssigned = new Date(now - 6 * DAY);
    const rDue = new Date(rAssigned.getTime() + ROAD.deadlineDays * DAY);
    const o: Outcome =
      i >= 5 && i <= 8
        ? { kind: 'onTime', completedAt: new Date(rAssigned.getTime() + (i - 4) * DAY + hrs(i)), score: scoreOf(i), attempts: attemptsOf(i) }
        : { kind: 'pending' };
    await assign(i, road, rAssigned, rDue, o);
  }

  // Riders 11-36: Food Safety campaign 3 weeks ago (due 2 weeks ago); Road Safety 10 days ago (due in 4 days)
  const LATE = [2, 5, 11, 15, 22];
  const PAST_DUE = [7, 19]; // Rahul Nair (Riyadh), Adnan Qureshi (Dammam): still blocked
  for (let k = 0; k < RIDERS.length - 10; k++) {
    const i = k + 10;
    const fAssigned = new Date(now - 21 * DAY);
    const fDue = new Date(now - 14 * DAY);
    let fo: Outcome;
    if (PAST_DUE.includes(k)) fo = { kind: 'pastDue' };
    else if (LATE.includes(k)) fo = { kind: 'late', completedAt: new Date(fDue.getTime() + (1 + (k % 9)) * DAY + hrs(k)), score: 3 + (k % 2), attempts: 2 };
    else fo = { kind: 'onTime', completedAt: new Date(fAssigned.getTime() + (((k * 7) % 20) * 0.32) * DAY + hrs(k)), score: scoreOf(k), attempts: attemptsOf(k) };
    await assign(i, food, fAssigned, fDue, fo);

    const rAssigned = new Date(now - 10 * DAY);
    const rDue = new Date(rAssigned.getTime() + ROAD.deadlineDays * DAY);
    let ro: Outcome;
    if (PAST_DUE.includes(k) || k % 5 === 1) ro = { kind: 'pending', videoPercent: k % 2 ? 45 : 0 };
    else ro = { kind: 'onTime', completedAt: new Date(rAssigned.getTime() + (0.5 + ((k * 5) % 18) * 0.5) * DAY + hrs(k) / 4), score: scoreOf(k + 1), attempts: attemptsOf(k + 1) };
    await assign(i, road, rAssigned, rDue, ro);
  }

  console.log(
    `assignments created: ${created} (on time ${stats.onTime}, late ${stats.late}, still overdue/blocked ${stats.pastDue}, open ${stats.pending})`,
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
