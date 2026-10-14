import { createHmac } from 'node:crypto';

// No 0/O, 1/I/L or U, so the code is easy to copy by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/**
 * The code a member puts on their Chess.com profile to prove they control it.
 *
 * It is an HMAC of (member, username) under the server secret, so it needs no
 * storage, is the same every time the member asks, and can't be computed by
 * anyone else. A code issued to one member is useless to another.
 */
export function verificationCode(secret: string, memberId: string, username: string): string {
  const digest = createHmac('sha256', secret).update(`chess-link:${memberId}:${username.toLowerCase()}`).digest();
  let code = '';
  for (let i = 0; i < 6; i++) code += ALPHABET[digest[i]! % ALPHABET.length];
  return `IITR-${code}`;
}

/** True when the code appears in the profile's Location or Name field (case-insensitive). */
export function profileShowsCode(profile: { location?: string | null; name?: string | null }, code: string): boolean {
  const target = code.toUpperCase();
  return [profile.location, profile.name].some((field) => field?.toUpperCase().includes(target) ?? false);
}
