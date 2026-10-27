import '../env.js';
import { load, prisma } from '../db.js';
import { DEFAULT_TOWNS, importFromPlaces } from '../discovery.js';
import { placesConfigured } from '../places.js';

// Usage: npm run import:places [-- Weligama Mirissa] [--all]
//   towns    defaults to every known surf town
//   --all    keep places without "surf" in the name (more results, more noise)
//   --pages=N fetch up to N pages (20 results each) per query, max 3
const args = process.argv.slice(2);
const towns = args.filter((a) => !a.startsWith('--'));
const strict = !args.includes('--all');
const pages = Number(args.find((a) => a.startsWith('--pages='))?.split('=')[1]) || 1;

if (!placesConfigured()) {
  console.error('GOOGLE_MAPS_API_KEY is not set. Add it to server/.env (see .env.example).');
  process.exit(1);
}

await load();
console.log(`Importing surf clubs from Google Places for: ${(towns.length ? towns : DEFAULT_TOWNS).join(', ')}`);
try {
  const summary = await importFromPlaces({
    towns: towns.length ? towns : undefined,
    strict,
    maxPagesPerQuery: Math.min(3, Math.max(1, pages)),
    log: (line) => console.log(`  ${line}`),
  });
  console.log(`\nDone: ${summary.created} new, ${summary.updated} updated, ${summary.skipped} skipped.`);
  for (const e of summary.errors) console.warn(`  ! ${e}`);
  console.log('Restart the server if it is running so it picks up the new data.');
} catch (err) {
  console.error(`Import failed: ${err.message}`);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}

