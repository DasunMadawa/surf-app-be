import { Router } from 'express';
import { prisma } from '../db.js';
import { HttpError, bookingRef, isDate, isEmail, isPhone, newId, todayISO } from '../utils.js';
import { dispatch, notifyClub, notifyCustomer } from '../notify.js';
import { chargeOnline } from '../payments.js';

const router = Router();

// Bookings in these states hold seats in a time slot.
export const HOLDING = ['pending', 'confirmed'];

export function publicClub(club) {
  const { apiKey, webhookSecret, webhookUrl, notificationEmail, contact, verification, claimedAt, ...rest } = club;
  return rest;
}

// Listings imported from Google Maps stay visible while unclaimed or under review, but only
// active clubs (which have a notification channel) can take bookings.
const VISIBLE = ['active', 'unclaimed', 'pending_review'];

async function findVisibleClub(idOrSlug) {
  const club = await prisma.club.findFirst({
    where: {
      status: { in: VISIBLE },
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    },
    include: {
      packages: {
        where: { active: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  });
  if (!club) throw new HttpError(404, 'Surf club not found');
  return club;
}

async function findBookableClub(idOrSlug) {
  const club = await findVisibleClub(idOrSlug);
  if (club.status !== 'active') throw new HttpError(409, `${club.name} is not taking online bookings yet`);
  return club;
}

function summary(club) {
  const pkgs = club.packages || [];
  return {
    ...publicClub(club),
    bookable: club.status === 'active',
    packageCount: pkgs.length,
    fromPrice: pkgs.length ? Math.min(...pkgs.map((p) => p.price)) : null,
  };
}

export async function seatsTaken(clubId, date) {
  const bookings = await prisma.booking.findMany({
    where: {
      clubId,
      date,
      status: { in: HOLDING },
    },
  });
  const used = {};
  for (const b of bookings) {
    used[b.slot] = (used[b.slot] || 0) + b.participants;
  }
  return used;
}

router.get('/locations', async (req, res, next) => {
  try {
    const clubs = await prisma.club.findMany({
      where: { status: { in: VISIBLE } },
      select: { location: true },
    });
    const counts = {};
    for (const c of clubs) counts[c.location] = (counts[c.location] || 0) + 1;
    res.json(
      Object.entries(counts)
        .map(([name, clubs]) => ({ name, clubs }))
        .sort((a, b) => b.clubs - a.clubs || a.name.localeCompare(b.name)),
    );
  } catch (err) {
    next(err);
  }
});

router.get('/clubs', async (req, res, next) => {
  try {
    const { location, q } = req.query;
    const where = { status: { in: VISIBLE } };
    if (location && location !== 'All') {
      where.location = { equals: String(location), mode: 'insensitive' };
    }
    if (q) {
      const needle = String(q).trim();
      where.OR = [
        { name: { contains: needle, mode: 'insensitive' } },
        { location: { contains: needle, mode: 'insensitive' } },
        { description: { contains: needle, mode: 'insensitive' } },
      ];
    }
    const list = await prisma.club.findMany({
      where,
      include: {
        packages: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    const rank = (c) => (c.status === 'active' ? 0 : 1);
    list.sort((a, b) => rank(a) - rank(b) || b.rating - a.rating || b.reviewCount - a.reviewCount || a.sortOrder - b.sortOrder);
    res.json(list.map(summary));
  } catch (err) {
    next(err);
  }
});

router.get('/clubs/:id', async (req, res, next) => {
  try {
    const club = await findVisibleClub(req.params.id);
    const reviews = await prisma.review.findMany({
      where: { clubId: club.id },
      orderBy: { date: 'desc' },
    });
    res.json({ ...summary(club), packages: club.packages, reviews });
  } catch (err) {
    next(err);
  }
});

router.get('/clubs/:id/availability', async (req, res, next) => {
  try {
    const club = await findBookableClub(req.params.id);
    const { date } = req.query;
    if (!isDate(date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
    const used = await seatsTaken(club.id, date);
    const closed = date < todayISO();
    const slots = Array.isArray(club.timeSlots) ? club.timeSlots : [];
    res.json({
      date,
      slots: slots.map((slot) => ({
        slot,
        capacity: club.slotCapacity,
        remaining: closed ? 0 : Math.max(0, club.slotCapacity - (used[slot] || 0)),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Per-day load for a month, used to mark "filling up" days on the calendar.
router.get('/clubs/:id/calendar', async (req, res, next) => {
  try {
    const club = await findBookableClub(req.params.id);
    const { month } = req.query;
    if (!/^\d{4}-\d{2}$/.test(month || '')) throw new HttpError(400, 'month must be YYYY-MM');
    const slots = Array.isArray(club.timeSlots) ? club.timeSlots : [];
    const capacity = slots.length * club.slotCapacity;
    const bookings = await prisma.booking.findMany({
      where: {
        clubId: club.id,
        date: { startsWith: month },
        status: { in: HOLDING },
      },
    });
    const days = {};
    for (const b of bookings) {
      days[b.date] = (days[b.date] || 0) + b.participants;
    }
    res.json({ month, capacity, days });
  } catch (err) {
    next(err);
  }
});

router.post('/bookings', async (req, res, next) => {
  try {
    const { clubId, packageId, date, slot, participants, customer = {}, paymentMethod, notes } = req.body || {};
    const club = await findBookableClub(clubId);
    const pkg = await prisma.package.findFirst({
      where: { id: packageId, clubId: club.id, active: true },
    });
    if (!pkg) throw new HttpError(404, 'Package not found');

    const qty = Number(participants);
    const name = String(customer.name || '').trim();
    const email = String(customer.email || '').trim().toLowerCase();
    const phone = String(customer.phone || '').trim();
    const errors = {};
    if (!isDate(date) || date < todayISO()) errors.date = 'Choose today or a future date';
    const slots = Array.isArray(club.timeSlots) ? club.timeSlots : [];
    if (!slots.includes(slot)) errors.slot = 'Choose an available time';
    if (!Number.isInteger(qty) || qty < 1 || qty > pkg.maxParticipants) errors.participants = `Choose 1–${pkg.maxParticipants} participants`;
    if (name.length < 2) errors.name = 'Enter your full name';
    if (!isEmail(email)) errors.email = 'Enter a valid email address';
    if (!isPhone(phone)) errors.phone = 'Enter a valid phone number';
    if (!['online', 'club'].includes(paymentMethod)) errors.paymentMethod = 'Choose a payment method';
    if (Object.keys(errors).length) throw new HttpError(422, 'Please check your booking details', errors);

    let used = await seatsTaken(club.id, date);
    let remaining = club.slotCapacity - (used[slot] || 0);
    if (remaining < qty) {
      throw new HttpError(409, remaining > 0 ? `Only ${remaining} spot${remaining > 1 ? 's' : ''} left at ${slot}` : `${slot} is fully booked`);
    }

    const amount = pkg.price * qty;
    const payment = paymentMethod === 'online' ? await chargeOnline({ amount, currency: 'LKR', email }) : null;
    // Re-check after the await so two simultaneous checkouts cannot oversell the slot.
    used = await seatsTaken(club.id, date);
    if (club.slotCapacity - (used[slot] || 0) < qty) throw new HttpError(409, `${slot} just filled up — pick another time`);

    const now = new Date().toISOString();
    const bookingData = {
      id: newId('bkg'),
      ref: bookingRef(),
      clubId: club.id,
      clubName: club.name,
      packageId: pkg.id,
      packageTitle: pkg.title,
      packageImage: pkg.image,
      date,
      slot,
      participants: qty,
      unitPrice: pkg.price,
      amount,
      currency: 'LKR',
      customer: { name, email, phone, ...(notes ? { notes: String(notes).slice(0, 500) } : {}) },
      paymentMethod,
      paymentStatus: payment ? 'paid' : 'pay_at_club',
      status: 'pending',
      history: [{ status: 'pending', at: now, note: 'Booking placed — club notified' }],
    };
    const booking = await prisma.booking.create({ data: bookingData });

    dispatch(notifyClub(club, 'booking.created', booking));
    dispatch(notifyCustomer(booking, 'received'));
    res.status(201).json(booking);
  } catch (err) {
    next(err);
  }
});

router.get('/bookings', async (req, res, next) => {
  try {
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'A valid email is required');
    const all = await prisma.booking.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const userBookings = all.filter((b) => b.customer && b.customer.email === email);
    res.json(userBookings);
  } catch (err) {
    next(err);
  }
});

router.get('/bookings/:ref', async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { ref: req.params.ref.toUpperCase() },
    });
    if (!booking) throw new HttpError(404, 'Booking not found');
    res.json(booking);
  } catch (err) {
    next(err);
  }
});

router.post('/bookings/:ref/cancel', async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { ref: req.params.ref.toUpperCase() },
    });
    if (!booking) throw new HttpError(404, 'Booking not found');
    if (String(req.body?.email || '').toLowerCase() !== booking.customer?.email) throw new HttpError(403, 'Email does not match this booking');
    if (!HOLDING.includes(booking.status)) throw new HttpError(409, `A ${booking.status} booking cannot be cancelled`);

    const now = new Date().toISOString();
    const history = Array.isArray(booking.history) ? [...booking.history] : [];
    history.push({ status: 'cancelled', at: now, note: 'Cancelled by customer' });

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: 'cancelled',
        history,
      },
    });

    const club = await prisma.club.findUnique({ where: { id: booking.clubId } });
    if (club) dispatch(notifyClub(club, 'booking.cancelled', updated));
    dispatch(notifyCustomer(updated, 'cancelled'));
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
