import { Router } from 'express';
import { prisma } from '../db.js';
import { HttpError, isEmail, isPhone, isSlot, isUrl, newId } from '../utils.js';
import { dispatch, notifyClub, notifyCustomer, subscribe } from '../notify.js';
import { claimClub, normalizePackage, registerClub, validatePackageInput } from '../onboarding.js';
import { SERVICES } from '../catalog.js';
import { ADMIN_KEY } from './admin.js';

const router = Router();

function privateClub(club) {
  const { apiKey, ...rest } = club;
  return rest;
}

async function requireClub(req, res, next) {
  // EventSource cannot send headers, so the live stream accepts ?key= as well.
  const key = req.get('x-api-key') || (req.path === '/stream' ? req.query.key : undefined);
  if (!key) return next(new HttpError(401, 'Invalid or missing API key'));
  const club = await prisma.club.findUnique({ where: { apiKey: key } });
  if (!club) return next(new HttpError(401, 'Invalid or missing API key'));
  req.club = club;
  next();
}

// ---------- Onboarding ----------

router.post('/partners/register', async (req, res, next) => {
  try {
    const { club, packages } = await registerClub(req.body, { source: 'self-service' });
    res.status(201).json({ club: privateClub(club), packages, apiKey: club.apiKey, webhookSecret: club.webhookSecret });
  } catch (err) {
    next(err);
  }
});

