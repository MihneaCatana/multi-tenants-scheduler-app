// @ts-check
/**
 * Generate secure random secrets for all sensitive environment variables.
 *
 * Usage:
 *   node scripts/generate-secrets.mjs                # print to stdout
 *   node scripts/generate-secrets.mjs > my-secrets.env
 *   node scripts/generate-secrets.mjs | clip          # Windows
 *   node scripts/generate-secrets.mjs | pbcopy        # macOS
 *
 * Zero dependencies — uses only node: built-ins + openssl (for Ed25519).
 * Cross-platform (Windows / macOS / Linux).
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate `n` random bytes and encode as URL-safe base64 (no padding).
 * This avoids `+`, `/`, and `=` characters that cause issues in env files
 * and shell contexts.
 */
function secret(bytes) {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Run a command and return stdout as a string. Rejects on non-zero exit.
 */
function exec(cmd, args) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', rejectP);
    child.on('close', (code) => {
      if (code === 0) resolveP(stdout);
      else rejectP(new Error(`\`${cmd} ${args.join(' ')}\` exited ${code}: ${stderr}`));
    });
  });
}

/**
 * Generate an Ed25519 keypair via openssl. Returns { private, public } as
 * single-line PEM strings suitable for pasting into .env.
 */
async function generateEd25519Keypair() {
  const tmpKey = join(tmpdir(), `simi-jwt-${Date.now()}.pem`);

  try {
    // Generate private key (PEM, may have newlines).
    await exec('openssl', ['genpkey', '-algorithm', 'Ed25519', '-out', tmpKey]);

    // Derive public key from the private key file.
    const pubPem = await exec('openssl', ['pkey', '-in', tmpKey, '-pubout']);

    // Read private key back and strip newlines for inline use.
    const { readFileSync } = await import('node:fs');
    const privPem = readFileSync(tmpKey, 'utf8');

    return {
      private: privPem.replace(/\r?\n/g, ''),
      public: pubPem.replace(/\r?\n/g, ''),
    };
  } finally {
    // Clean up temp file.
    try {
      unlinkSync(tmpKey);
    } catch {
      // Already removed or permissions issue — not critical.
    }
  }
}

// ---------------------------------------------------------------------------
// Print helpers (no ANSI escapes so piped output stays clean)
// ---------------------------------------------------------------------------

const line = () => console.log('#');

function comment(text) {
  console.log(`# ${text}`);
}

function env(key, value, description) {
  console.log(`# ${description}`);
  console.log(`${key}=${value}`);
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  comment('-----------------------------------------------------------------------');
  comment(' Simi backend — generated secrets');
  comment(' Generated at: ' + new Date().toISOString());
  comment('-----------------------------------------------------------------------');
  comment('');
  comment('Copy these values into your .env file. Every secret below meets or');
  comment('exceeds the minimum length enforced by src/config/env.ts at startup.');
  comment('');

  // ── Cookie signing ──────────────────────────────────────────────────────
  comment('--- Cookie signing ---');
  env('COOKIE_SECRET', secret(32), 'Signs HTTP cookies. Must be >= 32 chars.');

  // ── JWT (Ed25519) ─────────────────────────────────────────────────────────
  comment('--- JWT asymmetric keys (EdDSA / Ed25519) ---');
  comment('Generating Ed25519 keypair via openssl...');
  const keys = await generateEd25519Keypair();
  env('JWT_PRIVATE_KEY', keys.private, 'Ed25519 private key (single-line PEM).');
  env('JWT_PUBLIC_KEY', keys.public, 'Ed25519 public key (single-line PEM).');
  env('JWT_ALGORITHM', 'EdDSA', 'Algorithm matching the Ed25519 keypair above.');

  // ── Global database cluster ───────────────────────────────────────────────
  comment('--- Global database cluster (app / migrate / admin) ---');
  comment('All DB passwords must be >= 16 chars.');
  env(
    'GLOBAL_DB_PASSWORD',
    secret(16),
    'Global app role (DML only, runtime pool in src/db/client.ts).',
  );
  env(
    'GLOBAL_DB_MIGRATE_PASSWORD',
    secret(16),
    'Global migrate role (DDL only, drizzle-kit + db:migrate:global).',
  );
  env(
    'GLOBAL_DB_ADMIN_PASSWORD',
    secret(16),
    'Global admin role (superuser, backups + break-glass). Not used at runtime.',
  );

  // ── Tenant database cluster ────────────────────────────────────────────────
  comment('--- Tenant database cluster (migrate / admin) ---');
  comment('Per-tenant app role passwords are HMAC-derived from TENANT_APP_MASTER_KEY.');
  env(
    'TENANT_DB_MIGRATE_PASSWORD',
    secret(16),
    'Tenant migrate role (DDL on tenant_template, drizzle-kit introspection).',
  );
  env(
    'TENANT_DB_ADMIN_PASSWORD',
    secret(16),
    'Tenant admin role (superuser, CREATE DATABASE at provisioning). Not used at runtime.',
  );

  // ── Per-tenant HMAC master keys ───────────────────────────────────────────
  comment('--- Per-tenant credential derivation ---');
  comment('HMAC-SHA256 master keys. Each tenant gets a unique password derived from');
  comment('its key + tenant ID. See src/lib/tenant-creds.ts.');
  env(
    'TENANT_OWNER_MASTER_KEY',
    secret(32),
    'HMAC master key for per-tenant owner role passwords (DDL tier). Min 32 chars.',
  );
  env(
    'TENANT_APP_MASTER_KEY',
    secret(32),
    'HMAC master key for per-tenant app role passwords (DML tier). Min 32 chars.',
  );

  // ── Backup encryption ─────────────────────────────────────────────────────
  comment('--- Backup encryption ---');
  env(
    'BACKUP_ENCRYPT_PASSPHRASE',
    secret(24),
    'GPG passphrase for encrypting backup files at rest. Set in docker-compose.yml.',
  );

  // ── Bootstrap admin ───────────────────────────────────────────────────────
  comment('--- Bootstrap admin ---');
  env(
    'SEED_ADMIN_PASSWORD',
    secret(12),
    'Password for the platform admin created by pnpm seed. Min 8 chars.',
  );
}

main().catch((err) => {
  console.error(`Error: ${err.message ?? err}`);
  process.exit(1);
});
