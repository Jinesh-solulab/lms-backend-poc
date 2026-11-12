import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { config } from './config';
import { DbModel, M } from './schemas';

/**
 * Auto-block: every minute, find assignments past their due date that are still not completed,
 * mark them overdue and block the rider with the reason. No Redis / queue needed.
 * Admin unblocks manually (see AdminRidersController).
 */
@Injectable()
export class BlockingService {
  private logger = new Logger('DeadlineCron');
  private running = false;

  constructor(
    @InjectModel(M.Assignment) private assignments: DbModel,
    @InjectModel(M.TrainingModule) private modules: DbModel,
    @InjectModel(M.User) private users: DbModel,
    @InjectModel(M.BlockLog) private logs: DbModel,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cron() {
    if (!config.deadlineCronEnabled) return;
    await this.runDeadlineCheck();
  }

  async runDeadlineCheck() {
    if (this.running) return { skipped: true, reason: 'already_running' };
    this.running = true;
    const now = new Date();
    let overdue = 0;
    let blocked = 0;
    const blockedRiders: any[] = [];
    try {
      // Only 'assigned' rows: an overdue row that an admin unblocked stays 'overdue', so it is never re-blocked.
      const due = await this.assignments.find({ status: 'assigned', dueAt: { $lt: now } }).limit(2000).lean();
      const titles = new Map<string, any>();

      for (const a of due) {
        const claimed = await this.assignments.findOneAndUpdate(
          { _id: a._id, status: 'assigned' },
          { $set: { status: 'overdue', overdueAt: now } },
          { new: true },
        );
        if (!claimed) continue; // someone else (completion / another run) changed it
        overdue++;

        const mid = String(a.moduleId);
        if (!titles.has(mid)) titles.set(mid, (await this.modules.findById(a.moduleId).select('title').lean())?.title || { ar: '', en: '', ur: '' });
        const title = titles.get(mid);

        const user = await this.users.findOneAndUpdate(
          { _id: a.userId, role: 'rider', isBlocked: false },
          {
            $set: {
              isBlocked: true,
              blockedAt: now,
              blockedBy: 'SYSTEM',
              blockReason: { kind: 'MODULE_OVERDUE', moduleId: a.moduleId, moduleTitle: title, dueAt: a.dueAt },
            },
          },
          { new: true },
        );

        await this.logs.create({
          userId: a.userId,
          action: user ? 'BLOCK' : 'OVERDUE', // OVERDUE = rider was already blocked for something else
          kind: 'MODULE_OVERDUE',
          moduleId: a.moduleId,
          reason: `Module "${title.en || title.ar}" not completed before deadline ${new Date(a.dueAt).toISOString()}`,
          by: 'SYSTEM',
          dueAt: a.dueAt,
        });

        if (user) {
          blocked++;
          blockedRiders.push({ userId: String(a.userId), phone: user.phone, moduleId: mid, dueAt: a.dueAt });
        }
      }

      if (overdue) this.logger.log(`overdue=${overdue} blocked=${blocked}`);
      return { checkedAt: now, overdue, blocked, blockedRiders };
    } finally {
      this.running = false;
    }
  }
}
