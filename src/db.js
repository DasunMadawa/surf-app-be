import { PrismaClient } from '@prisma/client';
import { seedDatabase } from './seed.js';

export const prisma = new PrismaClient();

export async function load() {
  await prisma.$connect();
  const count = await prisma.club.count();
  if (count === 0 && process.env.SEED_MODE !== 'empty') {
    await seedDatabase();
    console.log(`Created database (demo data in PostgreSQL)`);
  } else {
    console.log(`Connected to PostgreSQL database (${count} clubs found)`);
  }
}

export function db() {
  return prisma;
}

export function persist() {
  // Real-time persistence handled by PostgreSQL via Prisma
}

export default prisma;
