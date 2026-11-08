import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

declare global {
  var __globalWorkerPrismaClient: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__globalWorkerPrismaClient ||
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalThis.__globalWorkerPrismaClient = prisma;
}
