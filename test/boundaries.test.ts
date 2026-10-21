import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cruise } from 'dependency-cruiser';
import { describe, expect, it } from 'vitest';
import depcruiseConfig from '../.dependency-cruiser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

interface CruisedViolation {
  readonly from: string;
  readonly to: string;
  readonly rule: {
    readonly name: string;
    readonly severity: string;
  };
}

function buildCruiseOptions(): Record<string, unknown> {
  const clone = structuredClone(depcruiseConfig as Record<string, unknown>);
  const options = structuredClone((clone.options ?? {}) as Record<string, unknown>);
  delete clone.options;
  options.ruleSet = clone;
  options.validate = true;
  return options;
}

const cruiseOptions = buildCruiseOptions();

async function cruiseFiles(targets: readonly string[]): Promise<readonly CruisedViolation[]> {
  const result = await cruise(targets as string[], cruiseOptions);

  if (typeof result.output === 'string') {
    return [];
  }

  const violations = result.output?.summary?.violations ?? [];
  return violations as unknown as readonly CruisedViolation[];
}

describe('Architecture dependency direction boundaries', { timeout: 30000 }, () => {
  it('passes for current production workspace graph with zero violations', async () => {
    const violations = await cruiseFiles(['apps', 'packages']);
    expect(violations).toEqual([]);
  });

  it('allows valid same-package imports within the same package', async () => {
    const fixturePath = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/same-package/packages/domain/src/entity.ts'),
    );
    const violations = await cruiseFiles([fixturePath]);
    expect(violations).toEqual([]);
  });

  it('allows valid package-name alias and relative imports in composition roots', async () => {
    const apiServerPath = path.relative(rootDir, path.join(rootDir, 'apps/api/src/server.ts'));
    const violations = await cruiseFiles([apiServerPath]);
    expect(violations).toEqual([]);
  });

  it('rejects package-to-app imports with no-package-to-app rule', async () => {
    const fixturePath = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/pkg-to-app/packages/domain/src/index.ts'),
    );
    const violations = await cruiseFiles([fixturePath]);

    const matching = violations.filter((v) => v.rule.name === 'no-package-to-app');
    expect(matching.length).toBeGreaterThan(0);
  });

  it('rejects app-to-app imports with no-app-to-app rule', async () => {
    const fixturePath = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/app-to-app/apps/web/src/index.ts'),
    );
    const violations = await cruiseFiles([fixturePath]);

    const matching = violations.filter((v) => v.rule.name === 'no-app-to-app');
    expect(matching.length).toBeGreaterThan(0);
  });

  it('rejects web-to-infrastructure imports with web-no-backend-internal rule', async () => {
    const fixturePath = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/web-to-infra/apps/web/src/index.ts'),
    );
    const violations = await cruiseFiles([fixturePath]);

    const matching = violations.filter(
      (v) => v.rule.name === 'web-no-backend-internal' || v.rule.name === 'web-boundary',
    );
    expect(matching.length).toBeGreaterThan(0);
  });

  it('rejects web-to-domain imports violating web allowlist', async () => {
    const fixturePath = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/web-to-domain/apps/web/src/index.ts'),
    );
    const violations = await cruiseFiles([fixturePath]);

    const matching = violations.filter(
      (v) => v.rule.name === 'web-boundary' || v.rule.name === 'web-no-backend-internal',
    );
    expect(matching.length).toBeGreaterThan(0);
  });

  it('rejects type-only forbidden imports with boundary rules', async () => {
    const fixturePath = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/type-only/apps/web/src/index.ts'),
    );
    const violations = await cruiseFiles([fixturePath]);

    const matching = violations.filter(
      (v) => v.rule.name === 'web-boundary' || v.rule.name === 'web-no-backend-internal',
    );
    expect(matching.length).toBeGreaterThan(0);
  });

  it('rejects dynamic forbidden imports with boundary rules', async () => {
    const fixturePath = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/dynamic-import/apps/web/src/index.ts'),
    );
    const violations = await cruiseFiles([fixturePath]);

    const matching = violations.filter(
      (v) => v.rule.name === 'web-boundary' || v.rule.name === 'web-no-backend-internal',
    );
    expect(matching.length).toBeGreaterThan(0);
  });

  it('rejects application-to-infrastructure imports with application-boundary rule', async () => {
    const fixturePath = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/app-to-infra/packages/application/src/index.ts'),
    );
    const violations = await cruiseFiles([fixturePath]);

    const matching = violations.filter((v) => v.rule.name === 'application-boundary');
    expect(matching.length).toBeGreaterThan(0);
  });

  it('rejects infrastructure-to-app imports with boundary rules', async () => {
    const fixturePath = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/infra-to-app/packages/infrastructure/src/index.ts'),
    );
    const violations = await cruiseFiles([fixturePath]);

    const matching = violations.filter(
      (v) => v.rule.name === 'infrastructure-boundary' || v.rule.name === 'no-package-to-app',
    );
    expect(matching.length).toBeGreaterThan(0);
  });

  it('rejects production code importing test-support with no-prod-to-test-support rule', async () => {
    const fixturePath = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/prod-to-test-support/packages/domain/src/index.ts'),
    );
    const violations = await cruiseFiles([fixturePath]);

    const matching = violations.filter((v) => v.rule.name === 'no-prod-to-test-support');
    expect(matching.length).toBeGreaterThan(0);
  });

  it('rejects cross-workspace deep imports into internal src with no-cross-workspace-deep-import rule', async () => {
    const fixturePath = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/deep-import/apps/web/src/index.ts'),
    );
    const violations = await cruiseFiles([fixturePath]);

    const matching = violations.filter((v) => v.rule.name === 'no-cross-workspace-deep-import');
    expect(matching.length).toBeGreaterThan(0);
  });

  it('rejects circular dependencies with no-circular rule', async () => {
    const fixtureA = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/circular/packages/a.ts'),
    );
    const fixtureB = path.relative(
      rootDir,
      path.join(__dirname, 'fixtures/boundaries/circular/packages/b.ts'),
    );
    const violations = await cruiseFiles([fixtureA, fixtureB]);

    const matching = violations.filter((v) => v.rule.name === 'no-circular');
    expect(matching.length).toBeGreaterThan(0);
  });
});
