import { prisma } from './db.js';
import { DEFAULT_SLOTS, FEATURES, KNOWN_LOCATIONS } from './catalog.js';
import { searchText } from './places.js';
import { newId, slugify } from './utils.js';

// Automatic discovery: pull real surf schools/camps from Google Places and list them as
// "unclaimed". They show real details but cannot take bookings until the owner claims
// the listing (see claimClub in onboarding.js), because there is no channel to notify them.

export const DEFAULT_TOWNS = Object.keys(KNOWN_LOCATIONS).map((t) => t.replace(/\b\w/g, (c) => c.toUpperCase()));
const QUERIES = ['surf school in {town}, Sri Lanka', 'surf camp in {town}, Sri Lanka'];

const photoUrl = (name) => `/api/media/place-photo?name=${encodeURIComponent(name)}`;

function inferServices(place) {
  const text = `${place.displayName?.text || ''} ${(place.types || []).join(' ')}`.toLowerCase();
  const services = ['Lessons'];
  if (/rent|rental|shop|store/.test(text)) services.push('Board Rental');
  if (/trip|tour|safari/.test(text)) services.push('Surf Trips');
  if (/cafe|coffee|restaurant|food/.test(text)) services.push('Cafe');
  if (/yoga/.test(text)) services.push('Yoga');
  if (/camp|lodging|hotel|hostel|guest|villa|resort|stay/.test(text)) services.push('Accommodation');
  return services;
}

function townFor(place, searchedTown) {
  // Prefer the known surf town that actually appears in the address.
  const address = (place.formattedAddress || '').toLowerCase();
  const match = DEFAULT_TOWNS.find((t) => address.includes(t.toLowerCase()));
  return match || searchedTown;
}

async function uniqueSlug(name, location) {
  let slug = slugify(name) || 'surf-club';
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

// Fields refreshed from Google on every import.
function googleFields(place, town) {
  const photos = (place.photos || []).slice(0, 8);
  return {
    googlePlaceId: place.id,
    googleMapsUri: place.googleMapsUri || null,
    website: place.websiteUri || null,
    address: place.formattedAddress || town,
    coordinates: place.location ? { lat: place.location.latitude, lng: place.location.longitude } : null,
    rating: place.rating ?? 0,
    reviewCount: place.userRatingCount ?? 0,
    images: photos.map((p) => photoUrl(p.name)),
    photoAttributions: photos.map((p) => (p.authorAttributions || []).map((a) => ({ name: a.displayName, uri: a.uri }))),
    placesSyncedAt: new Date(),
  };
}

async function syncReviews(clubId, place) {
  await prisma.review.deleteMany({
    where: { clubId, source: 'google' },
  });
  const reviewsToCreate = [];
  for (const r of place.reviews || []) {
    if (!r.text?.text) continue;
    reviewsToCreate.push({
      id: newId('rev'),
      clubId,
      source: 'google',
      name: r.authorAttribution?.displayName || 'Google user',
      authorUri: r.authorAttribution?.uri || null,
      country: r.relativePublishTimeDescription || 'Google review',
      rating: r.rating ?? 0,
      comment: r.text.text,
      date: (r.publishTime || new Date().toISOString()).slice(0, 10),
    });
  }
  if (reviewsToCreate.length) {
    await prisma.review.createMany({ data: reviewsToCreate });
  }
}

export async function upsertPlace(place, searchedTown) {
  const town = townFor(place, searchedTown);
  const existing = await prisma.club.findUnique({ where: { googlePlaceId: place.id } });

  if (existing) {
    const fresh = googleFields(place, town);
    const updateData = {};
    if (existing.status !== 'unclaimed') {
      Object.assign(updateData, {
        rating: fresh.rating,
        reviewCount: fresh.reviewCount,
        googleMapsUri: fresh.googleMapsUri,
        placesSyncedAt: fresh.placesSyncedAt,
      });
      if (!existing.images || (Array.isArray(existing.images) && !existing.images.length)) {
        Object.assign(updateData, { images: fresh.images, photoAttributions: fresh.photoAttributions });
      }
    } else {
      Object.assign(updateData, fresh, { phone: place.internationalPhoneNumber || place.nationalPhoneNumber || existing.phone });
    }
    const updated = await prisma.club.update({
      where: { id: existing.id },
      data: updateData,
    });
    await syncReviews(existing.id, place);
    return { club: updated, created: false };
  }

  const name = place.displayName?.text || 'Surf club';
  const phone = place.internationalPhoneNumber || place.nationalPhoneNumber || null;
  const count = await prisma.club.count();
  const slug = await uniqueSlug(name, town);
  const clubData = {
    id: newId('club'),
    slug,
    name,
    location: town,
    country: 'Sri Lanka',
    description:
      place.editorialSummary?.text ||
      `${name} is a surf spot in ${town}, Sri Lanka. Details and photos come from Google Maps. Online booking opens once the owner claims this listing.`,
    services: inferServices(place),
    features: FEATURES,
    badge: null,
    timeSlots: DEFAULT_SLOTS,
    slotCapacity: 10,
    phone,
    contact: { email: null, phone },
    notificationEmail: null,
    webhookUrl: null,
    webhookSecret: null,
    apiKey: null,
    status: 'unclaimed',
    source: 'google-places',
    sortOrder: count,
    ...googleFields(place, town),
  };
  const createdClub = await prisma.club.create({ data: clubData });
  await syncReviews(createdClub.id, place);
  return { club: createdClub, created: true };
}

const looksLikeSurf = (place) => /surf/i.test(place.displayName?.text || '');

/**
 * Search Google Places for surf schools/camps in each town and upsert them.
 * strict=true keeps only places with "surf" in their name (text search also returns nearby hotels).
 */
export async function importFromPlaces({ towns = DEFAULT_TOWNS, strict = true, maxPagesPerQuery = 1, log = () => {} } = {}) {
  const seen = new Set();
  const summary = { created: 0, updated: 0, skipped: 0, towns: {}, errors: [] };

  for (const town of towns) {
    summary.towns[town] = 0;
    for (const template of QUERIES) {
      const query = template.replace('{town}', town);
      let pageToken = null;
      for (let page = 0; page < maxPagesPerQuery; page++) {
        let result;
        try {
          result = await searchText(query, { pageToken });
        } catch (err) {
          summary.errors.push(`${query}: ${err.message}`);
          if (err.status === 503 || err.status === 403 || err.status === 401) throw err;
          break;
        }
        for (const place of result.places) {
          if (seen.has(place.id)) continue;
          seen.add(place.id);
          if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') {
            summary.skipped++;
            continue;
          }
          if (strict && !looksLikeSurf(place)) {
            summary.skipped++;
            continue;
          }
          const { club, created } = await upsertPlace(place, town);
          summary[created ? 'created' : 'updated']++;
          summary.towns[town]++;
          log(`${created ? '+' : '~'} ${club.name} (${club.location})`);
        }
        pageToken = result.nextPageToken;
        if (!pageToken) break;
      }
    }
  }
  return summary;
}

