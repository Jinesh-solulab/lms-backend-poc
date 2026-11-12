import * as path from 'path';
import * as dotenv from 'dotenv';

// Load <project root>/.env no matter which folder the command is run from.
// config.ts sits in src/ (start:dev) or dist/ (build), both one level below the root.
const envFile = path.resolve(__dirname, '..', '.env');
const loaded = dotenv.config({ path: envFile });
export const envSource = loaded.error ? 'defaults (no .env found)' : envFile;

const port = parseInt(process.env.PORT || '3000', 10);

export const config = {
  port,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hs_lms',
  jwtSecret: process.env.JWT_SECRET || 'change-me-dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '30d',
  staticOtp: process.env.STATIC_OTP || '123456',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  baseUrl: (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@hs-demo.com').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'Admin@123',
  maxVideoMb: parseInt(process.env.MAX_VIDEO_MB || '500', 10),
  maxPdfMb: parseInt(process.env.MAX_PDF_MB || '50', 10),
  deadlineCronEnabled: process.env.DEADLINE_CRON_ENABLED !== 'false',
};

/** Mongo URI with the password hidden, safe to log. */
export const safeMongoUri = () => config.mongoUri.replace(/\/\/([^:@/]+):[^@]+@/, '//$1:****@');

/** Stored paths are relative (/uploads/...), so changing BASE_URL never breaks old records. */
export const fileUrl = (relPath?: string | null) => (relPath ? `${config.baseUrl}${relPath}` : null);
