import { prisma } from './db.js';
import { DEFAULT_SLOTS, FEATURES, IMAGES, KNOWN_LOCATIONS, SERVICES, starterPackages } from './catalog.js';
import { HttpError, isEmail, isPhone, isSlot, isUrl, newId, newSecret, slugify } from './utils.js';
import { dispatch, notifyClub } from './notify.js';

// Automatic onboarding: a club submits its details (from the partner sign-up page,
// or in bulk through the import API) and is verified, given credentials, starter
// packages and map coordinates, and listed — without manual review.

const str = (v) => (typeof v === 'string' ? v.trim() : '');

export function validatePackageInput(p, { partial = false } = {}) {
  const errors = {};
  if (!partial || p.title !== undefined) {
    if (str(p.title).length < 3) errors.title = 'Title must be at least 3 characters';
  }
  if (!partial || p.price !== undefined) {
    if (!Number.isFinite(Number(p.price)) || Number(p.price) <= 0) errors.price = 'Price must be a positive number';
  }
  if (p.originalPrice != null && p.originalPrice !== '' && !(Number(p.originalPrice) > Number(p.price ?? 0))) {
    errors.originalPrice = 'Original price must be higher than the price';
  }
  if (p.maxParticipants !== undefined && !(Number.isInteger(Number(p.maxParticipants)) && Number(p.maxParticipants) >= 1)) {
    errors.maxParticipants = 'Must be a whole number of at least 1';
  }
  return errors;
}

export function normalizePackage(p, defaults = {}) {
  const out = { ...defaults };
  if (p.title !== undefined) out.title = str(p.title);
  if (p.subtitle !== undefined) out.subtitle = str(p.subtitle);
  if (p.price !== undefined) out.price = Math.round(Number(p.price));
  if (p.originalPrice !== undefined) out.originalPrice = p.originalPrice ? Math.round(Number(p.originalPrice)) : null;
  if (p.maxParticipants !== undefined) out.maxParticipants = Number(p.maxParticipants);
  if (p.sessions !== undefined) out.sessions = Math.max(1, Number(p.sessions) || 1);
  if (p.popular !== undefined) out.popular = Boolean(p.popular);
  if (p.active !== undefined) out.active = Boolean(p.active);
  if (p.image !== undefined) out.image = isUrl(p.image) ? p.image : defaults.image ?? IMAGES.surfer;
  if (Array.isArray(p.highlights)) {
    out.highlights = p.highlights
      .map((h) => (typeof h === 'string' ? { icon: 'check', text: str(h) } : { icon: str(h.icon) || 'check', text: str(h.text) }))
      .filter((h) => h.text)
      .slice(0, 4);
  }
  return out;
}

function validateClubInput(input) {
  const errors = {};
  if (str(input.name).length < 3) errors.name = 'Club name must be at least 3 characters';
  if (str(input.location).length < 2) errors.location = 'Location is required';
  if (!isEmail(input.email)) errors.email = 'A valid email is required';
  if (!isPhone(input.phone)) errors.phone = 'A valid phone number is required';
  if (input.webhookUrl && !isUrl(input.webhookUrl)) errors.webhookUrl = 'Webhook URL must start with http:// or https://';
  if (input.timeSlots !== undefined && (!Array.isArray(input.timeSlots) || !input.timeSlots.every(isSlot))) {
    errors.timeSlots = 'Time slots must look like "06:00 - 08:00"';
  }
  if (Array.isArray(input.packages)) {
    input.packages.forEach((p, i) => {
      const e = validatePackageInput(p);
      if (Object.keys(e).length) errors[`packages[${i}]`] = e;
    });
  }
  return errors;
}

async function uniqueSlug(name, location) {
  let slug = slugify(name);
  const existing = await prisma.club.findUnique({ where: { slug } });
  if (!existing) return slug;
  slug = slugify(`${name} ${location}`);
  const base = slug;
  for (let n = 2; ; n++) {
    const s = `${base}-${n}`;
    const taken = await prisma.club.findUnique({ where: { slug: s } });
    if (!taken) return s;
  }
}

