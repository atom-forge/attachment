import { createHmac } from 'node:crypto';
import type { FocusHashFn } from '../types.js';

/**
 * The focus-hash function the image server checks manual-focus URLs with:
 * HMAC-SHA256 of the encoded focus with `focusSecret`, first 4 hex characters.
 * Pass it to `imgstat(focus, createFocusHash(secret))` so stored images get a valid `meta.img.ch`.
 * Server-only (uses node:crypto); use the same secret as `createImageServer({ focusSecret })`.
 */
export function createFocusHash(focusSecret: string): FocusHashFn {
	return (encodedFocus) => createHmac('sha256', focusSecret).update(encodedFocus).digest('hex').slice(0, 4);
}
