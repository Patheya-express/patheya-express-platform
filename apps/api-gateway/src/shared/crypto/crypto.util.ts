import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

/**
 * Derives a stable 32-byte AES key from the configured secret. `scryptSync` is used purely as a
 * KDF here (not for password hashing) so the raw env var doesn't need to already be exactly
 * 32 bytes — any non-empty secret works.
 */
function deriveKey(secret: string): Buffer {
  return scryptSync(secret, 'patheya-express-bank-account', KEY_LENGTH);
}

/**
 * AES-256-GCM encrypt, returning `iv:authTag:ciphertext` as a single base64-segment string so
 * callers only need to persist one column. Used exclusively for restaurant bank account numbers
 * — see RestaurantBankAccountRepository. Throws if `secret` is empty rather than silently
 * encrypting with a weak/default key.
 */
export function encryptSecret(plaintext: string, secret: string): string {
  if (!secret) {
    throw new Error(
      'BANK_ACCOUNT_ENCRYPTION_KEY is not configured — cannot encrypt bank account data.',
    );
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/** Inverse of {@link encryptSecret}. Throws on a malformed payload or an authentication-tag
 *  mismatch (tampered/corrupted ciphertext) rather than returning garbage. */
export function decryptSecret(payload: string, secret: string): string {
  if (!secret) {
    throw new Error(
      'BANK_ACCOUNT_ENCRYPTION_KEY is not configured — cannot decrypt bank account data.',
    );
  }

  const [ivB64, authTagB64, ciphertextB64] = payload.split(':');

  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted payload.');
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    deriveKey(secret),
    Buffer.from(ivB64, 'base64'),
  );

  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

/** Last-4-digits display mask, e.g. for showing "••••1234" without ever exposing the full
 *  account number in an API response. */
export function maskLast4(value: string): string {
  return value.slice(-4);
}

/**
 * Deterministic SHA-256 hash for opaque, already-high-entropy tokens (refresh tokens,
 * password-reset tokens) that must be looked up by exact match but never stored in plaintext.
 * Unlike password hashing, no per-value salt is needed — the token itself is a long random
 * JWT/random string, not a low-entropy user-chosen secret, so this only needs to be one-way and
 * collision-resistant, not slow.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
