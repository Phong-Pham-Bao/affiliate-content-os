export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function isValidSlug(slug: string): boolean {
  if (slug.length < 2 || slug.length > 64) {
    return false;
  }
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
