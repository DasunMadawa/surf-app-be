import { IMAGES, DEFAULT_SLOTS, FEATURES, KNOWN_LOCATIONS, starterPackages } from './catalog.js';
import { addDays, todayISO } from './utils.js';
import { prisma } from './db.js';

// Demo API keys are fixed so the partner dashboard can be tried right away.
const CLUBS = [
  {
    id: 'club_stara',
    slug: 'stara-surf-club',
    name: 'Stara Surf Club',
    location: 'Weligama',
    address: 'Beach Road, Weligama 81700',
    description:
      'Stara Surf Club offers professional surf lessons, board rentals and an amazing beach community in the heart of Weligama. Perfect for beginners to advanced surfers. Our ISA-certified instructors keep groups small, so every surfer gets real coaching in the water, and our beach café is the best place to swap wave stories after a session.',
    images: [IMAGES.boardRack, IMAGES.barrel, IMAGES.tropicalBeach, IMAGES.surfer, IMAGES.sunsetWalk],
    services: ['Lessons', 'Board Rental', 'Surf Trips'],
    badge: 'Best Rated',
    rating: 4.9,
    reviewCount: 128,
    phone: '+94 77 123 4567',
    email: 'hello@starasurf.lk',
    apiKey: 'sk_demo_stara',
  },
  {
    id: 'club_oceanvibes',
    slug: 'ocean-vibes-surf-club',
    name: 'Ocean Vibes Surf Club',
    location: 'Midigama',
    address: 'Galle Road, Midigama',
    description:
      'A laid-back surf house right on the Midigama point. Ocean Vibes runs relaxed lessons for first-timers, guided sessions for intermediates and has a café serving the best smoothie bowls on the south coast.',
    images: [IMAGES.palms, IMAGES.action, IMAGES.beach, IMAGES.wave],
    services: ['Lessons', 'Board Rental', 'Cafe'],
    badge: null,
    rating: 4.8,
    reviewCount: 96,
    phone: '+94 77 555 0192',
    email: 'surf@oceanvibes.lk',
    apiKey: 'sk_demo_oceanvibes',
  },
  {
    id: 'club_lazywave',
    slug: 'lazy-wave-surf-club',
    name: 'Lazy Wave Surf Club',
    location: 'Weligama',
    address: 'Mirissa Road, Weligama',
    description:
      'Lazy Wave is a family-run surf school on the gentle beach break of Weligama bay — the perfect place to stand up for the first time. Sunset yoga sessions every evening.',
    images: [IMAGES.tropicalBeach, IMAGES.sunsetSurf, IMAGES.boardOnSand],
    services: ['Lessons', 'Board Rental', 'Yoga'],
    badge: null,
    rating: 4.7,
    reviewCount: 84,
    phone: '+94 71 444 8811',
    email: 'hi@lazywave.lk',
    apiKey: 'sk_demo_lazywave',
  },
  {
    id: 'club_mirissapoint',
    slug: 'mirissa-point-surf-co',
    name: 'Mirissa Point Surf Co.',
    location: 'Mirissa',
    address: 'Mirissa Beach, Mirissa',
    description:
      'Reef and point breaks for progressing surfers, plus boat surf trips to secret spots along the coast. Stay in our beachfront rooms and surf from the doorstep.',
    images: [IMAGES.wave, IMAGES.villa, IMAGES.aerial],
    services: ['Lessons', 'Surf Trips', 'Accommodation'],
    badge: null,
    rating: 4.6,
    reviewCount: 57,
    phone: '+94 76 222 3344',
    email: 'crew@mirissapoint.lk',
    apiKey: 'sk_demo_mirissapoint',
  },
  {
    id: 'club_hiriketiya',
    slug: 'hiriketiya-bay-surf-school',
    name: 'Hiriketiya Bay Surf School',
    location: 'Hiriketiya',
    address: 'Hiriketiya Bay, Dickwella',
    description:
      'Surf the horseshoe bay of Hiriketiya with friendly local instructors. Gentle beach break on one side, punchy reef on the other — something for every level.',
    images: [IMAGES.aerial, IMAGES.barrel, IMAGES.palms],
    services: ['Lessons', 'Board Rental', 'Cafe'],
    badge: null,
    rating: 4.8,
    reviewCount: 73,
    phone: '+94 70 909 1122',
    email: 'aloha@hiriketiyasurf.lk',
    apiKey: 'sk_demo_hiriketiya',
  },
];

const STARA_PACKAGES = [
  {
    title: '1 Day Surf Lesson',
    subtitle: '2 hours • Equipment included',
    highlights: [
      { icon: 'clock', text: '2 hours' },
      { icon: 'board', text: 'All equipment included' },
      { icon: 'award', text: 'Beginner friendly' },
    ],
    price: 5000,
    originalPrice: null,
    image: IMAGES.surfer,
    popular: true,
    sessions: 1,
    maxParticipants: 6,
  },
  {
    title: '3 Day Surf Package',
    subtitle: '3 × 2 hour lessons • Video analysis',
    highlights: [
      { icon: 'clock', text: '3 x 2 hour lessons' },
      { icon: 'board', text: 'Equipment included' },
      { icon: 'video', text: 'Video analysis' },
    ],
    price: 13500,
    originalPrice: 15000,
    image: IMAGES.action,
    popular: false,
    sessions: 3,
    maxParticipants: 6,
  },
  {
    title: 'Full Week Package',
    subtitle: '7 × 2 hour lessons • Free surf sessions',
    highlights: [
      { icon: 'clock', text: '7 x 2 hour lessons' },
      { icon: 'board', text: 'Equipment included' },
      { icon: 'waves', text: 'Free surf sessions' },
    ],
    price: 28000,
    originalPrice: 35000,
    image: IMAGES.sunsetWalk,
    popular: false,
    sessions: 7,
    maxParticipants: 6,
  },
  {
    title: 'Couple Package',
    subtitle: '2 people • 2 × 2 hour lessons',
    highlights: [
      { icon: 'clock', text: '2 x 2 hour lessons' },
      { icon: 'users', text: 'For two people' },
      { icon: 'camera', text: 'Photo session' },
    ],
    price: 9000,
    originalPrice: 10000,
    image: IMAGES.sunsetSurf,
    popular: false,
    sessions: 2,
    maxParticipants: 2,
  },
];

