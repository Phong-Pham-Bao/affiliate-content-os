import { describe, expect, it } from 'vitest';
import {
  resolveClientBrowserTimezone,
  shouldUpdateBrowserTimezone,
} from '../src/lib/timezone-helper.js';

describe('timezone-helper', () => {
  it('shouldUpdateBrowserTimezone returns false if manually edited', () => {
    expect(shouldUpdateBrowserTimezone(true, 'UTC', 'America/New_York')).toBe(false);
  });

  it('shouldUpdateBrowserTimezone returns false if detected is null', () => {
    expect(shouldUpdateBrowserTimezone(false, 'UTC', null)).toBe(false);
  });

  it('shouldUpdateBrowserTimezone returns false if detected matches current', () => {
    expect(shouldUpdateBrowserTimezone(false, 'Europe/London', 'Europe/London')).toBe(false);
  });

  it('shouldUpdateBrowserTimezone returns true if unedited and detected differs', () => {
    expect(shouldUpdateBrowserTimezone(false, 'UTC', 'Asia/Tokyo')).toBe(true);
  });

  it('resolveClientBrowserTimezone returns a string or null', () => {
    const tz = resolveClientBrowserTimezone();
    if (tz !== null) {
      expect(typeof tz).toBe('string');
      expect(tz.length).toBeGreaterThan(0);
    }
  });
});
