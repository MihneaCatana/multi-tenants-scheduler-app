import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * Centralized, parse-and-validate environment configuration.
 *
 * The app fails fast at boot if any required variable is missing or malformed,
 * rather than failing later with a confusing stack trace deep in a request.
 */

const boolString = z
  .string()
  .transform((v) => v.toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0']))
  .transform((v) => v === 'true' || v === '1');

/**
 * Fastify `trustProxy` accepts a boolean, a hop count (number), a single
 * IP/CIDR, or a comma-separated list of IPs/CIDRs. We parse the env string into
 * one of those forms. Default is `false` — we NEVER trust forwarded headers
 * unless explicitly configured, because tenant resolution, rate-limit keying,
 * and session IP attribution all depend on `req.ip`/`req.hostname` being the
 * proxy's real view of the client (not a client-supplied X-Forwarded-* header).
 *
 * Production behind a known proxy: set TRUST_PROXY to the proxy's CIDR (or a
 * hop count like `1`). The proxy MUST overwrite X-Forwarded-Host /
 * X-Forwarded-For unconditionally, not append to them.
 */
const trustProxyValue = z
  .string()
  .default('false')
  .transform((raw) => {
    const s = raw.trim().toLowerCase();
    if (s === 'true' || s === '1') return true as const;
    if (s === 'false' || s === '0') return false as const;
    if (/^\d+$/.test(s)) return Number(s);
    // Comma-separated CIDR/IP list or a single CIDR/IP — pass through verbatim.
    return raw.trim();
  });

const ttlString = z
  .string()
  .min(1)
  .refine(
    (v) => /^\d+\s*(ms|s|m|h|d|w)$/i.test(v),
    'Must be a duration like "15m", "2h", "30d".',
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),

  BASE_DOMAIN: z.string().min(1),
  APEX_IS_ADMIN_HOST: boolString.default('true'),

  // Which forwarded headers to trust (see trustProxyValue above). Default
  // `false` for security: set explicitly to a proxy CIDR / hop count in prod.
  TRUST_PROXY: trustProxyValue,

  // Comma-separated list of allowed CORS origins. In development this defaults to
  // the local Vite dev server. In production, set to your actual frontend origin(s).
  // When empty (or unset), CORS is disabled entirely.
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  JWT_PRIVATE_KEY: z.string().optional().default(''),
  JWT_PUBLIC_KEY: z.string().optional().default(''),
  JWT_ALGORITHM: z
    .enum(['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'EdDSA'])
    .default('HS256'),
  // JWT issuer / audience. Set on both sign and verify so a token is bound to
  // this service and this audience — defends against token confusion across
  // services or environments that might share a key set. Defaults are stable
  // identifiers; override per environment only if you integrate with other
  // services sharing the key.
  JWT_ISSUER: z.string().min(1).default('simi-backend'),
  JWT_AUDIENCE: z.string().min(1).default('simi-api'),
  ACCESS_TOKEN_TTL: ttlString.default('15m'),
  REFRESH_TOKEN_TTL: ttlString.default('30d'),
  COOKIE_SECURE: boolString.default('false'),
  // Secret used to sign HTTP cookies. Must be a long, random string.
  // Used by @fastify/cookie to prevent cookie tampering. No default — must
  // be set in .env. Generate with: openssl rand -base64 32
  COOKIE_SECRET: z.string().min(32),

  // --- Global cluster (auth, users, tenant registry) ---
  // App tier (DML only) — used by the runtime pool in src/db/client.ts.
  GLOBAL_DB_HOST: z.string().min(1),
  GLOBAL_DB_PORT: z.coerce.number().int().positive().default(5432),
  GLOBAL_DB_USER: z.string().min(1),
  GLOBAL_DB_PASSWORD: z.string().min(16),
  GLOBAL_DB_NAME: z.string().min(1),
  GLOBAL_DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  // Migrate tier (DDL on simi_global) — used by db:migrate and drizzle-kit.
  GLOBAL_DB_MIGRATE_USER: z.string().min(1),
  GLOBAL_DB_MIGRATE_PASSWORD: z.string().min(16),
  // Admin tier (cluster superuser) — backups + any break-glass global DDL.
  GLOBAL_DB_ADMIN_USER: z.string().min(1),
  GLOBAL_DB_ADMIN_PASSWORD: z.string().min(16),

  // --- Tenant cluster (one DB per tenant + tenant_template) ---
  // App tier (DML only) — per-tenant role `tenant_<sub>_app` whose password is
  // HMAC-derived from TENANT_APP_MASTER_KEY. Used by the cached per-tenant pool
  // in src/db/tenant-pool.ts. Grants are configured at provisioning time.
  TENANT_DB_HOST: z.string().min(1),
  TENANT_DB_PORT: z.coerce.number().int().positive().default(5432),
  TENANT_DB_NAME: z.string().min(1),
  TENANT_DB_TEMPLATE: z.string().min(1).default('tenant_template'),
  TENANT_DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  // Migrate tier (DDL on tenant_template + drizzle-kit introspection).
  TENANT_DB_MIGRATE_USER: z.string().min(1),
  TENANT_DB_MIGRATE_PASSWORD: z.string().min(16),
  // Admin tier (cluster superuser) — CREATE DATABASE at provisioning only.
  TENANT_DB_ADMIN_USER: z.string().min(1),
  TENANT_DB_ADMIN_PASSWORD: z.string().min(16),
  // HMAC key for deriving per-tenant owner-role passwords. See
  // src/lib/tenant-creds.ts. Rotation = change this + run ALTER ROLE loop.
  // Master key alone is useless without tenant ids; tenant ids alone (from a
  // global dump) are useless without the master key. Two secrets, two locations.
  TENANT_OWNER_MASTER_KEY: z.string().min(32),
  // HMAC key for deriving per-tenant app-role passwords. Separate from the owner
  // master key so compromise of one tier does not expose the other.
  // See src/lib/tenant-creds.ts. Rotation = change this + run ALTER ROLE loop.
  TENANT_APP_MASTER_KEY: z.string().min(32),

  // --- Scheduling ---
  // Default timezone for newly provisioned tenants, and the fallback when a
  // tenant has not set its own timezone in tenant_settings. IANA name
  // (e.g. 'Europe/Bucharest'). See modules/availability/timezone.ts.
  DEFAULT_TENANT_TIMEZONE: z.string().min(2).default('UTC'),

  DB_SSL: boolString.default('false'),
  // Path to a PEM CA certificate file for verifying the PostgreSQL server's
  // TLS certificate. Only used when DB_SSL=true. Needed when connecting to
  // managed Postgres providers that use private CAs (e.g. AWS RDS custom CA).
  DB_SSL_CA: z.string().optional(),

  // --- Observability (file-based logs) ---
  // Root directory for per-tenant + global log folders. Each tenant gets a
  // subfolder named by subdomain; platform/apex events go to LOG_DIR/global.
  LOG_DIR: z.string().min(1).default('./logs'),
  // Files older than this many days are purged by the daily cleanup job.
  LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  // Minimum pino log level.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // --- Feature flags ---
  // Per-tenant resolved-flag cache TTL in milliseconds. A short TTL means an
  // admin flip propagates within seconds; writes invalidate the entry at once.
  FLAG_CACHE_TTL_MS: z.coerce.number().int().min(0).default(15000),

  // --- Rate limiting ---
  // Global requests per IP per time window. Applied to all routes that don't
  // override with a stricter per-route limit.
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().min(1).default(200),
  RATE_LIMIT_GLOBAL_WINDOW: z.string().min(1).default('1 minute'),
  // Per-route tiers (stricter than global). Applied to auth endpoints, mutations,
  // and heavy operations respectively. All share the same time window as global.
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_MUTATION_MAX: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_HEAVY_MUTATION_MAX: z.coerce.number().int().min(1).default(30),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

export type Env = typeof env;

/**
 * True when the JWT config is suitable for production (asymmetric keys present).
 * In development with an HS256 fallback the app still runs, but we surface this
 * so startup logs make the risk obvious.
 */
export const hasProductionJwtKeys =
  env.JWT_ALGORITHM !== 'HS256' &&
  env.JWT_PRIVATE_KEY.length > 0 &&
  env.JWT_PUBLIC_KEY.length > 0;

/**
 * For HS256 dev fallback we derive a deterministic-ish secret from the provided
 * key, or generate an ephemeral one. Production must use asymmetric keys.
 */
export function resolveJwtSecret(): {
  private: string;
  public: string;
  algorithm: Env['JWT_ALGORITHM'];
} {
  if (env.JWT_ALGORITHM === 'HS256') {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'HS256 JWT is not allowed in production. Set JWT_ALGORITHM=EdDSA (or RS*) and provide a JWT_PRIVATE_KEY / JWT_PUBLIC_KEY pair.',
      );
    }
    // Dev fallback: use provided key or a random ephemeral secret.
    const devKey = env.JWT_PRIVATE_KEY || randomEphemeralKey();
    return { private: devKey, public: devKey, algorithm: 'HS256' };
  }
  if (!env.JWT_PRIVATE_KEY || !env.JWT_PUBLIC_KEY) {
    throw new Error(
      `JWT_ALGORITHM=${env.JWT_ALGORITHM} requires both JWT_PRIVATE_KEY and JWT_PUBLIC_KEY.`,
    );
  }
  return {
    private: env.JWT_PRIVATE_KEY,
    public: env.JWT_PUBLIC_KEY,
    algorithm: env.JWT_ALGORITHM,
  };
}

function randomEphemeralKey(): string {
  // 32 random bytes, hex-encoded. Ephemeral: refresh tokens won't survive a
  // server restart in dev, which is acceptable and surfaces the misconfig.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('hex');
}

/**
 * Build a pg-compatible SSL configuration from the current env.
 *
 * In production, server certificate verification is mandatory (rejectUnauthorized
 * defaults to true). In development, verification is disabled to allow
 * self-signed certs without requiring a local CA bundle.
 *
 * When DB_SSL_CA is set and the file exists, the CA certificate is appended so
 * private-CA chains (e.g. AWS RDS custom CA) can be verified.
 */
export function sslConfig(): { rejectUnauthorized: boolean; ca?: Buffer } | undefined {
  if (!env.DB_SSL) return undefined;
  if (env.NODE_ENV === 'production') {
    let ca: Buffer | undefined;
    if (env.DB_SSL_CA && existsSync(env.DB_SSL_CA)) {
      ca = readFileSync(env.DB_SSL_CA);
    }
    return { rejectUnauthorized: true, ca };
  }
  // Development: accept self-signed certs.
  return { rejectUnauthorized: false };
}

/** Convert a human-readable TTL ("15m", "30d") into seconds. */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d|w)$/i.exec(ttl);
  if (!match) throw new Error(`Invalid TTL: ${ttl}`);
  const value = Number(match[1]!);
  const unit = match[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
    w: 604800,
  };
  return Math.floor(value * multipliers[unit]!);
}
