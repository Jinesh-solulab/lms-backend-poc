/* npm run seed  -> admin + 10 riders (Riyadh/Jeddah) + "Food Safety Basics" module with a 5-question EN/AR/UR quiz, assigned to all riders. Safe to re-run. */
import { config } from './config';
import * as bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { AssignmentSchema, M, QuizSchema, TrainingModuleSchema, UserSchema } from './schemas';

const L = (en: string, ar: string, ur: string) => ({ en, ar, ur });

const TITLE = L('Food Safety Basics', 'أساسيات سلامة الغذاء', 'فوڈ سیفٹی کی بنیادی باتیں');
const DESCRIPTION = L(
  'Learn how to keep food safe during delivery.',
  'تعلّم كيفية الحفاظ على سلامة الطعام أثناء التوصيل.',
  'ڈیلیوری کے دوران کھانے کو محفوظ رکھنے کا طریقہ سیکھیں۔',
);
const QUESTIONS = [
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
];

async function main() {
  await mongoose.connect(config.mongoUri);
  const User = mongoose.model(M.User, UserSchema);
  const Mod = mongoose.model(M.TrainingModule, TrainingModuleSchema);
  const Quiz = mongoose.model(M.Quiz, QuizSchema);
  const Assignment = mongoose.model(M.Assignment, AssignmentSchema);
  await Promise.all([User.syncIndexes(), Mod.syncIndexes(), Quiz.syncIndexes(), Assignment.syncIndexes()]);

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

  // Riders
  const riders = [
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
  ];
  const riderIds = [];
  for (let i = 0; i < riders.length; i++) {
    const p = `+9665000000${String(i + 1).padStart(2, '0')}`; // +966500000001 ... +966500000010
    const [name, city, language] = riders[i];
    const u = await User.findOneAndUpdate(
      { phone: p },
      { $setOnInsert: { phone: p, name, city, language, role: 'rider' } },
      { upsert: true, new: true },
    );
    riderIds.push(u._id);
  }
  console.log(`riders ready: ${riderIds.length} (phones +966500000001 .. +966500000010, OTP ${config.staticOtp})`);

  // Module + quiz
  let mod: any = await Mod.findOne({ 'title.en': TITLE.en });
  if (!mod) {
    mod = await Mod.create({ title: TITLE, description: DESCRIPTION, deadlineDays: 7, videoCompletePercent: 90, createdBy: admin._id });
    await Quiz.create({ moduleId: mod._id, passMark: 3, questions: QUESTIONS });
    console.log(`module created: ${TITLE.en} (${mod._id}) – upload video/PDF via POST /api/admin/modules/${mod._id}/video|pdf`);
  } else {
    console.log(`module exists: ${TITLE.en} (${mod._id})`);
    // Backfill Urdu on a module seeded before Urdu existed. Question _ids are kept so synced answers still match.
    if (!mod.title?.ur) {
      await Mod.updateOne({ _id: mod._id }, { $set: { 'title.ur': TITLE.ur, 'description.ur': DESCRIPTION.ur }, $inc: { version: 1 } });
      const quiz: any = await Quiz.findOne({ moduleId: mod._id });
      if (quiz && quiz.questions.length === QUESTIONS.length) {
        quiz.questions.forEach((q: any, i: number) => {
          q.text.ur = QUESTIONS[i].text.ur;
          q.options.forEach((o: any, j: number) => (o.ur = QUESTIONS[i].options[j]?.ur || ''));
        });
        await quiz.save();
      }
      console.log('module: Urdu text added');
    }
  }

  // Assign to all riders, due in 7 days
  const dueAt = new Date(Date.now() + 7 * 86_400_000);
  const res = await Assignment.bulkWrite(
    riderIds.map((uid) => ({
      updateOne: {
        filter: { userId: uid, moduleId: mod._id },
        update: { $setOnInsert: { userId: uid, moduleId: mod._id, assignedAt: new Date(), dueAt, status: 'assigned', assignedBy: admin._id } },
        upsert: true,
      },
    })),
  );
  console.log(`assignments created: ${res.upsertedCount}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
