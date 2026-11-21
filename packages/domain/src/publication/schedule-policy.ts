import { validateIanaTimezone } from '../validation.js';
import { parseIsoTimestamp } from '../timestamps.js';
import type { ScheduleFacts } from './types.js';
import { PublicationScheduleInvalidError } from './errors.js';

export interface ValidateScheduleTripleOptions {
  readonly now?: Date | undefined;
  readonly minLeadTimeSeconds?: number | undefined;
  readonly maxHorizonDays?: number | undefined;
}

const LOCAL_TIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?$/;

export function formatUtcToLocalTime(utcDate: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(utcDate);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}`;
}

export function validateScheduleTriple(
  input: {
    readonly scheduledAtUtc: unknown;
    readonly originalLocalTime: unknown;
    readonly timezone: unknown;
  },
  options?: ValidateScheduleTripleOptions,
): ScheduleFacts {
  if (typeof input.timezone !== 'string') {
    throw new PublicationScheduleInvalidError(
      'INVALID_TIMEZONE',
      'Timezone must be a valid IANA timezone string',
    );
  }
  let canonicalTz: string;
  try {
    canonicalTz = validateIanaTimezone(input.timezone);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid IANA timezone';
    throw new PublicationScheduleInvalidError('INVALID_TIMEZONE', msg);
  }

  if (typeof input.originalLocalTime !== 'string') {
    throw new PublicationScheduleInvalidError(
      'INVALID_LOCAL_TIME',
      'originalLocalTime must be an offset-free ISO string (YYYY-MM-DDTHH:mm:ss)',
    );
  }
  const rawLocal = input.originalLocalTime.trim();
  if (!LOCAL_TIME_REGEX.test(rawLocal)) {
    throw new PublicationScheduleInvalidError(
      'INVALID_LOCAL_TIME',
      'originalLocalTime must match YYYY-MM-DDTHH:mm:ss format',
    );
  }

  let isoUtc: ReturnType<typeof parseIsoTimestamp>;
  try {
    isoUtc = parseIsoTimestamp(input.scheduledAtUtc);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid UTC instant';
    throw new PublicationScheduleInvalidError('INVALID_UTC_INSTANT', msg);
  }

  const utcDate = new Date(isoUtc);

  // Round-trip check: format UTC instant in timezone and compare to local time
  const localFormatted = formatUtcToLocalTime(utcDate, canonicalTz);
  const localNoMs = rawLocal.split('.')[0]!;
  if (localFormatted !== localNoMs) {
    throw new PublicationScheduleInvalidError(
      'SCHEDULE_TRIPLE_MISMATCH',
      `The schedule triple does not round-trip: ${isoUtc} in timezone ${canonicalTz} evaluates to ${localFormatted}, but expected ${localNoMs}`,
    );
  }

  // Bounds checks
  const now = options?.now ?? new Date();
  const minLeadTimeMs = (options?.minLeadTimeSeconds ?? 60) * 1000;
  const maxHorizonMs = (options?.maxHorizonDays ?? 90) * 24 * 60 * 60 * 1000;
  const scheduledMs = utcDate.getTime();
  const nowMs = now.getTime();

  if (scheduledMs <= nowMs) {
    throw new PublicationScheduleInvalidError(
      'SCHEDULE_PAST',
      `Scheduled instant ${isoUtc} is in the past`,
    );
  }

  if (scheduledMs < nowMs + minLeadTimeMs) {
    throw new PublicationScheduleInvalidError(
      'SCHEDULE_TOO_SOON',
      `Scheduled instant ${isoUtc} is too soon; minimum lead time is ${Math.round(minLeadTimeMs / 1000)} seconds`,
    );
  }

  if (scheduledMs > nowMs + maxHorizonMs) {
    throw new PublicationScheduleInvalidError(
      'SCHEDULE_EXCESSIVE_HORIZON',
      `Scheduled instant ${isoUtc} exceeds the maximum schedule horizon of ${Math.round(maxHorizonMs / (24 * 60 * 60 * 1000))} days`,
    );
  }

  return {
    scheduledAtUtc: isoUtc,
    originalLocalTime: rawLocal,
    timezone: canonicalTz,
  };
}
