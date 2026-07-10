import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAddress } from '../src/mail/utils.js';

test('normalizeAddress extracts the address from a display name wrapper', () => {
  assert.equal(normalizeAddress('Drive OSX <ops@driveosx.local>'), 'ops@driveosx.local');
});

test('normalizeAddress trims whitespace and lowercases the address', () => {
  assert.equal(normalizeAddress('  Admin@DriveOSX.Local  '), 'admin@driveosx.local');
});