// Listings imported from Google Maps that an owner can take over.
router.get('/partners/claimable', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const clubs = await prisma.club.findMany({
      where: {
        status: 'unclaimed',
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { location: { contains: q, mode: 'insensitive' } },
          { address: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 10,
    });
    res.json(
      clubs.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        location: c.location,
        address: c.address,
        rating: c.rating,
        reviewCount: c.reviewCount,
        website: c.website,
        phone: c.phone,
        image: (Array.isArray(c.images) && c.images[0]) || null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post('/partners/claim', async (req, res, next) => {
  try {
    const { clubId, ...input } = req.body || {};
    const { club, packages, autoVerified } = await claimClub(clubId, input);
    res.status(201).json({ club: privateClub(club), packages, autoVerified, apiKey: club.apiKey, webhookSecret: club.webhookSecret });
  } catch (err) {
    next(err);
  }
});

// Bulk registration for directory imports / partner networks.
router.post('/partners/import', async (req, res, next) => {
  try {
    if (req.get('x-admin-key') !== ADMIN_KEY()) throw new HttpError(401, 'Invalid admin key');
    const items = req.body?.clubs;
    if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Send { "clubs": [ ... ] }');
    const results = [];
    for (const input of items) {
      try {
        const { club, packages } = await registerClub(input, { source: 'import' });
        results.push({ ok: true, id: club.id, slug: club.slug, apiKey: club.apiKey, webhookSecret: club.webhookSecret, packages: packages.length });
      } catch (err) {
        results.push({ ok: false, name: input?.name ?? null, error: err.message, details: err.details });
      }
    }
    res.status(207).json({ registered: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
  } catch (err) {
    next(err);
  }
});

// ---------- Club account ----------

router.use('/partner', requireClub);

router.get('/partner/me', (req, res) => res.json(privateClub(req.club)));

router.patch('/partner/me', async (req, res, next) => {
  try {
    const b = req.body || {};
    const c = req.club;
    const errors = {};
    if (b.webhookUrl && !isUrl(b.webhookUrl)) errors.webhookUrl = 'Must start with http:// or https://';
    if (b.notificationEmail !== undefined && !isEmail(b.notificationEmail)) errors.notificationEmail = 'Enter a valid email';
    if (b.phone !== undefined && !isPhone(b.phone)) errors.phone = 'Enter a valid phone number';
    if (b.timeSlots !== undefined && (!Array.isArray(b.timeSlots) || !b.timeSlots.length || !b.timeSlots.every(isSlot))) {
      errors.timeSlots = 'Use the format "06:00 - 08:00"';
    }
    if (b.slotCapacity !== undefined && !(Number.isInteger(Number(b.slotCapacity)) && Number(b.slotCapacity) >= 1)) {
      errors.slotCapacity = 'Must be at least 1';
    }
    if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields', errors);

    const data = {};
    for (const k of ['name', 'description', 'address']) if (typeof b[k] === 'string' && b[k].trim()) data[k] = b[k].trim();
    if (b.phone !== undefined) {
      data.phone = b.phone.trim();
      data.contact = { ...(c.contact || {}), phone: b.phone.trim() };
    }
    if (b.notificationEmail !== undefined) data.notificationEmail = b.notificationEmail.trim().toLowerCase();
    if (b.webhookUrl !== undefined) data.webhookUrl = b.webhookUrl ? b.webhookUrl.trim() : null;
    if (b.timeSlots !== undefined) data.timeSlots = b.timeSlots;
    if (b.slotCapacity !== undefined) data.slotCapacity = Number(b.slotCapacity);
    if (Array.isArray(b.services)) data.services = b.services.filter((s) => SERVICES.includes(s));
    if (Array.isArray(b.images)) data.images = b.images.filter(isUrl).slice(0, 12);

    const updated = await prisma.club.update({
      where: { id: c.id },
      data,
    });
    res.json(privateClub(updated));
  } catch (err) {
    next(err);
  }
});

router.post('/partner/webhook/test', async (req, res, next) => {
  try {
    if (!req.club.webhookUrl) throw new HttpError(400, 'Add a webhook URL first');
    await notifyClub(req.club, 'webhook.test', { message: 'Hello from Stara 👋' }, { channels: ['webhook'] });
    const last = await prisma.notification.findFirst({
      where: { clubId: req.club.id, channel: 'webhook' },
      orderBy: { createdAt: 'desc' },
    });
    res.json(last);
  } catch (err) {
    next(err);
  }
});

// ---------- Live notifications (Server-Sent Events) ----------

router.get('/partner/stream', (req, res) => {
  res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: ready\ndata: ${JSON.stringify({ clubId: req.club.id })}\n\n`);
  const unsubscribe = subscribe(req.club.id, res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

router.get('/partner/notifications', async (req, res, next) => {
  try {
    const list = await prisma.notification.findMany({
      where: { clubId: req.club.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// ---------- Packages ----------

router.get('/partner/packages', async (req, res, next) => {
  try {
    const pkgs = await prisma.package.findMany({
      where: { clubId: req.club.id },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(pkgs);
  } catch (err) {
    next(err);
  }
});

router.post('/partner/packages', async (req, res, next) => {
  try {
    const errors = validatePackageInput(req.body || {});
    if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields', errors);
    const count = await prisma.package.count({ where: { clubId: req.club.id } });
    const clubImages = Array.isArray(req.club.images) ? req.club.images : [];
    const pkg = {
      id: newId('pkg'),
      clubId: req.club.id,
      active: true,
      sortOrder: count,
      ...normalizePackage(req.body, {
        subtitle: '',
        highlights: [],
        originalPrice: null,
        image: clubImages[0],
        popular: false,
        sessions: 1,
        maxParticipants: 6,
      }),
    };
    const created = await prisma.package.create({ data: pkg });
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.patch('/partner/packages/:id', async (req, res, next) => {
  try {
    const pkg = await prisma.package.findFirst({ where: { id: req.params.id, clubId: req.club.id } });
    if (!pkg) throw new HttpError(404, 'Package not found');
    const errors = validatePackageInput({ ...req.body, price: req.body?.price ?? pkg.price }, { partial: true });
    if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields', errors);
    const updated = await prisma.package.update({
      where: { id: pkg.id },
      data: normalizePackage(req.body || {}, {}),
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/partner/packages/:id', async (req, res, next) => {
  try {
    const pkg = await prisma.package.findFirst({ where: { id: req.params.id, clubId: req.club.id } });
    if (!pkg) throw new HttpError(404, 'Package not found');
    const bookingCount = await prisma.booking.count({ where: { packageId: pkg.id } });
    if (bookingCount > 0) {
      await prisma.package.update({ where: { id: pkg.id }, data: { active: false } });
    } else {
      await prisma.package.delete({ where: { id: pkg.id } });
    }
    res.json({ ok: true, archived: bookingCount > 0 });
  } catch (err) {
    next(err);
  }
});

// ---------- Bookings ----------

router.get('/partner/bookings', async (req, res, next) => {
  try {
    const where = { clubId: req.club.id };
    if (req.query.status) where.status = String(req.query.status);
    const list = await prisma.booking.findMany({
      where,
      orderBy: [{ date: 'asc' }, { slot: 'asc' }],
    });
    res.json(list);
  } catch (err) {
    next(err);
  }
});

const TRANSITIONS = {
  pending: ['confirmed', 'declined'],
  confirmed: ['completed', 'cancelled'],
};

router.patch('/partner/bookings/:id', async (req, res, next) => {
  try {
    const booking = await prisma.booking.findFirst({ where: { id: req.params.id, clubId: req.club.id } });
    if (!booking) throw new HttpError(404, 'Booking not found');
    const { status, note } = req.body || {};
    if (!TRANSITIONS[booking.status]?.includes(status)) {
      throw new HttpError(409, `Cannot change a ${booking.status} booking to ${status}`);
    }
    const now = new Date().toISOString();
    let paymentStatus = booking.paymentStatus;
    if (status === 'declined' && booking.paymentStatus === 'paid') paymentStatus = 'refunded';
    const history = Array.isArray(booking.history) ? [...booking.history] : [];
    history.push({ status, at: now, note: note ? String(note).slice(0, 300) : `Marked ${status} by ${req.club.name}` });
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status,
        paymentStatus,
        history,
      },
    });
    dispatch(notifyCustomer(updated, status));
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
