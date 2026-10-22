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
        path: '(^|/)apps/(?!$2(/|$))[^/]+/',
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
        path: '(^|/)(apps|packages)/(?!$3(/|$))[^/]+/(src|test)/',
      },
    },
    {
      name: 'domain-boundary',
      severity: 'error',
      comment: 'packages/domain may not depend on any internal package except packages/domain',
      from: {
        path: '(^|/)packages/domain/',
      },
      to: {
        path: '(^|/)(packages/(?!domain(/|$))|apps/)',
      },
    },
    {
      name: 'application-boundary',
      severity: 'error',
      comment: 'packages/application may only depend on packages/domain and packages/application',
      from: {
        path: '(^|/)packages/application/',
      },
      to: {
        path: '(^|/)(packages/(?!(domain|application)(/|$))|apps/)',
      },
    },
    {
      name: 'contracts-boundary',
      severity: 'error',
      comment:
        'packages/contracts may not depend on any internal package except packages/contracts',
      from: {
        path: '(^|/)packages/contracts/',
      },
      to: {
        path: '(^|/)(packages/(?!contracts(/|$))|apps/)',
      },
    },
    {
      name: 'config-boundary',
      severity: 'error',
      comment: 'packages/config may not depend on any internal package except packages/config',
      from: {
        path: '(^|/)packages/config/',
      },
      to: {
        path: '(^|/)(packages/(?!config(/|$))|apps/)',
      },
    },
    {
      name: 'observability-boundary',
      severity: 'error',
      comment:
        'packages/observability may only depend on packages/config and packages/observability',
      from: {
        path: '(^|/)packages/observability/',
      },
      to: {
        path: '(^|/)(packages/(?!(config|observability)(/|$))|apps/)',
      },
    },
    {
      name: 'infrastructure-boundary',
      severity: 'error',
      comment:
        'packages/infrastructure may only depend on domain, application, contracts, config, observability, and infrastructure',
      from: {
        path: '(^|/)packages/infrastructure/',
      },
      to: {
        path: '(^|/)(packages/(?!(domain|application|contracts|config|observability|infrastructure)(/|$))|apps/)',
      },
    },
    {
      name: 'web-boundary',
      severity: 'error',
      comment:
        'apps/web may only depend on packages/contracts, packages/config, packages/observability, and apps/web',
      from: {
        path: '(^|/)apps/web/',
      },
      to: {
        path: '(^|/)(packages/(?!(contracts|config|observability)(/|$))|apps/(?!web(/|$)))',
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
      name: 'api-boundary',
      severity: 'error',
      comment: 'apps/api may not import packages/test-support or other apps',
      from: {
        path: '(^|/)apps/api/',
      },
      to: {
        path: '(^|/)(packages/test-support/|apps/(?!api(/|$)))',
      },
    },
    {
      name: 'worker-boundary',
      severity: 'error',
      comment: 'apps/worker may not import packages/test-support or other apps',
      from: {
        path: '(^|/)apps/worker/',
      },
      to: {
        path: '(^|/)(packages/test-support/|apps/(?!worker(/|$)))',
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