const REVIEWERS = [
  ['Emma Thompson', 'United Kingdom', 5, 'Stood up on my very first lesson! The instructors are patient, funny and really know the waves here.'],
  ['Lukas Becker', 'Germany', 5, 'Great boards, small groups and the video analysis made a huge difference to my pop-up.'],
  ['Priya Fernando', 'Sri Lanka', 5, 'Booked through the app in a minute and the club confirmed straight away. Lovely crew.'],
  ['Noah Williams', 'Australia', 4, 'Solid coaching and well-maintained equipment. Would have loved one more early session.'],
  ['Chloé Martin', 'France', 5, 'Best week of my trip. The full week package is great value.'],
];

const EMPTY = () => ({ clubs: [], packages: [], reviews: [], bookings: [], notifications: [] });

// SEED_MODE=empty starts with no clubs (production); anything else loads the demo clubs.
export function seedData(mode = process.env.SEED_MODE || 'demo') {
  if (mode === 'empty') return EMPTY();
  const now = new Date().toISOString();
  const today = todayISO();
  const clubs = CLUBS.map(({ phone, email, ...c }, i) => ({
    ...c,
    country: 'Sri Lanka',
    features: FEATURES,
    coordinates: KNOWN_LOCATIONS[c.location.toLowerCase()],
    timeSlots: DEFAULT_SLOTS,
    slotCapacity: 10,
    phone,
    contact: { email, phone },
    notificationEmail: email,
    webhookUrl: null,
    webhookSecret: `whsec_demo_${c.slug.split('-')[0]}`,
    status: 'active',
    verification: { method: 'seed', verifiedAt: now },
    source: 'seed',
    createdAt: now,
    sortOrder: i,
  }));

  const packages = [];
  for (const club of clubs) {
    const templates = club.id === 'club_stara' ? STARA_PACKAGES : starterPackages();
    templates.forEach((p, i) => {
      packages.push({
        id: `pkg_${club.slug.split('-')[0]}_${i + 1}`,
        clubId: club.id,
        currency: 'LKR',
        active: true,
        sortOrder: i,
        createdAt: now,
        ...p,
      });
    });
  }

  const reviews = [];
  for (const club of clubs) {
    REVIEWERS.forEach(([name, country, rating, comment], i) => {
      reviews.push({
        id: `rev_${club.slug.split('-')[0]}_${i + 1}`,
        clubId: club.id,
        name,
        country,
        rating,
        comment,
        date: addDays(today, -(i * 9 + 3)),
      });
    });
  }

  // A few upcoming bookings so calendars and the partner dashboard are not empty.
  const demo = [
    [2, '06:00 - 08:00', 3, 'confirmed', 'Sofia Rossi'],
    [3, '08:00 - 10:00', 2, 'pending', 'Daniel Kim'],
    [3, '06:00 - 08:00', 8, 'confirmed', 'Surf Trip Group'],
    [6, '16:00 - 18:00', 1, 'pending', 'Ava Johnson'],
    [10, '14:00 - 16:00', 4, 'confirmed', 'Kasun Perera'],
  ];
  const stara = packages.filter((p) => p.clubId === 'club_stara');
  const bookings = demo.map(([offset, slot, participants, status, name], i) => {
    const pkg = stara[i % 2];
    return {
      id: `bkg_demo_${i + 1}`,
      ref: `STR-DEMO${i + 1}`,
      clubId: 'club_stara',
      clubName: 'Stara Surf Club',
      packageId: pkg.id,
      packageTitle: pkg.title,
      packageImage: pkg.image,
      date: addDays(today, offset),
      slot,
      participants,
      unitPrice: pkg.price,
      amount: pkg.price * participants,
      currency: 'LKR',
      customer: { name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, phone: '+94 77 000 0000' },
      paymentMethod: i % 2 ? 'club' : 'online',
      paymentStatus: i % 2 ? 'pay_at_club' : 'paid',
      status,
      createdAt: now,
      updatedAt: now,
      history: [{ status: 'pending', at: now, note: 'Booking placed' }],
    };
  });

  return { clubs, packages, reviews, bookings, notifications: [] };
}

export async function seedDatabase(mode = process.env.SEED_MODE || 'demo') {
  if (mode === 'empty') return;
  const data = seedData('demo');

  for (const c of data.clubs) {
    await prisma.club.upsert({
      where: { id: c.id },
      create: c,
      update: c,
    });
  }

  for (const p of data.packages) {
    const { currency, ...restPkg } = p;
    await prisma.package.upsert({
      where: { id: restPkg.id },
      create: restPkg,
      update: restPkg,
    });
  }

  for (const r of data.reviews) {
    await prisma.review.upsert({
      where: { id: r.id },
      create: r,
      update: r,
    });
  }

  for (const b of data.bookings) {
    await prisma.booking.upsert({
      where: { id: b.id },
      create: b,
      update: b,
    });
  }
}
