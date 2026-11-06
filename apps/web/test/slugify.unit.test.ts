import { describe, expect, it } from 'vitest';
import { isValidSlug, slugify } from '../src/lib/slugify.js';

describe('slugify utility', () => {
  it('converts mixed case and spaces to lowercase kebab-case', () => {
    expect(slugify('My Super Blog')).toBe('my-super-blog');
    expect(slugify('  Acme Content OS  ')).toBe('acme-content-os');
  });

  it('removes punctuation and special characters', () => {
    expect(slugify('Acme & Co. (Media)!')).toBe('acme-co-media');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('---hello---world---')).toBe('hello-world');
  });

  it('limits output to 64 characters', () => {
    const longName = 'a'.repeat(100);
    expect(slugify(longName).length).toBe(64);
  });

  it('validates valid slugs correctly', () => {
    expect(isValidSlug('my-workspace')).toBe(true);
    expect(isValidSlug('ws1')).toBe(true);
    expect(isValidSlug('a-b-c-123')).toBe(true);
  });

  it('rejects invalid slugs', () => {
    expect(isValidSlug('a')).toBe(false); // too short (< 2)
    expect(isValidSlug('-start-dash')).toBe(false);
    expect(isValidSlug('end-dash-')).toBe(false);
    expect(isValidSlug('Uppercase')).toBe(false);
    expect(isValidSlug('has spaces')).toBe(false);
    expect(isValidSlug('has--double-dash')).toBe(false);
    expect(isValidSlug('a'.repeat(65))).toBe(false); // too long (> 64)
  });
});
