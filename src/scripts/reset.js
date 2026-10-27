import '../env.js';
import { prisma } from '../db.js';
import { seedDatabase } from '../seed.js';

// Deletes database contents and re-seeds it.
//   npm run reset             -> uses SEED_MODE (demo by default)
//   npm run reset -- --empty  -> no clubs at all
//   npm run reset -- --demo   -> fictional demo clubs
if (process.argv.includes('--empty')) process.env.SEED_MODE = 'empty';
if (process.argv.includes('--demo')) process.env.SEED_MODE = 'demo';

console.log('Resetting PostgreSQL database...');
await prisma.notification.deleteMany();
await prisma.booking.deleteMany();
await prisma.review.deleteMany();
await prisma.package.deleteMany();
await prisma.club.deleteMany();

await seedDatabase(process.env.SEED_MODE || 'demo');
console.log('Database reset complete.');
await prisma.$disconnect();
