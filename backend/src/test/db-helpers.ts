/**
 * Minimal DB test helpers for scheduling integration tests.
 *
 * Connects directly to the dev tenant_template DB (localhost:5433) as the admin
 * superuser, builds a Drizzle instance, and provides seed/cleanup helpers. Tests
 * clean up after themselves by hard-deleting the rows they created (test data is
 * ephemeral and should not pollute the template).
 *
 * NOTE: these tests require a running dev DB (docker compose up). They are
 * skipped automatically when DB_TEST_URL is unset — set it in .env.test to run.
 */
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { tenantSchema } from '../db/schema/tenant/index.js';
import { resources, type ResourceType } from '../db/schema/tenant/resources.js';
import { services } from '../db/schema/tenant/services.js';
import { sql } from 'drizzle-orm';

export type TestDb = NodePgDatabase<typeof tenantSchema>;

const DB_TEST_URL = process.env.DB_TEST_URL;

function shouldSkip(): boolean {
  return !DB_TEST_URL;
}

export function getTestDb(): TestDb {
  if (shouldSkip()) {
    throw new Error('DB_TEST_URL not set — skipping (wrap test in describeIfDb).');
  }
  const pool = new pg.Pool({ connectionString: DB_TEST_URL });
  return drizzle(pool, { schema: tenantSchema });
}

/** Seed a resource row; returns the created row. */
export async function seedResource(
  db: TestDb,
  opts: { type?: ResourceType; name?: string } = {},
  ) {
  const [row] = await db
    .insert(resources)
    .values({
      name: opts.name ?? `Test-${Math.random().toString(36).slice(2, 8)}`,
      type: opts.type ?? 'room',
    })
    .returning();
  return row!;
}

/** Seed a service row; returns the created row. */
export async function seedService(
  db: TestDb,
  opts: { durationMinutes?: number; bufferBefore?: number; bufferAfter?: number } = {},
) {
  const [row] = await db
    .insert(services)
    .values({
      name: `Svc-${Math.random().toString(36).slice(2, 8)}`,
      durationMinutes: opts.durationMinutes ?? 60,
      bufferBeforeMinutes: opts.bufferBefore ?? 0,
      bufferAfterMinutes: opts.bufferAfter ?? 0,
    })
    .returning();
  return row!;
}

/**
 * Hard-delete all scheduling test data. Uses raw SQL with a fixed marker prefix
 * ('Test-', 'Svc-') to target only test-seeded rows, avoiding clobbering any
 * real data a developer may have entered.
 */
export async function cleanup(db: TestDb): Promise<void> {
  await db.execute(
    sql`DELETE FROM appointment_status_history WHERE appointment_id IN (SELECT id FROM appointments WHERE summary LIKE 'Test%' OR summary IS NULL AND created_by_staff_id IS NULL)`,
  );
  await db.execute(sql`DELETE FROM appointment_resources`);
  await db.execute(sql`DELETE FROM appointments`);
  await db.execute(sql`DELETE FROM time_off`);
  await db.execute(sql`DELETE FROM working_hours`);
  await db.execute(sql`DELETE FROM service_resource_requirements`);
  await db.execute(sql`DELETE FROM services WHERE name LIKE 'Svc-%'`);
  await db.execute(sql`DELETE FROM resources WHERE name LIKE 'Test-%'`);
}

/** A fixed actor staff id for tests. Must reference an existing staff row. */
export const TEST_STAFF_ID = '00000000-0000-0000-0000-000000000001';

/** Ensure the test actor staff row exists (idempotent). */
export async function ensureTestStaff(db: TestDb): Promise<void> {
  await db.execute(sql`
    INSERT INTO staff (id, email, password_hash, role, first_name, last_name, active)
    VALUES (${TEST_STAFF_ID}, 'test-actor@example.com', 'x', 'tenant_admin', 'Test', 'Actor', true)
    ON CONFLICT (id) DO NOTHING
  `);
}

export const DB_AVAILABLE = !shouldSkip();
