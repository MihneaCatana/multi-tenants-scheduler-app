// @ts-check
/**
 * One-shot dev environment setup for the Simi backend.
 *
 * Run with:  pnpm setup   (or:  node scripts/dev-setup.mjs)
 *
 * It assumes nothing is up yet — no containers, no migrated DBs, no seeded
 * admin. From a clean checkout it will:
 *
 *   1. Ensure a `.env` exists (copies `.env.example` if missing, then prompts
 *      you to edit secrets it could not fill safely).
 *   2. Bring up the full Docker stack detached (postgres-global,
 *      postgres-tenant, backups, app on tsx watch).
 *   3. Wait for both Postgres clusters to report healthy.
 *   4. Apply migrations (global DB + every tenant DB) inside the app container.
 *   5. Seed the platform admin (idempotent — rotates the password to match env).
 *   6. Provision a sample "Acme" tenant (idempotent — skipped if it already
 *      exists), so the env is immediately testable end to end.
 *   7. Print the exact curl commands to log in and try the API.
 *
 * Cross-platform (Windows/macOS/Linux): uses only `node:` built-ins + `docker`.
 * Re-running it is safe — every step is idempotent.
 */
import { spawn } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ENV_FILE = join(REPO_ROOT, '.env');
const ENV_EXAMPLE = join(REPO_ROOT, '.env.example');

// Sample tenant the script provisions so the env is testable immediately.
// Edit `.env` to change these (they're read back from there, not hardcoded
// into provisioning — see STEP_ENV for the keys).
const SAMPLE_TENANT = {
  name: 'Acme Inc',
  subdomain: 'acme',
  email: 'owner@acme.com',
  password: 'supersecret',
};

const COLOR = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

const log = (msg) => console.log(msg);
const step = (n, title) =>
  log(`\n${COLOR.bold}${COLOR.cyan}[${n}]${COLOR.reset} ${COLOR.bold}${title}${COLOR.reset}`);
const ok = (msg) => log(`  ${COLOR.green}✓${COLOR.reset} ${msg}`);
const warn = (msg) => log(`  ${COLOR.yellow}!${COLOR.reset} ${msg}`);
const fail = (msg) => log(`  ${COLOR.red}✗${COLOR.reset} ${msg}`);

