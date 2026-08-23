/**
 * Unit tests for subdomain resolution helpers.
 */
import {
  getSubdomain,
  normalizeHost,
  isApexHost,
  isValidSubdomain,
  subdomainToDbName,
  subdomainToOwnerRole,
  subdomainToAppRole,
} from './subdomain.js';

// BASE_DOMAIN in .env.test is "test.localhost"

describe('normalizeHost', () => {
  it('strips port and trailing dot', () => {
    expect(normalizeHost('acme.test.localhost:3000')).toBe('acme.test.localhost');
    expect(normalizeHost('acme.test.localhost.')).toBe('acme.test.localhost');
    expect(normalizeHost('ACME.TEST.LOCALHOST:5173')).toBe('acme.test.localhost');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeHost(undefined)).toBe('');
  });
});

describe('getSubdomain', () => {
  it('extracts a valid single-label subdomain', () => {
    expect(getSubdomain('acme.test.localhost')).toBe('acme');
  });

  it('handles host with port', () => {
    expect(getSubdomain('acme.test.localhost:3000')).toBe('acme');
  });

  it('returns null for apex host', () => {
    expect(getSubdomain('test.localhost')).toBeNull();
  });

  it('returns null for completely unrelated host', () => {
    expect(getSubdomain('localhost')).toBeNull();
    expect(getSubdomain('example.com')).toBeNull();
  });

  it('returns null for multi-label subdomain', () => {
    expect(getSubdomain('foo.bar.test.localhost')).toBeNull();
  });

  it('returns null for undefined host', () => {
    expect(getSubdomain(undefined)).toBeNull();
  });

  it('normalizes case', () => {
    expect(getSubdomain('ACME.TEST.LOCALHOST')).toBe('acme');
  });
});

describe('isApexHost', () => {
  it('returns true for the base domain', () => {
    expect(isApexHost('test.localhost')).toBe(true);
  });

  it('returns true for unrelated hosts', () => {
    expect(isApexHost('localhost')).toBe(true);
  });

  it('returns false for subdomains', () => {
    expect(isApexHost('acme.test.localhost')).toBe(false);
  });
});

describe('isValidSubdomain', () => {
  it('accepts simple labels', () => {
    expect(isValidSubdomain('acme')).toBe(true);
    expect(isValidSubdomain('big-corp')).toBe(true);
    expect(isValidSubdomain('a1')).toBe(true);
  });

  it('rejects empty strings', () => {
    expect(isValidSubdomain('')).toBe(false);
  });

  it('rejects labels starting with hyphen', () => {
    expect(isValidSubdomain('-invalid')).toBe(false);
  });

  it('rejects labels ending with hyphen', () => {
    expect(isValidSubdomain('invalid-')).toBe(false);
  });

  it('rejects labels with dots', () => {
    expect(isValidSubdomain('foo.bar')).toBe(false);
  });

  it('rejects uppercase', () => {
    expect(isValidSubdomain('ACME')).toBe(false);
  });

  it('rejects oversized labels (64+ chars)', () => {
    expect(isValidSubdomain('a'.repeat(64))).toBe(false);
  });
});

describe('subdomainToDbName', () => {
  it('converts subdomain to tenant-prefixed DB name', () => {
    expect(subdomainToDbName('acme')).toBe('tenant_acme');
    expect(subdomainToDbName('big-corp')).toBe('tenant_big_corp');
  });
});

describe('subdomainToOwnerRole', () => {
  it('converts subdomain to owner role name', () => {
    expect(subdomainToOwnerRole('acme')).toBe('tenant_acme_owner');
    expect(subdomainToOwnerRole('big-corp')).toBe('tenant_big_corp_owner');
  });
});

describe('subdomainToAppRole', () => {
  it('converts subdomain to app role name', () => {
    expect(subdomainToAppRole('acme')).toBe('tenant_acme_app');
    expect(subdomainToAppRole('big-corp')).toBe('tenant_big_corp_app');
  });
});
