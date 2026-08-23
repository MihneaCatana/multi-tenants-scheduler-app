import { describe, it, expect } from 'vitest';
import { getErrorKey } from './errors';

describe('getErrorKey', () => {
  it('maps INVALID_CREDENTIALS to the correct key', () => {
    expect(getErrorKey('INVALID_CREDENTIALS')).toBe('error_invalidCredentials');
  });

  it('maps WRONG_PASSWORD to the correct key', () => {
    expect(getErrorKey('WRONG_PASSWORD')).toBe('error_wrongPassword');
  });

  it('maps TOKEN_REUSE_DETECTED to the correct key', () => {
    expect(getErrorKey('TOKEN_REUSE_DETECTED')).toBe('error_tokenReuseDetected');
  });

  it('maps TOKEN_EXPIRED to the correct key', () => {
    expect(getErrorKey('TOKEN_EXPIRED')).toBe('error_tokenExpired');
  });

  it('maps SUBDOMAIN_TAKEN to the correct key', () => {
    expect(getErrorKey('SUBDOMAIN_TAKEN')).toBe('error_subdomainTaken');
  });

  it('maps STAFF_NOT_FOUND to the correct key', () => {
    expect(getErrorKey('STAFF_NOT_FOUND')).toBe('error_staffNotFound');
  });

  it('maps CLIENT_NOT_FOUND to the correct key', () => {
    expect(getErrorKey('CLIENT_NOT_FOUND')).toBe('error_clientNotFound');
  });

  it('maps Zod TOO_SHORT to the correct key', () => {
    expect(getErrorKey('TOO_SHORT')).toBe('error_tooShort');
  });

  it('maps Zod INVALID_EMAIL to the correct key', () => {
    expect(getErrorKey('INVALID_EMAIL')).toBe('error_invalidEmail');
  });

  it('maps INTERNAL to the correct key', () => {
    expect(getErrorKey('INTERNAL')).toBe('error_internal');
  });

  it('maps ALREADY_DELETED to the correct key', () => {
    expect(getErrorKey('ALREADY_DELETED')).toBe('error_alreadyDeleted');
  });

  it('returns error_unknown for an unmapped code', () => {
    expect(getErrorKey('SOME_RANDOM_CODE')).toBe('error_unknown');
  });

  it('returns error_unknown for an empty string', () => {
    expect(getErrorKey('')).toBe('error_unknown');
  });

  it('maps all generic HTTP error codes', () => {
    expect(getErrorKey('BAD_REQUEST')).toBe('error_badRequest');
    expect(getErrorKey('UNAUTHORIZED')).toBe('error_unauthorized');
    expect(getErrorKey('FORBIDDEN')).toBe('error_forbidden');
    expect(getErrorKey('NOT_FOUND')).toBe('error_notFound');
    expect(getErrorKey('VALIDATION_ERROR')).toBe('error_validationError');
    expect(getErrorKey('CONFLICT')).toBe('error_conflict');
    expect(getErrorKey('TOO_MANY_REQUESTS')).toBe('error_tooManyRequests');
  });
});
