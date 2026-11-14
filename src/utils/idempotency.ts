import crypto from 'crypto';
import { ValidationError } from './errors';

/**
 * Recursively canonicalizes an object or value:
 * - Sorts object keys alphabetically
 * - Converts BigInt to string
 * - Converts Date to ISO string
 * - Processes array elements recursively
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize(obj[key]);
    }
    return result;
  }
  return value;
}

/**
 * Computes a SHA-256 hash of the canonical request representation:
 * { method, path, body }
 */
export function computeRequestHash(
  method: string,
  path: string,
  body: unknown
): string {
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = path.toLowerCase().replace(/\/+$/, '');
  const canonicalBody = canonicalize(body);

  const payload = JSON.stringify({
    method: normalizedMethod,
    path: normalizedPath,
    body: canonicalBody,
  });

  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Validates and extracts the Idempotency-Key header.
 */
export function extractIdempotencyKey(keyHeader: string | string[] | undefined): string {
  if (!keyHeader) {
    throw new ValidationError('Idempotency-Key header is required');
  }

  const rawKey = Array.isArray(keyHeader) ? keyHeader[0] : keyHeader;
  const trimmed = rawKey ? rawKey.trim() : '';

  if (!trimmed) {
    throw new ValidationError('Idempotency-Key header cannot be empty');
  }

  if (trimmed.length > 255) {
    throw new ValidationError('Idempotency-Key header exceeds maximum length of 255 characters');
  }

  return trimmed;
}
