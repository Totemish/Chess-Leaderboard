import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSING_GRACE_MS, nextListing, NEW_LISTING, type Listing } from '../domain/player-status';

const now = new Date('2026-10-15T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 60 * 60 * 1000;

test('a found, open account stays listed', () => {
  assert.deepEqual(nextListing(NEW_LISTING, { found: true, accountStatus: 'premium' }, now), NEW_LISTING);
});

test('Chess.com closing the account hides the player at once', () => {
  assert.equal(nextListing(NEW_LISTING, { found: true, accountStatus: 'closed' }, now).status, 'CLOSED');
  assert.equal(
    nextListing(NEW_LISTING, { found: true, accountStatus: 'closed:fair_play_violations' }, now).status,
    'CLOSED_FAIR_PLAY'
  );
});

test('a missing account is hidden only after a day of misses', () => {
  const first = nextListing(NEW_LISTING, { found: false }, now);
  assert.deepEqual(first, { status: 'ACTIVE', missingSince: now }, 'the first miss only starts the clock');

  const almost: Listing = { status: 'ACTIVE', missingSince: ago(MISSING_GRACE_MS - HOUR) };
  assert.equal(nextListing(almost, { found: false }, now).status, 'ACTIVE');

  const overdue: Listing = { status: 'ACTIVE', missingSince: ago(MISSING_GRACE_MS) };
  assert.deepEqual(nextListing(overdue, { found: false }, now), { status: 'MISSING', missingSince: overdue.missingSince });
});

test('finding the account again resets the clock and brings automatic hides back', () => {
  const missing: Listing = { status: 'MISSING', missingSince: ago(3 * MISSING_GRACE_MS) };
  assert.deepEqual(nextListing(missing, { found: true, accountStatus: 'basic' }, now), NEW_LISTING);

  const reopened: Listing = { status: 'CLOSED', missingSince: null };
  assert.deepEqual(nextListing(reopened, { found: true, accountStatus: 'basic' }, now), NEW_LISTING);

  const blip: Listing = { status: 'ACTIVE', missingSince: ago(20 * HOUR) };
  assert.deepEqual(nextListing(blip, { found: true }, now), NEW_LISTING, 'one good answer forgives earlier misses');
});

test("an admin's removal survives syncs until the player is restored", () => {
  const removed: Listing = { status: 'REMOVED', missingSince: null };
  assert.equal(nextListing(removed, { found: true, accountStatus: 'premium' }, now).status, 'REMOVED');
  assert.equal(nextListing(removed, { found: false }, now).status, 'REMOVED');
  assert.equal(nextListing(removed, { found: true, accountStatus: 'premium' }, now, true).status, 'ACTIVE');
  assert.equal(nextListing(removed, { found: true, accountStatus: 'closed' }, now, true).status, 'CLOSED');
});
