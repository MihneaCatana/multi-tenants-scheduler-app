import { eq } from 'drizzle-orm';
import { globalDb, closeGlobalDb } from '../db/client.js';
import { users } from '../db/schema/global/users.js';
import { hashPassword } from '../lib/crypto.js';
import { Role } from '../lib/roles.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Seed the bootstrap platform admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 * Idempotent — if a platform admin with that email exists, the password is
 * rotated to match the env var. Safe to re-run.
 *
 * Run with:  pnpm seed
 */
async function seedAdmin(): Promise<void> {
  const email = env.SEED_ADMIN_EMAIL;
  const password = env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    logger.error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in the environment.',
    );
    process.exit(1);
  }

  const normalized = email.toLowerCase().trim();
  const [existing] = await globalDb
    .select()
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);

  const passwordHash = await hashPassword(password);

  if (existing) {
    await globalDb
      .update(users)
      .set({ passwordHash, role: Role.PLATFORM_ADMIN, updatedAt: new Date() })
      .where(eq(users.id, existing.id));
    logger.info({ email: normalized }, 'Updated existing platform admin password.');
    return;
  }

  await globalDb.insert(users).values({
    email: normalized,
    passwordHash,
    role: Role.PLATFORM_ADMIN,
  });
  logger.info({ email: normalized }, 'Created platform admin.');
}

seedAdmin()
  .then(async () => {
    await closeGlobalDb();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, 'Seed failed.');
    await closeGlobalDb();
    process.exit(1);
  });
