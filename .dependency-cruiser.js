/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular internal dependencies are rejected',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'no-package-to-app',
      severity: 'error',
      comment: 'Packages must never import from apps',
      from: {
        path: '(^|/)packages/',
      },
      to: {
        path: '(^|/)apps/',
      },
    },
    {
      name: 'no-app-to-app',
      severity: 'error',
      comment: 'Apps must never import from another app',
      from: {
        path: '(^|/)apps/([^/]+)/',
      },
      to: {
        path: '(^|/)apps/(?!$2)[^/]+/',
      },
    },
    {
      name: 'no-prod-to-test-support',
      severity: 'error',
      comment: 'Production code must never import packages/test-support',
      from: {
        pathNot:
          '(\\.(test|spec)\\.[jt]sx?$|^test/(?!fixtures/boundaries/prod-to-test-support)|^packages/[^/]+/test/|^apps/[^/]+/test/)',
      },
      to: {
        path: '(^|/)packages/test-support/',
      },
    },
    {
      name: 'no-cross-workspace-deep-import',
      severity: 'error',
      comment:
        'Workspace-to-workspace imports must use declared package public exports, not internal src paths',
      from: {
        path: '(^|/)(apps|packages)/([^/]+)/',
      },
      to: {
        path: '(^|/)(apps|packages)/(?!$3)[^/]+/src/',
      },
    },
    {
      name: 'domain-boundary',
      severity: 'error',
      comment: 'packages/domain may not depend on any internal package',
      from: {
        path: '(^|/)packages/domain/',
      },
      to: {
        path: '(^|/)(packages|apps)/',
      },
    },
    {
      name: 'application-boundary',
      severity: 'error',
      comment: 'packages/application may only depend on packages/domain',
      from: {
        path: '(^|/)packages/application/',
      },
      to: {
        path: '(^|/)(packages/(?!domain)|apps/)',
      },
    },
    {
      name: 'contracts-boundary',
      severity: 'error',
      comment: 'packages/contracts may not depend on any internal package',
      from: {
        path: '(^|/)packages/contracts/',
      },
      to: {
        path: '(^|/)(packages|apps)/',
      },
    },
    {
      name: 'config-boundary',
      severity: 'error',
      comment: 'packages/config may not depend on any internal package',
      from: {
        path: '(^|/)packages/config/',
      },
      to: {
        path: '(^|/)(packages/(?!config)|apps/)',
      },
    },
    {
      name: 'observability-boundary',
      severity: 'error',
      comment: 'packages/observability may only depend on packages/config',
      from: {
        path: '(^|/)packages/observability/',
      },
      to: {
        path: '(^|/)(packages/(?!config)|apps/)',
      },
    },
    {
      name: 'web-no-backend-internal',
      severity: 'error',
      comment:
        'apps/web must not import packages/domain, packages/application, or packages/infrastructure',
      from: {
        path: '(^|/)apps/web/',
      },
      to: {
        path: '(^|/)packages/(domain|application|infrastructure)/',
      },
    },
    {
      name: 'framework-isolation-react',
      severity: 'error',
      comment: 'Shared backend packages must not import Next.js or React',
      from: {
        path: '(^|/)packages/(domain|application|contracts|config|infrastructure|observability)/',
      },
      to: {
        path: '(^|/)(next|react|react-dom)($|/)',
      },
    },
    {
      name: 'framework-isolation-fastify',
      severity: 'error',
      comment: 'Core shared packages must not import Fastify',
      from: {
        path: '(^|/)packages/(domain|application|contracts|config)/',
      },
      to: {
        path: '(^|/)fastify($|/)',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
  },
};
