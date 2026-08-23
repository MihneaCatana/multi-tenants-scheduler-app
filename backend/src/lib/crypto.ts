import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Password hashing (Argon2id) and token hashing helpers.
 *
 * - Passwords use Argon2id via @node-rs/argon2 (native, no node-gyp).
 * - Refresh/opaque tokens are stored hashed with SHA-256 so a DB leak does not
 *   yield usable tokens.
 */

const ARGON2_OPTIONS = {
  algorithm: 2 as const, // Algorithm.Argon2id (const enum not usable with verbatimModuleSyntax)
  memoryCost: 19456, // ~19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hashed: string,
  password: string,
): Promise<boolean> {
  // `verify` returns false on a bad password and never throws for that case.
  return verify(hashed, password);
}

/** Generate a URL-safe opaque token of `bytes` random bytes. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hash a token for safe storage. Returns hex. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time string comparison for tokens/hashes of equal length. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return aBuf.equals(bBuf) && aBuf.length > 0;
}
