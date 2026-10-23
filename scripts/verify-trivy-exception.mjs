import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const REQUIRED_EXCEPTION_ID = 'TASK-003-CVE-2025-68121-GOSU';
export const REQUIRED_CVE = 'CVE-2025-68121';
export const REQUIRED_PATH = 'usr/local/bin/gosu';
export const REQUIRED_EXPIRY = '2026-12-31';
export const REQUIRED_IMAGE_DIGEST =
  'sha256:bbf83594798e144bff365a9c191c5d779f181fb3135902064ab8ff11918020fc';
export const REQUIRED_DOC_RELATIVE_PATH = 'security/exceptions/TASK-003-CVE-2025-68121-GOSU.md';

export const REQUIRED_EVIDENCE_URLS = Object.freeze([
  'https://github.com/golang/go/issues/77113',
  'https://security-tracker.debian.org/tracker/CVE-2025-68121',
  'https://github.com/tianon/gosu/blob/master/SECURITY.md',
  'https://github.com/tianon/gosu/issues/176',
  'https://github.com/docker-library/postgres/blob/master/18/bookworm/Dockerfile',
]);

/**
 * Parses a simple .trivyignore.yaml file strictly ensuring only the approved schema.
 */
export function parseTrivyIgnoreYaml(content) {
  const lines = content.split(/\r?\n/);
  const topLevelKeys = [];
  const entries = [];
  let currentEntry = null;
  let currentKey = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const topLevelMatch = rawLine.match(/^([a-zA-Z0-9_-]+):/);
    if (topLevelMatch) {
      const key = topLevelMatch[1];
      topLevelKeys.push(key);
      currentKey = key;
      continue;
    }

    if (currentKey === 'vulnerabilities') {
      const itemStartMatch = rawLine.match(/^\s*-\s+([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (itemStartMatch) {
        currentEntry = { paths: [] };
        entries.push(currentEntry);
        const propKey = itemStartMatch[1];
        const propVal = itemStartMatch[2].trim();
        currentEntry[propKey] = propVal;
        continue;
      }

      const propMatch = rawLine.match(/^\s+([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (propMatch && currentEntry) {
        const propKey = propMatch[1];
        const propVal = propMatch[2].trim();
        if (propKey === 'paths' && propVal === '') {
          currentEntry.paths = [];
        } else {
          currentEntry[propKey] = propVal;
        }
        continue;
      }

      const pathItemMatch = rawLine.match(/^\s+-\s+([^\s#]+)$/);
      if (pathItemMatch && currentEntry) {
        currentEntry.paths.push(pathItemMatch[1]);
        continue;
      }

      if (rawLine.startsWith('    ') && currentEntry && currentEntry.statement !== undefined) {
        currentEntry.statement += ' ' + trimmed;
        continue;
      }
    }
  }

  return { topLevelKeys, entries };
}

export function verifyTrivyExceptionPolicy({
  ignorePath = path.join(rootDir, '.trivyignore.yaml'),
  exceptionDocPath = path.join(rootDir, REQUIRED_DOC_RELATIVE_PATH),
  ciPath = path.join(rootDir, '.github/workflows/ci.yml'),
  now = () => Date.now(),
} = {}) {
  // 1. Verify .trivyignore.yaml
  if (!fs.existsSync(ignorePath)) {
    throw new Error(`.trivyignore.yaml does not exist at ${ignorePath}`);
  }
  const ignoreContent = fs.readFileSync(ignorePath, 'utf8');
  const { topLevelKeys, entries } = parseTrivyIgnoreYaml(ignoreContent);

  if (topLevelKeys.length !== 1 || topLevelKeys[0] !== 'vulnerabilities') {
    throw new Error(
      `.trivyignore.yaml must contain only the 'vulnerabilities' top-level key. Found: ${topLevelKeys.join(', ')}`,
    );
  }

  if (entries.length !== 1) {
    throw new Error(
      `.trivyignore.yaml must contain exactly one vulnerability item. Found ${entries.length}`,
    );
  }

  const item = entries[0];
  if (item.id !== REQUIRED_CVE) {
    throw new Error(`.trivyignore.yaml item id must be '${REQUIRED_CVE}', but got '${item.id}'`);
  }

  if (!Array.isArray(item.paths) || item.paths.length !== 1 || item.paths[0] !== REQUIRED_PATH) {
    throw new Error(
      `.trivyignore.yaml paths must contain exactly ['${REQUIRED_PATH}'], but got: ${JSON.stringify(item.paths)}`,
    );
  }

  if (item.paths[0].includes('*') || item.paths[0].includes('?')) {
    throw new Error(`.trivyignore.yaml path must not contain wildcards: ${item.paths[0]}`);
  }

  if (item.expired_at !== REQUIRED_EXPIRY) {
    throw new Error(
      `.trivyignore.yaml expired_at must be '${REQUIRED_EXPIRY}', but got '${item.expired_at}'`,
    );
  }

  // Check expiry date strictly in the future
  const expiryDate = new Date(`${item.expired_at}T23:59:59.999Z`);
  const currentTime = now();
  if (currentTime > expiryDate.getTime()) {
    throw new Error(
      `Security exception ${REQUIRED_EXCEPTION_ID} expired on ${item.expired_at}. Suppressions are no longer valid.`,
    );
  }

  if (!item.statement || !item.statement.includes(REQUIRED_DOC_RELATIVE_PATH)) {
    throw new Error(`.trivyignore.yaml statement must reference '${REQUIRED_DOC_RELATIVE_PATH}'`);
  }

  // 2. Verify exception document
  if (!fs.existsSync(exceptionDocPath)) {
    throw new Error(`Exception documentation missing at ${exceptionDocPath}`);
  }
  const docContent = fs.readFileSync(exceptionDocPath, 'utf8');

  if (!docContent.includes(REQUIRED_EXCEPTION_ID)) {
    throw new Error(
      `Exception documentation missing required exception ID '${REQUIRED_EXCEPTION_ID}'`,
    );
  }
  if (!docContent.includes(REQUIRED_CVE)) {
    throw new Error(`Exception documentation missing required CVE '${REQUIRED_CVE}'`);
  }
  if (!docContent.includes(REQUIRED_IMAGE_DIGEST)) {
    throw new Error(
      `Exception documentation missing required image digest '${REQUIRED_IMAGE_DIGEST}'`,
    );
  }
  if (!docContent.includes(REQUIRED_PATH)) {
    throw new Error(`Exception documentation missing required path '${REQUIRED_PATH}'`);
  }
  if (!docContent.includes(REQUIRED_EXPIRY)) {
    throw new Error(`Exception documentation missing required expiry date '${REQUIRED_EXPIRY}'`);
  }

  for (const url of REQUIRED_EVIDENCE_URLS) {
    if (!docContent.includes(url)) {
      throw new Error(`Exception documentation missing evidence URL '${url}'`);
    }
  }

  // 3. Verify CI workflow configuration
  if (!fs.existsSync(ciPath)) {
    throw new Error(`CI workflow file missing at ${ciPath}`);
  }
  const ciContent = fs.readFileSync(ciPath, 'utf8');

  if (!ciContent.includes('--ignorefile .trivyignore.yaml')) {
    throw new Error(`CI workflow must pass '--ignorefile .trivyignore.yaml' to trivy commands`);
  }
  if (!ciContent.includes('--show-suppressed')) {
    throw new Error(
      `CI workflow must pass '--show-suppressed' to ensure suppressions are logged in CI`,
    );
  }
  if (!ciContent.includes('timeout-minutes: 15')) {
    throw new Error(
      `CI workflow container vulnerability scan step must specify 'timeout-minutes: 15'`,
    );
  }

  // Prohibit prohibited flags in CI
  const forbiddenFlags = [
    '--pkg-types',
    '--skip-files',
    '--skip-dirs',
    'continue-on-error',
    '|| true',
  ];
  for (const flag of forbiddenFlags) {
    if (ciContent.includes(flag)) {
      throw new Error(`CI workflow contains forbidden scanning suppression/bypass: '${flag}'`);
    }
  }

  // Assert both trivy commands exist in ci.yml
  const trivyCommandMatches = ciContent.match(/trivy\s+image\s+[^\r\n]+/g) || [];
  if (trivyCommandMatches.length < 2) {
    throw new Error(
      `CI workflow must contain at least two Trivy scan commands. Found ${trivyCommandMatches.length}`,
    );
  }

  for (const cmd of trivyCommandMatches) {
    if (!cmd.includes('--ignorefile .trivyignore.yaml')) {
      throw new Error(`Trivy command missing '--ignorefile .trivyignore.yaml': ${cmd}`);
    }
    if (!cmd.includes('--show-suppressed')) {
      throw new Error(`Trivy command missing '--show-suppressed': ${cmd}`);
    }
    if (!cmd.includes('--scanners vuln')) {
      throw new Error(`Trivy command must specify '--scanners vuln': ${cmd}`);
    }
    if (!cmd.includes('--timeout 10m')) {
      throw new Error(`Trivy command must specify '--timeout 10m': ${cmd}`);
    }
    if (!cmd.includes('--no-progress')) {
      throw new Error(`Trivy command must specify '--no-progress': ${cmd}`);
    }
    if (!cmd.includes('--format table')) {
      throw new Error(`Trivy command must specify '--format table': ${cmd}`);
    }
  }

  // Verify command 1 and command 2 specifics
  const hasHighCritical = trivyCommandMatches.some(
    (c) => c.includes('--severity HIGH,CRITICAL') && c.includes('--exit-code 0'),
  );
  const hasCriticalBlocking = trivyCommandMatches.some(
    (c) =>
      c.includes('--severity CRITICAL') &&
      c.includes('--ignore-unfixed') &&
      c.includes('--exit-code 1'),
  );

  if (!hasHighCritical) {
    throw new Error(
      `CI workflow must contain a Trivy scan with '--severity HIGH,CRITICAL --exit-code 0'`,
    );
  }
  if (!hasCriticalBlocking) {
    throw new Error(
      `CI workflow must contain a Trivy blocking scan with '--severity CRITICAL --ignore-unfixed --exit-code 1'`,
    );
  }

  return { verified: true, exceptionId: REQUIRED_EXCEPTION_ID };
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && process.argv[1] === currentFilePath) {
  try {
    const result = verifyTrivyExceptionPolicy();
    console.log(
      `[verify:trivy-exception] Security exception policy verified: ${result.exceptionId} (valid until ${REQUIRED_EXPIRY}).`,
    );
  } catch (err) {
    console.error(
      `[verify:trivy-exception] Policy violation: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}
