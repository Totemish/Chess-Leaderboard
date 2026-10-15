import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInstituteEmail } from '../domain/institute';

const DOMAIN = 'iitr.ac.in';

test('institute emails: the domain itself and its department subdomains', () => {
  for (const email of ['name@iitr.ac.in', 'avneesh_ks@ece.iitr.ac.in', 'x@cs.iitr.ac.in', 'Mixed.Case@ME.IITR.AC.IN']) {
    assert.equal(isInstituteEmail(email, DOMAIN), true, email);
  }
});

test('look-alike and malformed addresses are rejected', () => {
  const rejected = [
    'x@gmail.com',
    'x@notiitr.ac.in', // ends with "iitr.ac.in", but it's a different domain
    'x@iitr.ac.in.example.com',
    '"x@iitr.ac.in"@example.com', // the domain is after the last "@"
    'iitr.ac.in',
    '@iitr.ac.in',
    '',
    null,
    undefined,
  ];
  for (const email of rejected) {
    assert.equal(isInstituteEmail(email, DOMAIN), false, String(email));
  }
});
