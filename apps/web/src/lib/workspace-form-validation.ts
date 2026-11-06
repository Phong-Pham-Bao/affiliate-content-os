import { isValidSlug } from './slugify.js';

export interface WorkspaceValidationErrors {
  readonly name?: string;
  readonly slug?: string;
}

export function validateWorkspaceForm(name: string, slug: string): WorkspaceValidationErrors {
  const errors: { name?: string; slug?: string } = {};
  if (!name.trim() || name.length > 100) {
    errors.name = 'Workspace name is required (max 100 characters).';
  }
  if (!isValidSlug(slug)) {
    errors.slug = 'Slug must be 2-64 lowercase alphanumeric chars and hyphens.';
  }
  return errors;
}
