// Thin client for the Google Places API (New).
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
// The key never leaves the server: photos are proxied through /api/media/place-photo.
//
// ── Cost optimisation layers ──
// 1. Field-mask tiers:  "basic" requests only cheap/free fields; "full" adds phone,
//    website, photos, reviews (higher billing SKU). Controlled via PLACES_FIELD_TIER.
// 2. Response cache:    identical searches are cached in-memory for PLACES_CACHE_TTL
//    seconds, so re-running the import or refreshing the page doesn't re-bill.
// 3. Request dedup:     concurrent identical API calls share one in-flight request.
// 4. Rate limiter:      caps requests/minute to PLACES_RATE_LIMIT (default 30).
// 5. Photo TTL cache:   photo media URIs are cached for 50 min (Google's are short-lived).

const BASE = () => process.env.PLACES_API_BASE || 'https://places.googleapis.com/v1';
const KEY = () => process.env.GOOGLE_MAPS_API_KEY;

export const placesConfigured = () => Boolean(KEY());

// ── Field masks ────────────────────────────────────────────────────────────────
// Basic fields are free / cheap (Basic SKU).
const BASIC_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'businessStatus',
  'types',
  'editorialSummary',
  'googleMapsUri',
];

// Full adds Contact + Atmosphere fields (higher billing SKU).
const EXTRA_FIELDS = [
  'internationalPhoneNumber',
  'nationalPhoneNumber',
  'websiteUri',
  'photos',
  'reviews',
];

function fieldTier() {
  return (process.env.PLACES_FIELD_TIER || 'full').toLowerCase();
}

function placeFields() {
  return fieldTier() === 'basic' ? BASIC_FIELDS : [...BASIC_FIELDS, ...EXTRA_FIELDS];
}

// ── Rate limiter (token-bucket, per-minute) ────────────────────────────────────
const rateState = { tokens: 0, maxTokens: 0, lastRefill: 0, intervalMs: 60_000 };

function rateLimitMax() {
  return Math.max(1, Number(process.env.PLACES_RATE_LIMIT) || 30);
}

async function acquireToken() {
  const max = rateLimitMax();
  const now = Date.now();
  if (rateState.maxTokens !== max || now - rateState.lastRefill >= rateState.intervalMs) {
    rateState.maxTokens = max;
    rateState.tokens = max;
    rateState.lastRefill = now;
  }
  if (rateState.tokens > 0) {
    rateState.tokens--;
    return;
  }
  // Wait until the bucket refills.
  const waitMs = rateState.intervalMs - (now - rateState.lastRefill) + 50;
  await new Promise((r) => setTimeout(r, waitMs));
  rateState.tokens = rateState.maxTokens - 1;
  rateState.lastRefill = Date.now();
}

// ── Request deduplication ──────────────────────────────────────────────────────
// Concurrent calls with the same cache key share a single in-flight promise.
const inflight = new Map();

// ── Response cache (in-memory LRU-ish) ─────────────────────────────────────────
const responseCache = new Map();
const MAX_CACHE_ENTRIES = 500;

function cacheTtlMs() {
  return Math.max(0, (Number(process.env.PLACES_CACHE_TTL) || 3600)) * 1000;
}

function cacheGet(key) {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    responseCache.delete(key);
    return undefined;
  }
  return entry.data;
}

function cacheSet(key, data) {
  const ttl = cacheTtlMs();
  if (ttl === 0) return; // caching disabled
  responseCache.set(key, { data, expires: Date.now() + ttl });
  // Evict oldest entries when the cache is too large.
  if (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    responseCache.delete(oldest);
  }
}

/** Clear the entire response cache (useful after config changes). */
export function clearCache() {
  responseCache.clear();
}

// ── API call stats (lightweight cost awareness) ────────────────────────────────
const stats = { calls: 0, cacheHits: 0, deduped: 0, lastReset: Date.now() };

/** Returns a snapshot of API usage stats since the last reset. */
export function apiStats() {
  return { ...stats, cacheSize: responseCache.size, uptime: Date.now() - stats.lastReset };
}

export function resetStats() {
  Object.assign(stats, { calls: 0, cacheHits: 0, deduped: 0, lastReset: Date.now() });
}

// ── Core fetch wrapper ─────────────────────────────────────────────────────────
export class PlacesError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function rawCall(path, { method = 'GET', body, fieldMask } = {}) {
  if (!placesConfigured()) throw new PlacesError(503, 'GOOGLE_MAPS_API_KEY is not set on the server');

  await acquireToken();
  stats.calls++;

  const res = await fetch(`${BASE()}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': KEY(),
      ...(fieldMask ? { 'x-goog-fieldmask': fieldMask } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PlacesError(res.status, `Google Places: ${data.error?.message || `HTTP ${res.status}`}`);
  return data;
}

/**
 * Cached + deduplicated wrapper around rawCall.
 * cacheKey must be a stable string that uniquely identifies the logical request.
 */
async function call(cacheKey, path, opts) {
  // 1. Check response cache.
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    stats.cacheHits++;
    return cached;
  }
  // 2. Deduplicate: if an identical request is already in flight, piggyback.
  if (inflight.has(cacheKey)) {
    stats.deduped++;
    return inflight.get(cacheKey);
  }
  // 3. Make the real call.
  const promise = rawCall(path, opts).then((data) => {
    cacheSet(cacheKey, data);
    inflight.delete(cacheKey);
    return data;
  }).catch((err) => {
    inflight.delete(cacheKey);
    throw err;
  });
  inflight.set(cacheKey, promise);
  return promise;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * One page of Text Search results (max 20). Pass nextPageToken to continue.
 * Uses the configured field tier to minimise billing cost.
 */
export async function searchText(textQuery, { pageToken, regionCode = 'LK' } = {}) {
  const fields = placeFields();
  const fieldMask = [...fields.map((f) => `places.${f}`), 'nextPageToken'].join(',');
  const body = { textQuery, regionCode, pageSize: 20, ...(pageToken ? { pageToken } : {}) };
  const cacheKey = `searchText|${textQuery}|${regionCode}|${pageToken || ''}|${fieldTier()}`;

  const data = await call(cacheKey, '/places:searchText', { method: 'POST', body, fieldMask });
  return { places: data.places || [], nextPageToken: data.nextPageToken || null };
}

/**
 * Fetch a single place by ID. Cached so repeated lookups (e.g. claiming) don't re-bill.
 */
export async function getPlace(placeId) {
  const fields = placeFields();
  const cacheKey = `getPlace|${placeId}|${fieldTier()}`;
  return call(cacheKey, `/places/${encodeURIComponent(placeId)}`, { fieldMask: fields.join(',') });
}

// ── Photo proxy (unchanged, already has its own cache) ─────────────────────────
const photoCache = new Map(); // `${name}|${w}` -> { uri, expires }
const PHOTO_TTL_MS = 50 * 60 * 1000;

export const isPhotoName = (name) => typeof name === 'string' && /^places\/[\w-]+\/photos\/[\w-]+$/.test(name);

export async function photoUri(name, maxWidthPx = 1200) {
  const cacheKey = `${name}|${maxWidthPx}`;
  const hit = photoCache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.uri;
  // Photo media calls go through rawCall (not cached in responseCache, they have their own).
  const data = await rawCall(`/${name}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`);
  if (!data.photoUri) throw new PlacesError(502, 'Google Places returned no photo URI');
  photoCache.set(cacheKey, { uri: data.photoUri, expires: Date.now() + PHOTO_TTL_MS });
  if (photoCache.size > 2000) photoCache.delete(photoCache.keys().next().value);
  return data.photoUri;
}
