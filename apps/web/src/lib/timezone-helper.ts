/**
 * Resolves the browser client timezone safely without crashing in restricted environments.
 */
export function resolveClientBrowserTimezone(): string | null {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (typeof tz === 'string' && tz.trim().length > 0) {
        return tz.trim();
      }
    }
  } catch {
    // Ignore environments without full Intl support
  }
  return null;
}

/**
 * Pure decision function for updating timezone post-mount.
 * Prevents hydration mismatch while ensuring user edits are never overwritten.
 */
export function shouldUpdateBrowserTimezone(
  hasUserEdited: boolean,
  currentTimezone: string,
  detectedTimezone: string | null,
): boolean {
  if (hasUserEdited || !detectedTimezone) {
    return false;
  }
  return currentTimezone !== detectedTimezone;
}
