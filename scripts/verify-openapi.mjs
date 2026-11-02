import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const openApiPath = path.join(rootDir, 'openapi', 'openapi.json');

// Import generator
const { buildOpenApiDocument } = await import('../apps/api/src/auth/openapi.ts');

const expectedDoc = buildOpenApiDocument();
const rawJson = JSON.stringify(expectedDoc, null, 2);
const prettierConfig = (await prettier.resolveConfig(openApiPath)) ?? {};
const expectedContent = await prettier.format(rawJson, {
  ...prettierConfig,
  parser: 'json',
});

const isWriteMode = process.argv.includes('--write');

if (isWriteMode) {
  const openApiDir = path.dirname(openApiPath);
  if (!fs.existsSync(openApiDir)) {
    fs.mkdirSync(openApiDir, { recursive: true });
  }
  fs.writeFileSync(openApiPath, expectedContent, 'utf8');
  console.log('[openapi] Generated openapi/openapi.json successfully.');
  process.exit(0);
}

if (!fs.existsSync(openApiPath)) {
  console.error(
    '[openapi:check] openapi/openapi.json does not exist. Run `pnpm openapi:generate` to generate it.',
  );
  process.exit(1);
}

const actualContent = fs.readFileSync(openApiPath, 'utf8');

if (actualContent !== expectedContent) {
  console.error(
    '[openapi:check] openapi/openapi.json differs from executable schemas in apps/api. Run `pnpm openapi:generate` to sync.',
  );
  process.exit(1);
}

console.log('[openapi:check] openapi/openapi.json matches runtime schemas.');
process.exit(0);
