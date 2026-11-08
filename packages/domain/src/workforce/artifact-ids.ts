import { DomainValidationError } from '../errors.js';
import { isValidUuidV7 } from '../ids.js';

declare const ContentArtifactIdBrand: unique symbol;
export type ContentArtifactId = string & {
  readonly [ContentArtifactIdBrand]: typeof ContentArtifactIdBrand;
};

declare const ContentArtifactRevisionIdBrand: unique symbol;
export type ContentArtifactRevisionId = string & {
  readonly [ContentArtifactRevisionIdBrand]: typeof ContentArtifactRevisionIdBrand;
};

declare const ArtifactEvidenceRefIdBrand: unique symbol;
export type ArtifactEvidenceRefId = string & {
  readonly [ArtifactEvidenceRefIdBrand]: typeof ArtifactEvidenceRefIdBrand;
};

function assertUuidV7(value: unknown, entityName: string, fieldName = 'id'): string {
  if (typeof value !== 'string') {
    throw new DomainValidationError(`Invalid ${entityName} ID: must be a string`, fieldName);
  }
  if (!isValidUuidV7(value)) {
    throw new DomainValidationError(
      `Invalid ${entityName} ID: must be a canonical lowercase UUIDv7 string`,
      fieldName,
    );
  }
  return value;
}

export function isContentArtifactId(value: unknown): value is ContentArtifactId {
  return isValidUuidV7(value);
}

export function parseContentArtifactId(
  value: unknown,
  fieldName = 'artifactId',
): ContentArtifactId {
  return assertUuidV7(value, 'content artifact', fieldName) as ContentArtifactId;
}

export function isContentArtifactRevisionId(value: unknown): value is ContentArtifactRevisionId {
  return isValidUuidV7(value);
}

export function parseContentArtifactRevisionId(
  value: unknown,
  fieldName = 'revisionId',
): ContentArtifactRevisionId {
  return assertUuidV7(value, 'content artifact revision', fieldName) as ContentArtifactRevisionId;
}

export function isArtifactEvidenceRefId(value: unknown): value is ArtifactEvidenceRefId {
  return isValidUuidV7(value);
}

export function parseArtifactEvidenceRefId(
  value: unknown,
  fieldName = 'evidenceRefId',
): ArtifactEvidenceRefId {
  return assertUuidV7(value, 'artifact evidence ref', fieldName) as ArtifactEvidenceRefId;
}
