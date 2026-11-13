// Unblock every blocked rider and extend unfinished deadlines.
//   node scripts/unblock-all.mjs              -> dry run (prints what would change)
//   node scripts/unblock-all.mjs --yes        -> apply, new deadline = now + 7 days
//   node scripts/unblock-all.mjs --days 14 --yes
// Every not-completed assignment whose dueAt is earlier than the new deadline (incl. 'overdue' rows)
// goes back to 'assigned' with dueAt = new deadline, so the cron does not re-block straight away.
import 'dotenv/config';
import mongoose from 'mongoose';

const args = process.argv.slice(2);
const apply = args.includes('--yes');
const di = args.indexOf('--days');
const days = di >= 0 ? Number(args[di + 1]) : 7;
if (!(days > 0)) throw new Error('--days must be a positive number');
if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');

const now = new Date();
const newDueAt = new Date(now.getTime() + days * 86400000);

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection;
const users = db.collection('users');
const assignments = db.collection('assignments');
const logs = db.collection('block_logs');

const admin = await users.findOne({ role: 'admin' }, { projection: { _id: 1 } });
const blocked = await users.find({ role: 'rider', isBlocked: true }).project({ _id: 1, name: 1, phone: 1, blockReason: 1 }).toArray();
const toExtend = { status: { $in: ['assigned', 'overdue'] }, dueAt: { $lt: newDueAt } };
const extendCount = await assignments.countDocuments(toExtend);
const overdueCount = await assignments.countDocuments({ status: 'overdue' });

console.log(`DB: ${db.name}`);
console.log(`Blocked riders: ${blocked.length}`);
for (const u of blocked) console.log(`  - ${u.name || ''} ${u.phone} (${u.blockReason?.kind || 'MANUAL'})`);
console.log(`Assignments to extend: ${extendCount} (of which overdue: ${overdueCount}) -> new dueAt ${newDueAt.toISOString()}`);

if (!apply) {
  console.log('\nDry run. Re-run with --yes to apply.');
} else {
  const ext = await assignments.updateMany(toExtend, { $set: { status: 'assigned', dueAt: newDueAt, overdueAt: null, updatedAt: now } });
  const unb = await users.updateMany(
    { role: 'rider', isBlocked: true },
    { $set: { isBlocked: false, blockReason: null, blockedAt: null, blockedBy: null, updatedAt: now } },
  );
  if (blocked.length) {
    await logs.insertMany(
      blocked.map((u) => ({
        userId: u._id,
        action: 'UNBLOCK',
        kind: u.blockReason?.kind || 'MANUAL',
        moduleId: u.blockReason?.moduleId || null,
        reason: 'Unblocked by admin (bulk unblock, deadlines extended)',
        by: admin ? String(admin._id) : 'SYSTEM',
        newDueAt,
        createdAt: now,
      })),
    );
  }
  console.log(`\nUnblocked ${unb.modifiedCount} riders, extended ${ext.modifiedCount} assignments.`);
}
await mongoose.disconnect();
