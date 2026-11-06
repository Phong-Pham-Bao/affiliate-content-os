import util from 'node:util';

export function isProxySafe(value: unknown): boolean {
  try {
    return util.types.isProxy(value);
  } catch {
    return true;
  }
}

export function hasProxyInPrototype(obj: object): boolean {
  if (isProxySafe(obj)) return true;
  let current: object | null = obj;
  let depth = 0;
  while (current !== null && depth < 10) {
    if (isProxySafe(current)) return true;
    try {
      current = Object.getPrototypeOf(current);
    } catch {
      return true;
    }
    depth++;
  }
  return false;
}
