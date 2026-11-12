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

/** Local disk storage for the POC: ./uploads/videos and ./uploads/pdfs, served at /uploads/... */
export function uploadOptions(kind: 'video' | 'pdf'): MulterOptions {
  const sub = kind === 'video' ? 'videos' : 'pdfs';
  return {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(config.uploadDir, sub);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => cb(null, `${new Types.ObjectId().toHexString()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: (kind === 'video' ? config.maxVideoMb : config.maxPdfMb) * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const allowed =
        kind === 'video'
          ? file.mimetype.startsWith('video/') || VIDEO_EXT.includes(ext)
          : file.mimetype === 'application/pdf' || ext === '.pdf';
      if (allowed) cb(null, true);
      else cb(new AppException('invalid_file_type', 400), false);
    },
  };
}

export const uploadRelPath = (kind: 'video' | 'pdf', filename: string) =>
  `/uploads/${kind === 'video' ? 'videos' : 'pdfs'}/${filename}`;

export function removeUpload(relPath?: string | null) {
  if (!relPath || !relPath.startsWith('/uploads/')) return;
  fs.unlink(path.join(config.uploadDir, relPath.replace('/uploads/', '')), () => undefined);
}
