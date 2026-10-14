import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../src/domain/sha256.js';

test('JS sha256 matches node crypto for several sizes', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 70000]) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 0xff;
    assert.equal(sha256Hex(bytes), createHash('sha256').update(bytes).digest('hex'), 'size ' + n);
  }
  assert.equal(sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
