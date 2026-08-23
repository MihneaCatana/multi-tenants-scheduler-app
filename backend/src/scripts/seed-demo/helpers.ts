/**
 * Shared helpers for demo seed scripts.
 *
 * Authenticates against the running backend via REST API and provides
 * typed helpers for creating clients, resources, services, and appointments.
 *
 * CLI flags:
 *   --url           Backend base URL  (default: http://localhost:3000)
 *   --base-domain   Domain for Host header (default: BASE_DOMAIN from .env)
 *   --subdomain     Tenant subdomain  (required)
 *   --email         Staff login email (default: owner@<subdomain>.com)
 *   --password      Staff login password (required)
 *
 * The fetch URL must be DNS-resolvable (e.g. localhost:3000).
 * The Host header uses BASE_DOMAIN so the backend routes to the right tenant.
 */
import http from 'node:http';
import { env } from '../../config/env.js';

/* -------------------------------------------------------------------------- */
/*  CLI helpers                                                                */
/* -------------------------------------------------------------------------- */

export function parseArg(argv: string[], key: string): string | undefined {
  const i = argv.indexOf(`--${key}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export interface SeedConfig {
  baseUrl: string;
  host: string;
  email: string;
  password: string;
}

export function parseConfig(argv: string[]): SeedConfig {
  const baseUrl = parseArg(argv, 'url') ?? 'http://localhost:3000';
  const subdomain = parseArg(argv, 'subdomain');
  if (!subdomain) {
    console.error('Missing --subdomain. Usage: --subdomain acme --password mypass');
    process.exit(1);
  }
  const password = parseArg(argv, 'password');
  if (!password) {
    console.error('Missing --password. Usage: --subdomain acme --password mypass');
    process.exit(1);
  }
  const email = parseArg(argv, 'email') ?? `owner@${subdomain}.com`;

  // Host header uses BASE_DOMAIN (from .env) so the backend resolves the tenant.
  // The fetch URL stays DNS-resolvable (localhost:3000).
  const baseDomain = parseArg(argv, 'base-domain') ?? env.BASE_DOMAIN;
  const urlObj = new URL(baseUrl);
  const host = `${subdomain}.${baseDomain}` + (urlObj.port ? `:${urlObj.port}` : '');

  return { baseUrl, host, email, password };
}

/* -------------------------------------------------------------------------- */
/*  HTTP helpers                                                               */
/* -------------------------------------------------------------------------- */

let accessToken: string | undefined;

async function request(
  config: SeedConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = new URL(path, config.baseUrl);

  const headers: http.OutgoingHttpHeaders = {
    Host: config.host,
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const bodyStr = body ? JSON.stringify(body) : undefined;

  console.log(`    → ${method} ${url.hostname}:${url.port || '80'}${url.pathname} [Host: ${config.host}]`);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let data: unknown;
          try {
            data = text ? JSON.parse(text) : undefined;
          } catch {
            data = text;
          }
          resolve({ status: res.statusCode ?? 0, data });
        });
      },
    );

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/* -------------------------------------------------------------------------- */
/*  Auth                                                                       */
/* -------------------------------------------------------------------------- */

export async function login(config: SeedConfig): Promise<void> {
  const { status, data } = await request(config, 'POST', '/v1/auth/login', {
    email: config.email,
    password: config.password,
  });

  if (status !== 200) {
    console.error(`Login failed (${status}):`, data);
    process.exit(1);
  }

  const body = data as Record<string, unknown>;
  accessToken = body.accessToken as string;
  console.log(`  ✓ Authenticated as ${config.email}`);
}

/* -------------------------------------------------------------------------- */
/*  API helpers (idempotent — skip if already exists)                           */
/* -------------------------------------------------------------------------- */

/** List active staff members. */
export async function listActiveStaff(config: SeedConfig): Promise<Array<{ id: string; email: string; firstName: string | null; lastName: string | null }>> {
  const { status, data } = await request(config, 'GET', '/v1/staff?status=active&limit=100');
  if (status !== 200) {
    throw new Error(`List staff failed (${status}): ${JSON.stringify(data)}`);
  }
  return (data as Record<string, unknown>).staff as Array<{ id: string; email: string; firstName: string | null; lastName: string | null }>;
}

/** List all clients. */
async function listClients(config: SeedConfig): Promise<Array<{ id: string; email: string; name: string }>> {
  const { status, data } = await request(config, 'GET', '/v1/clients?limit=1000');
  if (status !== 200) {
    throw new Error(`List clients failed (${status}): ${JSON.stringify(data)}`);
  }
  return (data as Record<string, unknown>).clients as Array<{ id: string; email: string; name: string }>;
}

/** List all resources. */
async function listResources(config: SeedConfig): Promise<Array<{ id: string; name: string; type: string }>> {
  const { status, data } = await request(config, 'GET', '/v1/resources?limit=1000');
  if (status !== 200) {
    throw new Error(`List resources failed (${status}): ${JSON.stringify(data)}`);
  }
  return (data as Record<string, unknown>).resources as Array<{ id: string; name: string; type: string }>;
}

/** List all services. */
async function listServices(config: SeedConfig): Promise<Array<{ id: string; name: string }>> {
  const { status, data } = await request(config, 'GET', '/v1/services?limit=1000');
  if (status !== 200) {
    throw new Error(`List services failed (${status}): ${JSON.stringify(data)}`);
  }
  return (data as Record<string, unknown>).services as Array<{ id: string; name: string }>;
}

/** Create a client. Skips if a client with the same email already exists. */
export async function createClient(
  config: SeedConfig,
  params: { name: string; email?: string; phone?: string; notes?: string },
): Promise<string> {
  const existing = await listClients(config);
  const match = params.email ? existing.find((c) => c.email === params.email) : undefined;
  if (match) {
    console.log(`    ⊘ Client "${params.name}" already exists (skipping)`);
    return match.id;
  }

  const { status, data } = await request(config, 'POST', '/v1/clients', params);
  if (status !== 201) {
    throw new Error(`Create client failed (${status}): ${JSON.stringify(data)}`);
  }
  return (data as Record<string, unknown>).id as string;
}

/** Create a resource. Skips if a resource with the same name already exists. */
export async function createResource(
  config: SeedConfig,
  params: { name: string; type: 'provider' | 'room' | 'equipment' | 'chair'; linkedStaffId?: string; color?: string; notes?: string },
): Promise<string> {
  const existing = await listResources(config);
  const match = existing.find((r) => r.name === params.name);
  if (match) {
    console.log(`    ⊘ Resource "${params.name}" already exists (skipping)`);
    return match.id;
  }

  const { status, data } = await request(config, 'POST', '/v1/resources', params);
  if (status !== 201) {
    throw new Error(`Create resource failed (${status}): ${JSON.stringify(data)}`);
  }
  return (data as Record<string, unknown>).id as string;
}

/** Create a service. Skips if a service with the same name already exists. */
export async function createService(
  config: SeedConfig,
  params: { name: string; durationMinutes: number; bufferBeforeMinutes?: number; bufferAfterMinutes?: number; price?: number; description?: string; category?: string },
): Promise<string> {
  const existing = await listServices(config);
  const match = existing.find((s) => s.name === params.name);
  if (match) {
    console.log(`    ⊘ Service "${params.name}" already exists (skipping)`);
    return match.id;
  }

  const { status, data } = await request(config, 'POST', '/v1/services', params);
  if (status !== 201) {
    throw new Error(`Create service failed (${status}): ${JSON.stringify(data)}`);
  }
  return (data as Record<string, unknown>).id as string;
}

/** Create an appointment. Returns the appointment id. */
export async function createAppointment(
  config: SeedConfig,
  params: {
    clientId: string;
    resourceId: string;
    serviceIds?: string[];
    startAt: string;
    durationMinutes?: number;
    summary?: string;
    notes?: string;
  },
): Promise<string> {
  const { status, data } = await request(config, 'POST', '/v1/appointments', params);
  if (status !== 201) {
    throw new Error(`Create appointment failed (${status}): ${JSON.stringify(data)}`);
  }
  return (data as Record<string, unknown>).id as string;
}

/** Apply a status transition to an appointment via PATCH. */
export async function patchAppointment(
  config: SeedConfig,
  appointmentId: string,
  action: { action: string; note?: string; reason?: string },
): Promise<void> {
  const { status, data } = await request(config, 'PATCH', `/v1/appointments/${appointmentId}`, action);
  if (status !== 204) {
    throw new Error(`Patch appointment failed (${status}): ${JSON.stringify(data)}`);
  }
}

/* -------------------------------------------------------------------------- */
/*  Data helpers                                                               */
/* -------------------------------------------------------------------------- */

/** Build an ISO 8601 string for a specific time, offset from today by dayOffset days. */
export function dateAt(
  hour: number,
  minute: number,
  dayOffset: number = 0,
): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** Monday=1 … Sunday=7 (ISO). Offset from today. */
function dayOfWeek(): number {
  const d = new Date().getDay();
  return d === 0 ? 7 : d; // convert 0=Sun to 7
}

/**
 * Offset from today to get to Monday of the current week.
 * Returns a value such that `today + mondayOffset()` lands on Monday.
 */
export function mondayOffset(): number {
  const dow = dayOfWeek();
  return 1 - dow;
}
