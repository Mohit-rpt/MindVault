import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

declare global {
  var __globalPrismaClient: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__globalPrismaClient ||
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalThis.__globalPrismaClient = prisma;
}
