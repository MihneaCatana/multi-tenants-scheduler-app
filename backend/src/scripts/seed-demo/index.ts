/**
 * Demo seed CLI router.
 *
 * Usage:
 *   pnpm seed:demo -- --scenario clinic   (or salon / logistics)
 *   pnpm seed:demo:clinic                  (shortcut)
 *   pnpm seed:demo:salon
 *   pnpm seed:demo:logistics
 */

const args = process.argv.slice(2);
const scenario = args.find((a) => a.startsWith('--scenario='))?.split('=')[1];

switch (scenario) {
  case 'clinic':
    await import('./medical-clinic.js');
    break;
  case 'salon':
    await import('./hairstylist.js');
    break;
  case 'logistics':
    await import('./logistics.js');
    break;
  default:
    console.log(`
  🌱 Simi Demo Seed Scripts

  Usage:
    pnpm seed:demo -- --scenario <scenario> --subdomain <subdomain> --password <pass>

  Scenarios:
    clinic     Medical / Dental Clinic (7 resources, 6 services, 15 clients, 25 appts)
    salon      Hair Salon / Barber      (8 resources, 7 services, 12 clients, 20 appts)
    logistics  Delivery / Logistics Hub  (8 resources, 6 services, 10 clients, 18 appts)

  Shortcuts:
    pnpm seed:demo:clinic    -- --subdomain acme --password mypass
    pnpm seed:demo:salon     -- --subdomain acme --password mypass
    pnpm seed:demo:logistics -- --subdomain acme --password mypass

  Required options:
    --subdomain    Tenant subdomain to seed
    --password     Staff login password

  Optional:
    --url          Backend base URL (default http://localhost:3000)
    --email        Staff login email (default owner@<subdomain>.com)
`);
    process.exit(0);
}
