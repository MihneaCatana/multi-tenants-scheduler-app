import { provisionTenant } from '../modules/tenants/provision.js';
import { closeGlobalDb } from '../db/client.js';
import { closeAllTenantPools } from '../db/tenant-pool.js';
import { logger } from '../lib/logger.js';

/**
 * CLI tenant provisioning — equivalent to `POST /admin/tenants` but runnable
 * without booting the HTTP server. Useful for bootstrapping the first tenant
 * right after migrations.
 *
 * Usage:
 *   pnpm provision:tenant -- --name "Acme Inc" --subdomain acme \
 *     --email owner@acme.com --password supersecret
 */
interface Args {
  name: string;
  subdomain: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (key: string): string | undefined => {
    const i = argv.indexOf(`--${key}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const name = get('name');
  const subdomain = get('subdomain');
  const email = get('email');
  const password = get('password');
  if (!name || !subdomain || !email || !password) {
    logger.error(
      'Usage: provision:tenant -- --name "Acme Inc" --subdomain acme --email owner@acme.com --password supersecret',
    );
    process.exit(1);
  }
  return {
    name,
    subdomain,
    email,
    password,
    firstName: get('firstName'),
    lastName: get('lastName'),
  };
}

const args = parseArgs(process.argv.slice(2));

provisionTenant({
  name: args.name,
  subdomain: args.subdomain,
  ownerEmail: args.email,
  ownerPassword: args.password,
  ownerFirstName: args.firstName,
  ownerLastName: args.lastName,
})
  .then(async (result) => {
    logger.info(
      { tenantId: result.tenant.id, subdomain: result.tenant.subdomain, ownerId: result.owner.id },
      '✓ Tenant provisioned.',
    );
    await closeAllTenantPools();
    await closeGlobalDb();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err }, 'Provisioning failed.');
    await closeAllTenantPools();
    await closeGlobalDb();
    process.exit(1);
  });