export async function registerClub(input = {}, { source = 'self-service' } = {}) {
  const errors = validateClubInput(input);
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields', errors);

  const name = str(input.name);
  const location = str(input.location).replace(/\b\w/g, (c) => c.toUpperCase());
  const email = str(input.email).toLowerCase();

  const allClubs = await prisma.club.findMany();
  const duplicate = allClubs.find(
    (c) => (c.contact && c.contact.email === email) || (c.name.toLowerCase() === name.toLowerCase() && c.location.toLowerCase() === location.toLowerCase()),
  );
  if (duplicate?.status === 'unclaimed') {
    throw new HttpError(409, `${duplicate.name} is already listed from Google Maps — claim that listing instead.`, { claimClubId: duplicate.id });
  }
  if (duplicate) throw new HttpError(409, `${duplicate.name} is already registered. Log in with its API key instead.`);

  const coords =
    Number.isFinite(Number(input.lat)) && Number.isFinite(Number(input.lng)) && input.lat !== '' && input.lng !== ''
      ? { lat: Number(input.lat), lng: Number(input.lng) }
      : KNOWN_LOCATIONS[location.toLowerCase()] ?? null;

  const now = new Date().toISOString();
  const services = Array.isArray(input.services) ? input.services.filter((s) => SERVICES.includes(s)) : [];
  const images = (Array.isArray(input.images) ? input.images.filter(isUrl) : []).slice(0, 12);
  const slug = await uniqueSlug(name, location);

  const club = {
    id: newId('club'),
    slug,
    name,
    location,
    country: str(input.country) || 'Sri Lanka',
    address: str(input.address) || `${location}, ${str(input.country) || 'Sri Lanka'}`,
    description:
      str(input.description) ||
      `${name} offers surf lessons and board rentals in ${location}. Friendly instructors, quality equipment and sessions for every level.`,
    images: images.length ? images : [IMAGES.boardRack, IMAGES.tropicalBeach, IMAGES.surfer],
    services: services.length ? services : ['Lessons', 'Board Rental'],
    features: FEATURES,
    badge: 'New',
    rating: 0,
    reviewCount: 0,
    coordinates: coords,
    timeSlots: input.timeSlots?.length ? input.timeSlots : DEFAULT_SLOTS,
    slotCapacity: Math.max(1, Number(input.slotCapacity) || 10),
    phone: str(input.phone),
    contact: { email, phone: str(input.phone) },
    notificationEmail: email,
    webhookUrl: str(input.webhookUrl) || null,
    webhookSecret: newSecret('whsec'),
    apiKey: newSecret('sk_live'),
    status: 'active',
    verification: {
      method: 'auto',
      verifiedAt: now,
      checks: ['email-format', 'phone-format', 'duplicate-listing', coords ? 'geo-located' : 'geo-pending'],
    },
    source,
    createdAt: new Date(),
    sortOrder: allClubs.length,
  };

  const templates = Array.isArray(input.packages) && input.packages.length ? input.packages : starterPackages();
  const packages = templates.map((p, i) => ({
    id: newId('pkg'),
    clubId: club.id,
    active: true,
    sortOrder: i,
    createdAt: new Date(),
    ...normalizePackage(p, { subtitle: '', highlights: [], originalPrice: null, image: IMAGES.surfer, popular: false, sessions: 1, maxParticipants: 6 }),
  }));

  const createdClub = await prisma.club.create({ data: club });
  if (packages.length) {
    await prisma.package.createMany({ data: packages });
  }

  dispatch(notifyClub(createdClub, 'club.activated', { clubId: createdClub.id, slug: createdClub.slug, apiKeyHint: `${createdClub.apiKey.slice(0, 12)}…` }));
  return { club: createdClub, packages };
}

// ---------- Claiming a listing imported from Google Places ----------

const FREE_MAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|aol|proton|protonmail|gmx|yandex|zoho)\./;

function siteDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

