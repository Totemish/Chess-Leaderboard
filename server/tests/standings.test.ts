import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, type GameRecord } from '../domain/standings';
import { profileShowsCode, verificationCode } from '../domain/ownership';

const game = (whiteId: string, blackId: string | null, result: 'white' | 'black' | 'draw' | 'pending'): GameRecord => ({
  whiteId,
  blackId,
  winnerId: result === 'white' ? whiteId : result === 'black' ? blackId : null,
  isDraw: result === 'draw',
  completed: result !== 'pending' || blackId === null,
});

test('scores count wins, draws and byes; pending games count for nothing', () => {
  const s = computeStandings(['a', 'b', 'c', 'd', 'e'], [
    game('a', 'b', 'white'),
    game('c', 'd', 'draw'),
    game('e', null, 'white'), // bye
    game('a', 'c', 'pending'),
  ]);
  assert.deepEqual([...s].map(([id, v]) => [id, v.score]), [['a', 1], ['b', 0], ['c', 0.5], ['d', 0.5], ['e', 1]]);
});

test('Buchholz is the sum of opponents’ scores; a bye counts as an opponent with your own score', () => {
  // Round 1: a beats b, c draws d, e has a bye. Round 2: a beats c, d beats e, b has a bye.
  const s = computeStandings(['a', 'b', 'c', 'd', 'e'], [
    game('a', 'b', 'white'),
    game('c', 'd', 'draw'),
    game('e', null, 'white'),
    game('a', 'c', 'white'),
    game('d', 'e', 'white'),
    game('b', null, 'white'),
  ]);
  // Scores: a 2, b 1, c 0.5, d 1.5, e 1.
  assert.equal(s.get('a')!.score, 2);
  assert.equal(s.get('a')!.buchholz, 1 + 0.5); // b + c
  assert.equal(s.get('b')!.buchholz, 2 + 1); // a + own score for the bye
  assert.equal(s.get('d')!.buchholz, 0.5 + 1); // c + e
  assert.equal(s.get('e')!.buchholz, 1 + 1.5); // own score for the bye + d
});

test('results are derived, so recomputing twice gives the same answer', () => {
  const games = [game('a', 'b', 'black'), game('a', null, 'white')];
  assert.deepEqual(computeStandings(['a', 'b'], games), computeStandings(['a', 'b'], games));
});

test('verification codes are stable, per member, and found case-insensitively', () => {
  const code = verificationCode('secret', 'google:1', 'MagnusCarlsen');
  assert.match(code, /^IITR-[A-Z2-9]{6}$/);
  assert.equal(code, verificationCode('secret', 'google:1', 'magnuscarlsen'));
  assert.notEqual(code, verificationCode('secret', 'google:2', 'magnuscarlsen'));
  assert.notEqual(code, verificationCode('other-secret', 'google:1', 'magnuscarlsen'));
  assert.ok(profileShowsCode({ location: `Roorkee ${code.toLowerCase()}` }, code));
  assert.ok(profileShowsCode({ name: code }, code));
  assert.ok(!profileShowsCode({ location: 'Roorkee' }, code));
  assert.ok(!profileShowsCode({}, code));
});