// ---------------------------------------------------------------------------
// process: spawn a command, inherit stdio, reject on non-zero exit.
// `overrideEnv` lets us run commands with a clean/controlled environment
// (used for `docker compose`, which must read the host shell, not Node's).
// ---------------------------------------------------------------------------
function run(cmd, args, opts = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      cwd: REPO_ROOT,
      ...opts,
    });
    child.on('error', rejectP);
    child.on('close', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`));
    });
  });
}

// Silent variant: capture stdout, don't stream it. Used for health polling.
function capture(cmd, args, opts = {}) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      cwd: REPO_ROOT,
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', rejectP);
    child.on('close', (code) => resolveP({ code, stdout, stderr }));
  });
}

// ---------------------------------------------------------------------------
// Minimal `.env` parser. We don't pull in dotenv here because this script runs
// before dependencies are guaranteed to be useful; the format is simple.
// ---------------------------------------------------------------------------
function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip surrounding quotes (single or double) if present.
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function readEnv() {
  if (!existsSync(ENV_FILE)) return {};
  return parseEnv(readFileSync(ENV_FILE, 'utf8'));
}

// docker compose v2 ships as a plugin (`docker compose`). Older standalone
// binary is `docker-compose`. Detect once.
async function detectCompose() {
  const { code } = await capture('docker', ['compose', 'version']);
  if (code === 0) return ['docker', ['compose']];
  const standalone = await capture('docker-compose', ['version']);
  if (standalone.code === 0) return ['docker-compose', []];
  throw new Error(
    'Docker Compose not found. Install Docker Desktop or the Compose CLI plugin.',
  );
}

async function checkDockerDaemon() {
  const { code } = await capture('docker', ['info']);
  if (code !== 0) {
    throw new Error(
      'The Docker daemon is not running. Start Docker Desktop / dockerd first.',
    );
  }
}

async function waitForComposeHealth(composeBin, baseArgs, { timeoutMs = 120_000 }) {
  const deadline = Date.now() + timeoutMs;
  const services = ['postgres-global', 'postgres-tenant'];
  // Poll `docker compose ps --format json`. A healthy service shows
  // Health === "healthy" (or Status "running" with no healthcheck, but both
  // pg services have one). We require BOTH healthy before proceeding.
  let last = '';
  while (Date.now() < deadline) {
    const { code, stdout } = await capture(composeBin, [...baseArgs, 'ps', '--format', 'json']);
    if (code === 0 && stdout.trim()) {
      // `docker compose ps --format json` emits one JSON object per line (or a
      // JSON array, depending on version). Normalize to an array.
      let rows = [];
      try {
        const parsed = JSON.parse(stdout);
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        // Some versions emit NDJSON; parse line by line.
        rows = stdout
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      }
      const states = new Map(rows.map((r) => [r.Service ?? r.service, r]));
      const healthy = services.filter((s) => {
        const r = states.get(s);
        // Accept either Health=healthy or (running + no healthcheck field).
        return r && (r.Health === 'healthy' || r.health === 'healthy');
      });
      if (healthy.length === services.length) return true;
      last = services
        .map((s) => {
          const r = states.get(s);
          return `${s}=${r?.Health ?? r?.health ?? r?.State ?? r?.state ?? '?'}`;
        })
        .join(', ');
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`Timed out waiting for Postgres health. Last state: ${last}`);
}

// Direct pg check: can the migrate role actually connect to each DB? This is a
// stronger guarantee than the container healthcheck (which only confirms the
// process is up) and gives a clean error if init scripts haven't finished.
async function waitForPg(env, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  const targets = [
    { label: 'global', cfg: pgConfigForHost(env, 'global') },
    { label: 'tenant', cfg: pgConfigForHost(env, 'tenant') },
  ];
  for (const t of targets) {
    let lastErr;
    while (Date.now() < deadline) {
      const client = new pg.Client(t.cfg);
      try {
        await client.connect();
        await client.query('SELECT 1');
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 1500));
      } finally {
        await client.end().catch(() => undefined);
      }
    }
    throw new Error(`Could not connect to ${t.label} DB (${t.cfg.host}:${t.cfg.port}/${t.cfg.database}): ${lastErr?.message ?? lastErr}`);
  }
}

function pgConfigFromEnv(env, cluster) {
  const P = cluster === 'global' ? 'GLOBAL_DB' : 'TENANT_DB';
  return {
    host: env[`${P}_HOST`],
    port: Number(env[`${P}_PORT`] ?? 5432),
    // Connect as the ADMIN (superuser) for the existence/role checks below.
    user: env[`${P}_ADMIN_USER`],
    password: env[`${P}_ADMIN_PASSWORD`],
    database: cluster === 'global' ? env[`${P}_NAME`] : env[`${P}_TEMPLATE`],
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5000,
  };
}

/**
 * Build a pg connection config that is reachable from the **host** machine
 * (not from inside a container). The .env values reference Docker-network
 * hostnames (e.g. `postgres-global`) and internal ports (5432), which are
 * unreachable from the host. We map to `localhost` and the published ports
 * defined in docker-compose.yml: global → 5432, tenant → 5433.
 */
function pgConfigForHost(env, cluster) {
  const cfg = pgConfigFromEnv(env, cluster);
  cfg.host = 'localhost';
  if (cluster === 'tenant') {
    // docker-compose publishes tenant as 5433:5432 (host:container).
    cfg.port = 5433;
  }
  // global is 5432:5432 — no port change needed.
  return cfg;
}

/**
 * Does the sample tenant already exist? We check via the global admin
 * connection (not the app container) because `pnpm provision:tenant` throws a
 * 409 on a duplicate subdomain — we want the script to be safely re-runnable.
 */
async function sampleTenantExists(env, subdomain) {
  const cfg = pgConfigForHost(env, 'global');
  const client = new pg.Client(cfg);
  try {
    await client.connect();
    const res = await client.query(
      'SELECT id FROM tenants WHERE subdomain = $1 AND status = $2 LIMIT 1',
      [subdomain, 'active'],
    );
    return res.rowCount > 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function ensureEnv() {
  step(1, 'Ensuring .env exists');
  if (existsSync(ENV_FILE)) {
    ok('.env already present.');
    return;
  }
  if (!existsSync(ENV_EXAMPLE)) {
    throw new Error('Neither .env nor .env.example found. Are you in the repo root?');
  }
  copyFileSync(ENV_EXAMPLE, ENV_FILE);
  ok('Copied .env.example → .env.');
  warn(
    'Review .env before production. Dev defaults are fine for local use, but ' +
      'TENANT_OWNER_MASTER_KEY, TENANT_APP_MASTER_KEY, COOKIE_SECRET, JWT keys, and DB passwords (min 16 chars) are placeholders.',
  );
}

async function checkPrereqs() {
  step(2, 'Checking prerequisites');
  await checkDockerDaemon();
  ok('Docker daemon is running.');
  const [bin, base] = await detectCompose();
  ok(`Using Compose: ${bin} ${base.join(' ')}`);
  return { bin, base };
}

async function bringUpStack({ bin, base }) {
  step(3, 'Bringing up the Docker stack (detached)');
  // `--wait` would block until healthy, but its error output is terse; we do
  // our own health polling next for clearer messages. Up detached starts all
  // services including the app (tsx watch).
  await run(bin, [...base, 'up', '-d', '--remove-orphans']);
  ok('Stack started: postgres-global, postgres-tenant, backup-*, app.');
}

async function waitForDbs(env, compose) {
  step(4, 'Waiting for Postgres clusters to be ready');
  await waitForComposeHealth(compose.bin, compose.base, { timeoutMs: 120_000 });
  ok('Both Postgres containers report healthy.');
  // Stronger check: the migrate role can actually authenticate. Init scripts
  // (CREATE ROLE …) may still be running right after the container is "healthy".
  await waitForPg(env, 90_000);
  ok('Authenticated against global + tenant DBs.');
}

async function migrate(compose) {
  step(5, 'Applying migrations (global + all tenant DBs)');
  // Runs inside the app container, which has node_modules + the bind-mounted
  // source + the env vars composed into the `app` service.
  await run(compose.bin, [
    ...compose.base,
    'exec',
    '-T',
    'app',
    'pnpm',
    'db:migrate',
  ]);
  ok('Migrations applied.');
}

async function seedAdmin(compose) {
  step(6, 'Seeding the platform admin');
  await run(compose.bin, [...compose.base, 'exec', '-T', 'app', 'pnpm', 'seed']);
  ok('Platform admin ready (created or password rotated to match SEED_ADMIN_*).');
}

async function provisionSampleTenant(env, compose) {
  step(7, 'Provisioning sample tenant "Acme"');
  const { subdomain } = SAMPLE_TENANT;
  if (await sampleTenantExists(env, subdomain)) {
    ok(`Tenant "${subdomain}" already exists — skipping (idempotent).`);
    return;
  }
  await run(compose.bin, [
    ...compose.base,
    'exec',
    '-T',
    'app',
    'pnpm',
    'provision:tenant',
    '--',
    '--name',
    SAMPLE_TENANT.name,
    '--subdomain',
    SAMPLE_TENANT.subdomain,
    '--email',
    SAMPLE_TENANT.email,
    '--password',
    SAMPLE_TENANT.password,
  ]);
  ok(`Tenant "${subdomain}" provisioned + migrated.`);
}

function printNextSteps(env) {
  const base = env.BASE_DOMAIN ?? 'simisolutions.localhost';
  const port = env.PORT ?? '3000';
  const adminEmail = env.SEED_ADMIN_EMAIL ?? 'admin@simisolutions.localhost';
  const adminPass = env.SEED_ADMIN_PASSWORD ?? 'change-me-please';
  const apex = `http://${base}:${port}`;
  const tenantHost = `http://${SAMPLE_TENANT.subdomain}.${base}:${port}`;

  step('✓', 'Setup complete');
  log('');
  log(`${COLOR.bold}Stack${COLOR.reset}`);
  log(`  Admin host : ${apex}`);
  log(`  Tenant host: ${tenantHost}  (Acme)`);
  log(`  Logs       : docker compose logs -f app`);
  log('');
  log(`${COLOR.bold}1) Log in as platform admin${COLOR.reset}`);
  log(`  ${COLOR.dim}# → copy "accessToken"${COLOR.reset}`);
  log(`  curl -X POST ${apex}/auth/login \\`);
  log(`    -H 'Content-Type: application/json' \\`);
  log(`    -d '{"email":"${adminEmail}","password":"${adminPass}"}'`);
  log('');
  log(`${COLOR.bold}2) Log in as the Acme owner${COLOR.reset}`);
  log(`  curl -X POST ${tenantHost}/auth/login \\`);
  log(`    -H 'Content-Type: application/json' \\`);
  log(`    -d '{"email":"${SAMPLE_TENANT.email}","password":"${SAMPLE_TENANT.password}"}'`);
  log('');
  log(`${COLOR.bold}3) Try the sample tenant resource${COLOR.reset}`);
  log(`  ${COLOR.dim}# with the Acme accessToken:${COLOR.reset}`);
  log(`  curl ${tenantHost}/accounts -H "Authorization: Bearer <TENANT_TOKEN>"`);
  log('');
  log(`${COLOR.dim}Re-run ${COLOR.reset}pnpm setup${COLOR.dim} any time — every step is idempotent.${COLOR.reset}`);
  log('');
}

// ---------------------------------------------------------------------------
async function main() {
  log(`${COLOR.bold}${COLOR.cyan}Simi backend — dev setup${COLOR.reset}`);

  const env = readEnv();
  await ensureEnv();
  const envAfter = readEnv();

  const compose = await checkPrereqs();
  await bringUpStack(compose);
  await waitForDbs(envAfter, compose);
  await migrate(compose);
  await seedAdmin(compose);
  await provisionSampleTenant(envAfter, compose);

  printNextSteps(envAfter);
}

main().catch((err) => {
  fail(err?.message ?? String(err));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
