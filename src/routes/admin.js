import { Router } from 'express';
import { prisma } from '../db.js';
import { HttpError, newSecret } from '../utils.js';
import { DEFAULT_TOWNS, importFromPlaces } from '../discovery.js';
import { approveClaim } from '../onboarding.js';
import { isPhotoName, photoUri, placesConfigured, apiStats, clearCache } from '../places.js';

const router = Router();

export const ADMIN_KEY = () => process.env.ADMIN_KEY || 'admin_demo_key';

function requireAdmin(req, res, next) {
  if (req.get('x-admin-key') !== ADMIN_KEY()) return next(new HttpError(401, 'Invalid admin key'));
  next();
}

// Public: proxies Google place photos so the API key stays on the server.
router.get('/media/place-photo', async (req, res, next) => {
  try {
    const { name } = req.query;
    if (!isPhotoName(name)) throw new HttpError(400, 'Invalid photo name');
    const width = Math.min(1600, Math.max(100, Number(req.query.w) || 1200));
    const uri = await photoUri(name, width);
    res.set('cache-control', 'public, max-age=1800').redirect(302, uri);
  } catch (err) {
    next(err);
  }
});

router.use('/admin', requireAdmin);

router.get('/admin/places/status', async (req, res, next) => {
  try {
    const fromGoogle = await prisma.club.findMany({ where: { source: 'google-places' } });
    res.json({
      configured: placesConfigured(),
      defaultTowns: DEFAULT_TOWNS,
      imported: fromGoogle.length,
      unclaimed: fromGoogle.filter((c) => c.status === 'unclaimed').length,
      lastSync: fromGoogle.map((c) => c.placesSyncedAt).filter(Boolean).sort().at(-1) || null,
    });
  } catch (err) {
    next(err);
  }
});

// API usage stats — monitor cost and cache effectiveness.
router.get('/admin/places/stats', (req, res) => {
  const s = apiStats();
  const total = s.calls + s.cacheHits + s.deduped;
  res.json({
    ...s,
    totalRequests: total,
    cacheHitRate: total > 0 ? `${((s.cacheHits / total) * 100).toFixed(1)}%` : '0%',
    savedCalls: s.cacheHits + s.deduped,
    fieldTier: process.env.PLACES_FIELD_TIER || 'full',
    rateLimit: Number(process.env.PLACES_RATE_LIMIT) || 30,
    cacheTtl: Number(process.env.PLACES_CACHE_TTL) || 3600,
  });
});

// Flush the response cache (e.g. after changing PLACES_FIELD_TIER).
router.post('/admin/places/cache/clear', (req, res) => {
  clearCache();
  res.json({ ok: true, message: 'Places response cache cleared' });
});

// Body: { towns?: string[], strict?: boolean, maxPagesPerQuery?: 1-3 }
router.post('/admin/places/import', async (req, res, next) => {
  try {
    const { towns, strict = true, maxPagesPerQuery = 1 } = req.body || {};
    if (towns !== undefined && (!Array.isArray(towns) || !towns.every((t) => typeof t === 'string' && t.trim()))) {
      throw new HttpError(400, 'towns must be an array of town names');
    }
    const summary = await importFromPlaces({
      towns: towns?.map((t) => t.trim()),
      strict: Boolean(strict),
      maxPagesPerQuery: Math.min(3, Math.max(1, Number(maxPagesPerQuery) || 1)),
    });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Club portal: every club with its API key (the club's portal password).
const adminClub = (c) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  location: c.location,
  status: c.status,
  image: (Array.isArray(c.images) && c.images[0]) || null,
  apiKey: c.apiKey,
});

router.get('/admin/clubs', async (req, res, next) => {
  try {
    const clubs = await prisma.club.findMany({ orderBy: [{ name: 'asc' }] });
    res.json(clubs.map(adminClub));
  } catch (err) {
    next(err);
  }
});

// Issues a new API key for a club, replacing any existing one.
router.post('/admin/clubs/:id/api-key', async (req, res, next) => {
  try {
    const club = await prisma.club.findUnique({ where: { id: req.params.id } });
    if (!club) throw new HttpError(404, 'Surf club not found');
    const updated = await prisma.club.update({ where: { id: club.id }, data: { apiKey: newSecret('sk_live') } });
    res.json(adminClub(updated));
  } catch (err) {
    next(err);
  }
});

router.get('/admin/claims', async (req, res, next) => {
  try {
    const pending = await prisma.club.findMany({ where: { status: 'pending_review' } });
    res.json(
      pending.map((c) => ({
        id: c.id,
        name: c.name,
        location: c.location,
        website: c.website,
        email: c.contact?.email || c.notificationEmail,
        phone: c.phone,
        claimedAt: c.claimedAt,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post('/admin/claims/:id/approve', async (req, res, next) => {
  try {
    const club = await approveClaim(req.params.id);
    res.json({ id: club.id, name: club.name, status: club.status });
  } catch (err) {
    next(err);
  }
});

export default router;
