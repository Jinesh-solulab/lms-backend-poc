import { ciEquals } from './util';

/**
 * Known Saudi cities (POC list). The English name is what we store on users and rules, so
 * "riyadh", "الرياض" and "Riyad" all become "Riyadh" (see canonicalCity()). Unknown cities are still
 * accepted as typed (trimmed) so nothing breaks; the dropdown in the admin UI uses this list.
 */
export const SAUDI_CITIES: { en: string; ar: string; ur: string; aliases?: string[] }[] = [
  { en: 'Riyadh', ar: 'الرياض', ur: 'ریاض', aliases: ['Riyad', 'Ar Riyadh', 'Al Riyadh'] },
  { en: 'Jeddah', ar: 'جدة', ur: 'جدہ', aliases: ['Jedda', 'Jiddah', 'Jidda'] },
  { en: 'Makkah', ar: 'مكة المكرمة', ur: 'مکہ', aliases: ['Mecca', 'Makka', 'Mekkah', 'مكة'] },
  { en: 'Madinah', ar: 'المدينة المنورة', ur: 'مدینہ', aliases: ['Medina', 'Madina', 'Al Madinah', 'المدينة'] },
  { en: 'Dammam', ar: 'الدمام', ur: 'دمام', aliases: ['Damam'] },
  { en: 'Khobar', ar: 'الخبر', ur: 'الخبر', aliases: ['Al Khobar', 'Alkhobar'] },
  { en: 'Dhahran', ar: 'الظهران', ur: 'ظہران' },
  { en: 'Al Ahsa', ar: 'الأحساء', ur: 'الاحساء', aliases: ['Al Hasa', 'Hofuf', 'Al-Ahsa'] },
  { en: 'Jubail', ar: 'الجبيل', ur: 'جبیل', aliases: ['Al Jubail'] },
  { en: 'Qatif', ar: 'القطيف', ur: 'قطیف', aliases: ['Al Qatif'] },
  { en: 'Taif', ar: 'الطائف', ur: 'طائف', aliases: ['At Taif', 'Al Taif'] },
  { en: 'Tabuk', ar: 'تبوك', ur: 'تبوک' },
  { en: 'Abha', ar: 'أبها', ur: 'ابہا' },
  { en: 'Khamis Mushait', ar: 'خميس مشيط', ur: 'خمیس مشیط', aliases: ['Khamis Mushayt'] },
  { en: 'Buraidah', ar: 'بريدة', ur: 'بریدہ', aliases: ['Buraydah', 'Buraida'] },
  { en: 'Hail', ar: 'حائل', ur: 'حائل', aliases: ["Ha'il"] },
  { en: 'Jazan', ar: 'جازان', ur: 'جازان', aliases: ['Jizan', 'Gizan'] },
  { en: 'Najran', ar: 'نجران', ur: 'نجران' },
  { en: 'Yanbu', ar: 'ينبع', ur: 'ینبع' },
  { en: 'Al Kharj', ar: 'الخرج', ur: 'الخرج', aliases: ['Kharj'] },
];

export const WORKER_TYPE_LIST = [
  { value: 'rider', en: 'Rider', ar: 'مندوب توصيل', ur: 'رائیڈر' },
  { value: 'picker', en: 'Picker', ar: 'مجهّز الطلبات', ur: 'پکر' },
  { value: 'bpo', en: 'BPO (customer support)', ar: 'دعم العملاء', ur: 'کسٹمر سپورٹ' },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const CITY_INDEX = new Map<string, string>();
for (const c of SAUDI_CITIES) for (const n of [c.en, c.ar, c.ur, ...(c.aliases || [])]) CITY_INDEX.set(norm(n), c.en);

/** "  riyadh " / "الرياض" / "Riyad" -> "Riyadh". Unknown -> trimmed input. Empty -> null. */
export function canonicalCity(v?: string | null): string | null {
  if (v == null) return null;
  const t = String(v).trim().replace(/\s+/g, ' ');
  if (!t) return null;
  return CITY_INDEX.get(norm(t)) || t;
}

export const cleanText = (v?: string | null) => {
  const t = v == null ? '' : String(v).trim();
  return t || null;
};

/** Old users have no workerType: they count as 'rider'. */
export const workerTypeFilter = (wt: string) => (wt === 'rider' ? { $in: ['rider', null] } : wt);

export type RiderCriteria = { city?: string | null; workerType?: string | null; zone?: string | null };

/** Mongo filter for riders matching city / workerType / zone (each optional = any). */
export function riderFilter(c: RiderCriteria = {}, onlyActive = true): any {
  const f: any = { role: 'rider' };
  if (onlyActive) f.isActive = true;
  const city = canonicalCity(c.city);
  if (city) f.city = ciEquals(city);
  if (c.workerType) f.workerType = workerTypeFilter(c.workerType);
  const zone = cleanText(c.zone);
  if (zone) f.zone = ciEquals(zone);
  return f;
}

/** Same matching as riderFilter(), in memory, for one already-loaded user. */
export function riderMatches(u: any, c: RiderCriteria = {}): boolean {
  if (!u || u.role !== 'rider' || u.isActive === false) return false;
  const city = canonicalCity(c.city);
  if (city && norm(u.city || '') !== norm(city)) return false;
  if (c.workerType && (u.workerType || 'rider') !== c.workerType) return false;
  const zone = cleanText(c.zone);
  if (zone && norm(u.zone || '') !== norm(zone)) return false;
  return true;
}
