import { describe, expect, it } from 'vitest';
import { domainPart, isValidAddress, localPart, normalizeAddress } from './address.js';

describe('normalizeAddress', () => {
  it('extracts the address from a display-name form', () => {
    expect(normalizeAddress('Alice Smith <Alice@Example.COM>')).toBe('alice@example.com');
  });

  it('lowercases and trims a bare address', () => {
    expect(normalizeAddress('  Bob@DriveOSX.com  ')).toBe('bob@driveosx.com');
  });

  it('returns an empty string for non-string input', () => {
    expect(normalizeAddress(undefined)).toBe('');
    expect(normalizeAddress(null)).toBe('');
    expect(normalizeAddress(42)).toBe('');
  });
});

describe('localPart and domainPart', () => {
  it('splits an address at the @', () => {
    expect(localPart('Bob <bob@driveosx.com>')).toBe('bob');
    expect(domainPart('Bob <bob@driveosx.com>')).toBe('driveosx.com');
  });

  it('treats a bare username as having no domain', () => {
    expect(localPart('bob')).toBe('bob');
    expect(domainPart('bob')).toBe('');
  });
});

describe('isValidAddress', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidAddress('user@driveosx.com')).toBe(true);
    expect(isValidAddress('First Last <user.name+tag@sub.example.org>')).toBe(true);
  });

  it('rejects addresses that cannot be delivered', () => {
    expect(isValidAddress('not-an-address')).toBe(false);
    expect(isValidAddress('user@localhost')).toBe(false);
    expect(isValidAddress('user@@example.com')).toBe(false);
    expect(isValidAddress('')).toBe(false);
  });
});
