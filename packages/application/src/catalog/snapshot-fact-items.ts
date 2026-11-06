import { ValidationError } from '../errors.js';
import {
  assertExactAllowedKeys,
  extractExactNullableString,
  extractExactString,
  isProxy,
} from './snapshot-property-extractors.js';

export interface ValidatedFactInput {
  readonly factKey: string;
  readonly valueText: string;
  readonly sourceType: string;
  readonly sourceUrl: string | null;
  readonly sourceExcerpt: string | null;
  readonly confidence: string;
  readonly claimUsage: string;
}

const FACT_ITEM_ALLOWED_KEYS = [
  'factKey',
  'valueText',
  'sourceType',
  'sourceUrl',
  'sourceExcerpt',
  'confidence',
  'claimUsage',
] as const;

export function snapshotFacts(raw: unknown): readonly ValidatedFactInput[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError('facts must be an array', 'facts');
  }
  if (isProxy(raw)) {
    throw new ValidationError('facts array must not be a proxy', 'facts');
  }
  if (Object.getPrototypeOf(raw) !== Array.prototype) {
    throw new ValidationError('facts array must have Array prototype', 'facts');
  }
  if (raw.length === 0 || raw.length > 100) {
    throw new ValidationError('facts must contain between 1 and 100 items', 'facts');
  }

  const ownKeys = Reflect.ownKeys(raw);
  for (const k of ownKeys) {
    if (k === 'length') continue;
    if (typeof k === 'symbol' || !/^\d+$/.test(k)) {
      throw new ValidationError(`Unexpected property "${String(k)}" on facts array`, 'facts');
    }
  }

  const snapped: ValidatedFactInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const itemDesc = Object.getOwnPropertyDescriptor(raw, i);
    if (!itemDesc || itemDesc.get !== undefined || itemDesc.set !== undefined) {
      throw new ValidationError(`Accessor detected at facts[${i}]`, `facts[${i}]`);
    }
    const item = itemDesc.value;
    const itemObj = assertExactAllowedKeys(item, FACT_ITEM_ALLOWED_KEYS, `facts[${i}]`);

    const factKey = extractExactString(itemObj, 'factKey', true)!;
    const valueText = extractExactString(itemObj, 'valueText', true)!;
    const sourceType = extractExactString(itemObj, 'sourceType', true)!;
    const sourceUrl = extractExactNullableString(itemObj, 'sourceUrl') ?? null;
    const sourceExcerpt = extractExactNullableString(itemObj, 'sourceExcerpt') ?? null;
    const confidence = extractExactString(itemObj, 'confidence', true)!;
    const claimUsage = extractExactString(itemObj, 'claimUsage', true)!;

    snapped.push(
      Object.freeze({
        factKey,
        valueText,
        sourceType,
        sourceUrl,
        sourceExcerpt,
        confidence,
        claimUsage,
      }),
    );
  }

  return Object.freeze(snapped);
}
