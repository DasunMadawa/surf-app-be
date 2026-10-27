// Shared reference data used by the seed and by automatic club onboarding.

const unsplash = (id, w = 1200) => `https://images.unsplash.com/photo-${id}?w=${w}&q=80&auto=format&fit=crop`;

export const IMAGES = {
  barrel: unsplash('1502680390469-be75c86b636f'),
  surfer: unsplash('1455729552865-3658a5d39692'),
  action: unsplash('1530870110042-98b2cb110834'),
  boardRack: unsplash('1537519646099-335112f03225'),
  sunsetWalk: unsplash('1415931633537-351070d20b81'),
  boardOnSand: unsplash('1531722569936-825d3dd91b15'),
  tropicalBeach: unsplash('1507525428034-b723cf961d3e'),
  beach: unsplash('1519046904884-53103b34b206'),
  palms: unsplash('1506953823976-52e1fdc0149a'),
  sunsetSurf: unsplash('1509914398892-963f53e6e2f1'),
  wave: unsplash('1559827260-dc66d52bef19'),
  aerial: unsplash('1505142468610-359e7d316be0'),
  villa: unsplash('1416331108676-a22ccb276e35'),
};

export const DEFAULT_SLOTS = ['06:00 - 08:00', '08:00 - 10:00', '14:00 - 16:00', '16:00 - 18:00'];

export const SERVICES = ['Lessons', 'Board Rental', 'Surf Trips', 'Cafe', 'Yoga', 'Accommodation'];

export const FEATURES = ['certified', 'all-levels', 'equipment', 'flexible'];

// Known surf towns get map coordinates automatically during onboarding.
export const KNOWN_LOCATIONS = {
  weligama: { lat: 5.9727, lng: 80.4296 },
  midigama: { lat: 5.9614, lng: 80.3893 },
  mirissa: { lat: 5.9483, lng: 80.4716 },
  hiriketiya: { lat: 5.9631, lng: 80.7079 },
  ahangama: { lat: 5.9733, lng: 80.3622 },
  'arugam bay': { lat: 6.8406, lng: 81.8368 },
  hikkaduwa: { lat: 6.1395, lng: 80.1063 },
  unawatuna: { lat: 6.0108, lng: 80.2489 },
};

// Starter packages a newly registered club gets when it does not send its own.
export function starterPackages() {
  return [
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
      title: 'Board Rental',
      subtitle: 'Half day • Soft & hard boards',
      highlights: [
        { icon: 'clock', text: 'Half day' },
        { icon: 'board', text: 'Soft & hard boards' },
        { icon: 'shield', text: 'Leash & wax included' },
      ],
      price: 2000,
      originalPrice: null,
      image: IMAGES.boardOnSand,
      popular: false,
      sessions: 1,
      maxParticipants: 10,
    },
  ];
}
