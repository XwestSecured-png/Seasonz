import { createHmac, timingSafeEqual, randomBytes, scryptSync } from "crypto";

const COOKIE_NAME = "seasonz_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_KEYLEN = 64;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not set. Add it to .env.local (or your hosting provider's env vars)."
    );
  }
  return secret;
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

/** Builds the signed cookie value for a freshly logged-in session, tied to one user. */
export function createSessionToken(userId: number): string {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${expires}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

/** Verifies a session cookie value. Returns the signed-in user's id only if unexpired and the signature matches. */
export function verifySessionToken(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userIdStr, expiresStr, sig] = parts;
  const payload = `${userIdStr}.${expiresStr}`;

  const expected = sign(payload);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return null;

  const userId = Number(userIdStr);
  if (!Number.isFinite(userId)) return null;

  return userId;
}

/** Hashes a new password for storage (users.passwordHash) — random salt + scrypt, stored as "salt:hash" hex. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

/** Constant-time check of a submitted password against a stored users.passwordHash value. */
export function verifyPasswordHash(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const candidateBuf = scryptSync(password, salt, SCRYPT_KEYLEN);
  if (hashBuf.length !== candidateBuf.length) return false;
  return timingSafeEqual(hashBuf, candidateBuf);
}

/**
 * Constant-time check of a submitted code against APP_PASSWORD — an
 * optional master invite code. Seasonz's normal invite codes are the
 * per-platform lists in lib/invite-codes.ts; leave APP_PASSWORD blank to
 * accept only those.
 */
export function checkInviteCode(submitted: string): boolean {
  const expected = process.env.APP_PASSWORD?.trim();
  if (!expected || !submitted) return false;
  const a = Buffer.from(submitted.trim());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export { COOKIE_NAME };
