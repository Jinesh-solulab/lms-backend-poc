import * as fs from 'fs';
import * as path from 'path';
import { Types } from 'mongoose';
import { diskStorage } from 'multer';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { config, fileUrl } from '../config';
import { AppException } from './http';
import { Lang, t } from './messages';

/** Accepts 05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX, +9665XXXXXXXX, 009665..., and Arabic-Indic digits. Returns +9665XXXXXXXX. */
export function normalizeSaudiPhone(input: string): string | null {
  if (!input) return null;
  let s = String(input)
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  const m = s.match(/^(?:\+?966|0)?(5\d{8})$/);
  return m ? `+966${m[1]}` : null;
}

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const ciEquals = (s: string) => new RegExp(`^${escapeRegex(s.trim())}$`, 'i');

/**
 * $or for an admin "search name or phone" box. A Saudi number typed in any form (0500000003, 5500..., +966...)
 * also matches the stored +9665XXXXXXXX. `prefix` is for aggregation paths such as 'u.'.
 */
export function riderSearchOr(search: string, prefix = '') {
  const s = search.trim();
  const or: any[] = [{ [`${prefix}name`]: new RegExp(escapeRegex(s), 'i') }, { [`${prefix}phone`]: new RegExp(escapeRegex(s), 'i') }];
  const phone = normalizeSaudiPhone(s);
  if (phone) or.push({ [`${prefix}phone`]: phone });
  return or;
}

/** Pick the user's language from a { ar, en, ur } object. Fallback: English, then Arabic (Urdu is optional content). */
export function loc(v: any, lang: Lang): string {
  if (!v) return '';
  return v[lang] || v.en || v.ar || v.ur || '';
}

export function blockInfo(u: any, lang: Lang) {
  if (!u?.isBlocked) return null;
  const r = u.blockReason || {};
  const message =
    r.kind === 'MODULE_OVERDUE'
      ? t('blocked_overdue_reason', lang, { title: loc(r.moduleTitle, lang) })
      : t('blocked_manual_reason', lang, { note: r.note || '' });
  return {
    kind: r.kind || 'MANUAL',
    moduleId: r.moduleId || null,
    moduleTitle: r.moduleTitle || null,
    dueAt: r.dueAt || null,
    note: r.note || null,
    message,
    blockedAt: u.blockedAt || null,
    blockedBy: u.blockedBy || null,
  };
}

export function publicUser(u: any, lang: Lang) {
  return {
    id: String(u._id),
    phone: u.phone || null,
    email: u.email || null,
    name: u.name || '',
    role: u.role,
    city: u.city || null,
    workerType: u.workerType || 'rider',
    zone: u.zone || null,
    avatarUrl: fileUrl(u.avatar?.path),
    language: u.language,
    isActive: u.isActive,
    isBlocked: !!u.isBlocked,
    block: blockInfo(u, lang),
    createdAt: u.createdAt,
  };
}

export function fileView(f: any) {
  if (!f?.path) return null;
  return { url: fileUrl(f.path), path: f.path, originalName: f.originalName, sizeBytes: f.sizeBytes, mimeType: f.mimeType };
}

const VIDEO_EXT = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.3gp'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const AVATAR_MAX_MB = 5;

export type UploadKind = 'video' | 'pdf' | 'avatar';
const SUBDIR: Record<UploadKind, string> = { video: 'videos', pdf: 'pdfs', avatar: 'avatars' };

/** Local disk storage for the POC: ./uploads/videos, ./uploads/pdfs, ./uploads/avatars, served at /uploads/... */
export function uploadOptions(kind: UploadKind): MulterOptions {
  const sub = SUBDIR[kind];
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(config.uploadDir, sub);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => cb(null, `${new Types.ObjectId().toHexString()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: (kind === 'video' ? config.maxVideoMb : kind === 'pdf' ? config.maxPdfMb : AVATAR_MAX_MB) * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const allowed =
        kind === 'video'
          ? file.mimetype.startsWith('video/') || VIDEO_EXT.includes(ext)
          : kind === 'pdf'
            ? file.mimetype === 'application/pdf' || ext === '.pdf'
            : ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) && IMAGE_EXT.includes(ext);
      if (allowed) cb(null, true);
      else cb(new AppException('invalid_file_type', 400), false);
    },
  };
}

export const uploadRelPath = (kind: UploadKind, filename: string) => `/uploads/${SUBDIR[kind]}/${filename}`;

export function removeUpload(relPath?: string | null) {
  if (!relPath || !relPath.startsWith('/uploads/')) return;
  fs.unlink(path.join(config.uploadDir, relPath.replace('/uploads/', '')), () => undefined);
}
