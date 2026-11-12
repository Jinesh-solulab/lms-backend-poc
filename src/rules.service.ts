import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Types } from 'mongoose';
import { config } from './config';
import { canonicalCity, cleanText, RiderCriteria, riderFilter, riderMatches } from './common/meta';
import { DbModel, M } from './schemas';

const CHUNK = 1000;

/**
 * Saved assignment rules ("riders in Riyadh -> Road Safety, 7 days").
 * A rule assigns when it is created / switched on, whenever a rider is created or changes city,
 * worker type or zone (applyForRider), and in a 5-minute safety sweep.
 * Rules only ADD assignments: the (userId, moduleId) upsert never duplicates and never touches existing rows.
 */
@Injectable()
export class RulesService {
  private logger = new Logger('AssignmentRules');
  private sweeping = false;

  constructor(
    @InjectModel(M.AssignmentRule) private rules: DbModel,
    @InjectModel(M.User) private users: DbModel,
    @InjectModel(M.TrainingModule) private modules: DbModel,
    @InjectModel(M.Assignment) private assignments: DbModel,
  ) {}

  /** Cleans criteria the same way everywhere: canonical city, null for "any". */
  normalizeCriteria(c: RiderCriteria = {}) {
    return {
      city: canonicalCity(c.city),
      workerType: c.workerType || null,
      zone: cleanText(c.zone),
    };
  }

  private dueAt(rule: any, module: any, from: number) {
    if (rule.deadlineMinutes) return new Date(from + rule.deadlineMinutes * 60_000);
    return new Date(from + (rule.deadlineDays || module?.deadlineDays || 7) * 86_400_000);
  }

  /** Assign the rule's module to matching riders (all, or only `onlyUserIds`). Returns how many NEW rows were created. */
  async applyRule(rule: any, onlyUserIds?: Types.ObjectId[]): Promise<number> {
    const module = await this.modules.findById(rule.moduleId).select('isActive deadlineDays').lean();
    const now = Date.now();
    if (!module || !module.isActive) {
      await this.rules.updateOne({ _id: rule._id }, { $set: { lastRunAt: new Date(now) } });
      return 0;
    }
    const filter = riderFilter(rule.criteria || {});
    if (onlyUserIds) filter._id = { $in: onlyUserIds };
    const ids: Types.ObjectId[] = await this.users.find(filter).distinct('_id');

    let created = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const res = await this.assignments.bulkWrite(
        ids.slice(i, i + CHUNK).map((userId) => ({
          updateOne: {
            filter: { userId, moduleId: rule.moduleId },
            update: {
              $setOnInsert: {
                userId,
                moduleId: rule.moduleId,
                assignedAt: new Date(now),
                dueAt: this.dueAt(rule, module, now),
                status: 'assigned',
                assignedBy: rule.createdBy || null,
                ruleId: rule._id,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      created += res.upsertedCount || 0;
    }
    await this.rules.updateOne({ _id: rule._id }, { $inc: { assignedCount: created }, $set: { lastRunAt: new Date(now) } });
    return created;
  }

  /**
   * Hook: call after a rider is created, self-registers or changes city / worker type / zone.
   * Never throws (a rule problem must not break login or profile save).
   */
  async applyForRider(userId: Types.ObjectId | string): Promise<number> {
    try {
      const u = await this.users.findById(userId).lean();
      if (!u || u.role !== 'rider' || !u.isActive) return 0;
      const active = await this.rules.find({ isActive: true }).lean();
      let total = 0;
      for (const r of active) {
        if (!riderMatches(u, r.criteria || {})) continue;
        total += await this.applyRule(r, [u._id]);
      }
      if (total) this.logger.log(`rider ${u._id}: ${total} module(s) assigned by rules`);
      return total;
    } catch (err: any) {
      this.logger.error(`applyForRider(${userId}) failed: ${err?.message || err}`);
      return 0;
    }
  }

  /** "N riders match" before saving. With moduleId it also says how many are new. */
  async preview(criteria: RiderCriteria = {}, moduleId?: string) {
    const c = this.normalizeCriteria(criteria);
    const filter = riderFilter(c);
    const matched = await this.users.countDocuments(filter);
    const out: any = { matched, criteria: c };
    if (moduleId) {
      const ids = await this.users.find(filter).distinct('_id');
      const alreadyAssigned = await this.assignments.countDocuments({ moduleId: new Types.ObjectId(moduleId), userId: { $in: ids } });
      out.alreadyAssigned = alreadyAssigned;
      out.willAssign = matched - alreadyAssigned;
    }
    out.sample = await this.users.find(filter).select('name phone city workerType zone').limit(5).lean();
    return out;
  }

  /** Safety net: re-run every active rule (cheap: only creates rows that are missing). */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweep() {
    if (!config.deadlineCronEnabled || this.sweeping) return;
    this.sweeping = true;
    try {
      const active = await this.rules.find({ isActive: true }).lean();
      let total = 0;
      for (const r of active) total += await this.applyRule(r);
      if (total) this.logger.log(`sweep: ${total} new assignment(s)`);
    } catch (err: any) {
      this.logger.error(`sweep failed: ${err?.message || err}`);
    } finally {
      this.sweeping = false;
    }
  }
}
