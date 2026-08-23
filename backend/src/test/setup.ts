/**
 * Vitest global setup.
 *
 * Loads .env.test so that NODE_ENV=test and all required env vars are present
 * BEFORE any source module (especially config/env.ts) is imported. The Zod
 * schema in env.ts validates process.env at module scope and exits on failure,
 * so this must run first.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });
