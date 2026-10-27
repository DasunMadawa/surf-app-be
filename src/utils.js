import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

export const newSecret = (prefix, bytes = 24) => `${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`;

const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function bookingRef() {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_CHARS[crypto.randomInt(REF_CHARS.length)];
  return `STR-${s}`;
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
export const isPhone = (v) => typeof v === 'string' && /^\+?[\d\s()-]{7,20}$/.test(v.trim());
export const isUrl = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
export const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const isSlot = (v) => typeof v === 'string' && /^\d{2}:\d{2} - \d{2}:\d{2}$/.test(v);

export function localISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const todayISO = () => localISO(new Date());

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return localISO(new Date(y, m - 1, d + n));
}

export const formatLKR = (n, currency = 'LKR') => `${currency} ${Number(n).toLocaleString('en-US')}`;

export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
