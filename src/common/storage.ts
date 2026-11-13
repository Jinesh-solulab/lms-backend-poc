import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, mongo, Types } from 'mongoose';
import { config } from '../config';

/**
 * Uploaded files (videos, PDFs, avatars) live in MongoDB GridFS (bucket "uploads"), so they survive
 * server restarts and redeploys (Render's disk is wiped on every deploy).
 * The GridFS filename is the public relative path, e.g. /uploads/videos/<objectId>.mp4, and the URL stays
 * BASE_URL + that path. Multer first writes the upload to a temp file; putFile streams it into GridFS.
 */
export const BUCKET = 'uploads';
type Db = mongo.Db;

const bucket = (db: Db) => new mongo.GridFSBucket(db, { bucketName: BUCKET });

/** Content-Type by extension (same as the old static file server did), so a wrong/generic upload mimetype can't break playback. */
const EXT_TYPE: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.3gp': 'video/3gpp', '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
};
const typeFor = (relPath: string, fallback?: string) => EXT_TYPE[path.extname(relPath).toLowerCase()] || fallback || 'application/octet-stream';

/** Stream a local file into GridFS under `relPath`. The temp file is removed when `removeSource` is true. */
export async function putFile(db: Db, srcPath: string, relPath: string, mimeType: string, originalName: string, removeSource = true) {
  const idHex = path.basename(relPath, path.extname(relPath));
  const id = Types.ObjectId.isValid(idHex) ? new Types.ObjectId(idHex) : new Types.ObjectId();
  try {
    await pipeline(
      fs.createReadStream(srcPath),
      bucket(db).openUploadStreamWithId(id, relPath, { metadata: { contentType: mimeType, originalName } }),
    );
  } finally {
    if (removeSource) fs.unlink(srcPath, () => undefined);
  }
}

/** Delete a stored file (GridFS, plus an old local-disk copy if one exists). Never throws. */
export async function deleteFile(db: Db, relPath?: string | null) {
  if (!relPath || !relPath.startsWith('/uploads/')) return;
  try {
    const files = await bucket(db).find({ filename: relPath }).toArray();
    for (const f of files) await bucket(db).delete(f._id);
  } catch {
    /* already gone */
  }
  fs.unlink(path.join(config.uploadDir, relPath.replace('/uploads/', '')), () => undefined);
}

/**
 * Express handler for GET/HEAD /uploads/*. Supports Range requests (video seeking, resumable downloads).
 * Falls through to next() when the file is not in GridFS, so old files on local disk still work.
 */
export function serveFile(getDb: () => Db) {
  return async (req: any, res: any, next: any) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    try {
      const relPath = decodeURIComponent(String(req.originalUrl || req.url).split('?')[0]);
      const f: any = await bucket(getDb()).find({ filename: relPath }).limit(1).next();
      if (!f) return next();

      const size: number = f.length;
      const etag = `"${String(f._id)}-${size}"`;
      res.setHeader('Content-Type', typeFor(relPath, f.metadata?.contentType));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', new Date(f.uploadDate).toUTCString());
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable'); // file names are unique, never overwritten
      if (req.headers['if-none-match'] === etag) return res.status(304).end();

      let start = 0;
      let end = size - 1;
      const range = req.headers.range as string | undefined;
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (m && (m[1] || m[2])) {
          if (m[1] === '') {
            start = Math.max(size - Number(m[2]), 0); // suffix range: last N bytes
          } else {
            start = Number(m[1]);
            if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
          }
        }
        if (!m || start > end || start >= size) {
          res.setHeader('Content-Range', `bytes */${size}`);
          return res.status(416).end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      } else {
        res.status(200);
      }
      res.setHeader('Content-Length', size ? end - start + 1 : 0);
      if (req.method === 'HEAD' || size === 0) return res.end();

      const stream = bucket(getDb()).openDownloadStream(f._id, { start, end: end + 1 });
      stream.on('error', (err: any) => (res.headersSent ? res.destroy(err) : next(err)));
      req.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  };
}

/** Nest wrapper used by the controllers. */
@Injectable()
export class FileStorage {
  constructor(@InjectConnection() private conn: Connection) {}

  /** Save a multer temp file under `relPath` in GridFS (temp file removed afterwards). */
  save(file: Express.Multer.File, relPath: string) {
    return putFile(this.conn.db as any, file.path, relPath, file.mimetype, file.originalname);
  }

  remove(relPath?: string | null) {
    return deleteFile(this.conn.db as any, relPath);
  }

  /** Drop a multer temp file that will not be saved (e.g. module not found). */
  discard(file?: Express.Multer.File) {
    if (file?.path) fs.unlink(file.path, () => undefined);
  }
}