// Auto-verify when the claimant's email is on the same domain as the website Google lists
// for the place (e.g. info@sunrisesurf.lk for sunrisesurf.lk). Anything else waits for an admin.
function emailMatchesWebsite(email, website) {
  const site = siteDomain(website);
  const domain = email.split('@')[1]?.toLowerCase();
  if (!site || !domain || FREE_MAIL.test(domain)) return false;
  return domain === site || site.endsWith(`.${domain}`) || domain.endsWith(`.${site}`);
}

export async function claimClub(clubId, input = {}) {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) throw new HttpError(404, 'Listing not found');
  if (club.status !== 'unclaimed') throw new HttpError(409, `${club.name} has already been claimed.`);

  const errors = {};
  if (!isEmail(input.email)) errors.email = 'A valid email is required';
  if (!isPhone(input.phone)) errors.phone = 'A valid phone number is required';
  if (input.webhookUrl && !isUrl(input.webhookUrl)) errors.webhookUrl = 'Webhook URL must start with http:// or https://';
  if (input.timeSlots !== undefined && (!Array.isArray(input.timeSlots) || !input.timeSlots.length || !input.timeSlots.every(isSlot))) {
    errors.timeSlots = 'Time slots must look like "06:00 - 08:00"';
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'Please fix the highlighted fields', errors);

  const email = str(input.email).toLowerCase();
  const allClubs = await prisma.club.findMany();
  if (allClubs.some((c) => c.id !== club.id && (c.notificationEmail === email || c.contact?.email === email))) {
    throw new HttpError(409, 'That email already manages another club. Use a different email.');
  }

  const now = new Date().toISOString();
  const autoVerified = emailMatchesWebsite(email, club.website);
  const services = Array.isArray(input.services) ? input.services.filter((s) => SERVICES.includes(s)) : [];

  const updatedClub = await prisma.club.update({
    where: { id: club.id },
    data: {
      phone: str(input.phone),
      contact: { email, phone: str(input.phone) },
      notificationEmail: email,
      webhookUrl: str(input.webhookUrl) || null,
      webhookSecret: newSecret('whsec'),
      apiKey: newSecret('sk_live'),
      timeSlots: input.timeSlots?.length ? input.timeSlots : club.timeSlots,
      slotCapacity: Math.max(1, Number(input.slotCapacity) || club.slotCapacity),
      services: services.length ? services : club.services,
      status: autoVerified ? 'active' : 'pending_review',
      claimedAt: new Date(),
      verification: autoVerified
        ? { method: 'email-domain', verifiedAt: now, checks: ['email-matches-google-website'] }
        : { method: 'manual', requestedAt: now, checks: ['awaiting-admin-review'] },
    },
  });

  let packages = await prisma.package.findMany({ where: { clubId: club.id } });
  if (!packages.length) {
    const clubImages = Array.isArray(club.images) ? club.images : [];
    const pkgsToCreate = starterPackages().map((p, i) => ({
      id: newId('pkg'),
      clubId: club.id,
      active: true,
      sortOrder: i,
      createdAt: new Date(),
      ...p,
      image: clubImages[i % Math.max(1, clubImages.length)] || p.image,
    }));
    await prisma.package.createMany({ data: pkgsToCreate });
    packages = pkgsToCreate;
  }

  if (autoVerified) dispatch(notifyClub(updatedClub, 'club.activated', { clubId: updatedClub.id, slug: updatedClub.slug, apiKeyHint: `${updatedClub.apiKey.slice(0, 12)}…` }));
  return { club: updatedClub, packages, autoVerified };
}

export async function approveClaim(clubId) {
  const club = await prisma.club.findUnique({ where: { id: clubId } });
  if (!club) throw new HttpError(404, 'Club not found');
  if (club.status !== 'pending_review') throw new HttpError(409, `${club.name} is ${club.status}, not waiting for review`);
  
  const updatedClub = await prisma.club.update({
    where: { id: club.id },
    data: {
      status: 'active',
      verification: { ...(club.verification || {}), method: 'manual', verifiedAt: new Date().toISOString() },
    },
  });
  dispatch(notifyClub(updatedClub, 'club.activated', { clubId: updatedClub.id, slug: updatedClub.slug, apiKeyHint: `${updatedClub.apiKey.slice(0, 12)}…` }));
  return updatedClub;
}

