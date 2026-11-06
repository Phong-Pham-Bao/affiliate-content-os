import type { ApiProblemDetails } from '../types/web-state.js';

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ApiProblemDetails;

  constructor(status: number, problem: ApiProblemDetails) {
    super(problem.detail ?? problem.title ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }
}

export function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

export function hasExactOwnKeys(
  obj: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  if (Object.getOwnPropertySymbols(obj).length > 0) {
    return false;
  }
  const ownKeys = Object.getOwnPropertyNames(obj);
  if (ownKeys.length !== expectedKeys.length) {
    return false;
  }
  const set = new Set(expectedKeys);
  for (const k of ownKeys) {
    if (!set.has(k)) {
      return false;
    }
  }
  return true;
}

const UUIDV7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isValidUuidV7(val: unknown): val is string {
  return typeof val === 'string' && UUIDV7_REGEX.test(val);
}

const RFC3339_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getMaxDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

export function isValidRfc3339DateTime(val: unknown): val is string {
  if (typeof val !== 'string') {
    return false;
  }
  const match = RFC3339_REGEX.exec(val);
  if (!match) {
    return false;
  }

  const year = Number.parseInt(match[1]!, 10);
  const month = Number.parseInt(match[2]!, 10);
  const day = Number.parseInt(match[3]!, 10);
  const hour = Number.parseInt(match[4]!, 10);
  const minute = Number.parseInt(match[5]!, 10);
  const second = Number.parseInt(match[6]!, 10);

  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > getMaxDaysInMonth(year, month)) {
    return false;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return false;
  }

  if (match[8] !== undefined && match[9] !== undefined) {
    const offsetHour = Number.parseInt(match[8], 10);
    const offsetMinute = Number.parseInt(match[9], 10);
    if (offsetHour < 0 || offsetHour > 23 || offsetMinute < 0 || offsetMinute > 59) {
      return false;
    }
  }

  return !Number.isNaN(Date.parse(val));
}

const ERROR_ITEM_KEYS = ['path', 'message'] as const;

export function validateProblemDetails(
  data: unknown,
  defaultStatus: number,
  defaultStatusText?: string,
): ApiProblemDetails {
  if (!isPlainObject(data)) {
    return Object.freeze({
      status: defaultStatus,
      title: defaultStatusText || 'Request failed',
      detail: `Request failed with status ${defaultStatus}`,
    });
  }

  const problem: ApiProblemDetails = {
    status:
      typeof data.status === 'number' && Number.isInteger(data.status)
        ? data.status
        : defaultStatus,
    title:
      typeof data.title === 'string' && data.title.length <= 256
        ? data.title
        : defaultStatusText || 'Request failed',
    ...(typeof data.type === 'string' && data.type.length <= 2048 ? { type: data.type } : {}),
    ...(typeof data.code === 'string' && data.code.length <= 128 ? { code: data.code } : {}),
    ...(typeof data.detail === 'string' && data.detail.length <= 2048
      ? { detail: data.detail }
      : { detail: `Request failed with status ${defaultStatus}` }),
    ...(typeof data.instance === 'string' && data.instance.length <= 2048
      ? { instance: data.instance }
      : {}),
    ...(typeof data.requestId === 'string' && data.requestId.length <= 128
      ? { requestId: data.requestId }
      : {}),
    ...(Array.isArray(data.errors)
      ? {
          errors: data.errors
            .slice(0, 20)
            .filter(
              (e): e is { path: string; message: string } =>
                isPlainObject(e) &&
                hasExactOwnKeys(e, ERROR_ITEM_KEYS) &&
                typeof e.path === 'string' &&
                typeof e.message === 'string',
            )
            .map((e) => ({
              path: e.path.slice(0, 256),
              message: e.message.slice(0, 1024),
            })),
        }
      : {}),
  };

  return Object.freeze(problem);
}
