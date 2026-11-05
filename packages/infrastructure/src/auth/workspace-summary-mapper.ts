import { isValidUuidV7 } from '@affiliate-content-os/domain';
import { DatabaseError } from '../database/errors.js';
import { isProxySafe } from './mapper-helpers.js';

export interface WorkspaceSummaryRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly timezone: string;
  readonly role: 'owner' | 'editor' | 'viewer';
}

const REQUIRED_WORKSPACE_SUMMARY_ROW_KEYS = ['id', 'name', 'slug', 'timezone', 'role'] as const;

export function mapWorkspaceSummaryRow(rawRow: unknown): WorkspaceSummaryRow {
  if (typeof rawRow !== 'object' || rawRow === null || isProxySafe(rawRow)) {
    throw new DatabaseError('Failed to map workspace summary row');
  }
  const proto = Object.getPrototypeOf(rawRow);
  if (proto !== Object.prototype && proto !== null) {
    throw new DatabaseError('Failed to map workspace summary row');
  }

  const ownKeys = Reflect.ownKeys(rawRow);
  if (ownKeys.length !== REQUIRED_WORKSPACE_SUMMARY_ROW_KEYS.length) {
    throw new DatabaseError('Failed to map workspace summary row');
  }

  const values: Record<string, unknown> = Object.create(null);
  for (const key of REQUIRED_WORKSPACE_SUMMARY_ROW_KEYS) {
    const desc = Object.getOwnPropertyDescriptor(rawRow, key);
    if (!desc || desc.get !== undefined || desc.set !== undefined) {
      throw new DatabaseError('Failed to map workspace summary row');
    }
    values[key] = desc.value;
  }

  const id = values['id'];
  if (typeof id !== 'string' || !isValidUuidV7(id)) {
    throw new DatabaseError('Failed to map workspace summary row');
  }

  const name = values['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    throw new DatabaseError('Failed to map workspace summary row');
  }

  const slug = values['slug'];
  if (typeof slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    throw new DatabaseError('Failed to map workspace summary row');
  }

  const timezone = values['timezone'];
  if (typeof timezone !== 'string' || timezone.trim() === '') {
    throw new DatabaseError('Failed to map workspace summary row');
  }

  const role = values['role'];
  if (role !== 'owner' && role !== 'editor' && role !== 'viewer') {
    throw new DatabaseError('Failed to map workspace summary row');
  }

  return Object.freeze({
    id,
    name,
    slug,
    timezone,
    role,
  });
}
