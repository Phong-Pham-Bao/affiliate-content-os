import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const ALLOWED_MANIFEST_LIST_MEDIA_TYPES = Object.freeze([
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
]);

const PINNED_REF_REGEX = /\b(postgres:18\.6-bookworm@sha256:[0-9a-f]{64})\b/;

export function extractPostgresReference(content, sourceName = 'file') {
  const match = content.match(PINNED_REF_REGEX);
  if (!match) {
    throw new Error(
      `Failed to find pinned PostgreSQL 18.6-bookworm image reference in ${sourceName}. Expected format: postgres:18.6-bookworm@sha256:<64 hex chars>`,
    );
  }
  return match[1];
}

export function inspectManifestList(
  imageRef,
  executor = (cmd, args) =>
    execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
) {
  let output;
  try {
    output = executor('docker', ['buildx', 'imagetools', 'inspect', imageRef]);
  } catch (error) {
    throw new Error(
      `docker buildx imagetools inspect failed for ${imageRef}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  const mediaTypeMatch = output.match(/MediaType:\s+([^\r\n]+)/);
  const digestMatch = output.match(/Digest:\s+([^\r\n]+)/);

  if (!mediaTypeMatch || !digestMatch) {
    throw new Error(
      `Could not parse MediaType and Digest from docker buildx imagetools inspect output for ${imageRef}.`,
    );
  }

  const mediaType = mediaTypeMatch[1].trim();
  const digest = digestMatch[1].trim();

  return { mediaType, digest };
}

export function verifyInfrastructurePins({
  composePath = path.join(rootDir, 'compose.yaml'),
  ciPath = path.join(rootDir, '.github/workflows/ci.yml'),
  inspector = inspectManifestList,
} = {}) {
  if (!fs.existsSync(composePath)) {
    throw new Error(`Compose file does not exist at ${composePath}`);
  }
  if (!fs.existsSync(ciPath)) {
    throw new Error(`CI workflow file does not exist at ${ciPath}`);
  }

  const composeContent = fs.readFileSync(composePath, 'utf8');
  const ciContent = fs.readFileSync(ciPath, 'utf8');

  const composeRef = extractPostgresReference(composeContent, 'compose.yaml');
  const ciRef = extractPostgresReference(ciContent, '.github/workflows/ci.yml');

  if (composeRef !== ciRef) {
    throw new Error(
      `Infrastructure pin mismatch: compose.yaml defines "${composeRef}" but ci.yml defines "${ciRef}".`,
    );
  }

  const [, expectedDigest] = composeRef.split('@');
  if (!expectedDigest || !/^sha256:[0-9a-f]{64}$/.test(expectedDigest)) {
    throw new Error(`Invalid digest format in image reference: ${composeRef}`);
  }

  const { mediaType, digest } = inspector(composeRef);

  if (!ALLOWED_MANIFEST_LIST_MEDIA_TYPES.includes(mediaType)) {
    throw new Error(
      `Rejected pinned image: MediaType "${mediaType}" is not an accepted multi-platform manifest list. Expected one of: ${ALLOWED_MANIFEST_LIST_MEDIA_TYPES.join(', ')}. Platform child digests are rejected.`,
    );
  }

  if (digest !== expectedDigest) {
    throw new Error(
      `Digest mismatch for ${composeRef}: remote top-level manifest digest is "${digest}", expected "${expectedDigest}".`,
    );
  }

  return {
    verified: true,
    imageReference: composeRef,
    mediaType,
    digest,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyInfrastructurePins();
    console.log(`[verify:infrastructure-pins] Successfully verified infrastructure pin:`);
    console.log(`  Reference: ${result.imageReference}`);
    console.log(`  MediaType: ${result.mediaType}`);
    console.log(`  Digest:    ${result.digest}`);
  } catch (error) {
    console.error(
      `[verify:infrastructure-pins] Verification failed:`,
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}
