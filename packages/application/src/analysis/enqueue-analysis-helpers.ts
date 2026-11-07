import util from 'node:util';
import {
  canWorkspaceRole,
  parseAnalysisId,
  parseProductFactSetId,
  parseProductId,
  parseUserId,
  parseWorkspaceId,
  type AIModelConfiguration,
  type ProductFactSetId,
  type ProductId,
  type UserId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import { FactSetNotConfirmedError, SourceAnalysisNotAcceptedError } from './errors.js';
import {
  ProductArchivedError,
  ProductNotFoundError,
  FactSetNotFoundError,
} from '../catalog/errors.js';
import { ValidationError, WorkspaceAccessDeniedError } from '../errors.js';
import type { EnqueueAnalysisCommand, EnqueueAnalysisDependencies } from './types.js';

const IDEMPOTENCY_KEY_REGEX = /^[\x21-\x7E]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F]/;

function assertNoHostileCoercion(value: unknown, fieldName: string): void {
  if (typeof value === 'object' && value !== null) {
    if (util.types.isProxy(value)) {
      throw new ValidationError(`${fieldName} must not be a proxy`, fieldName);
    }
    const hasValueOf = Object.prototype.hasOwnProperty.call(value, 'valueOf');
    const hasToString = Object.prototype.hasOwnProperty.call(value, 'toString');
    const hasToPrimitive = Object.prototype.hasOwnProperty.call(value, Symbol.toPrimitive);
    if (hasValueOf || hasToString || hasToPrimitive) {
      throw new ValidationError(`Coercion hooks are prohibited on ${fieldName}`, fieldName);
    }
  }
}

export function validateEnqueueAnalysisCommand(raw: unknown): EnqueueAnalysisCommand {
  if (typeof raw !== 'object' || raw === null || util.types.isProxy(raw)) {
    throw new ValidationError('Invalid enqueue analysis command: must be an object', 'command');
  }

  const proto = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) {
    throw new ValidationError('Invalid enqueue analysis command prototype', 'command');
  }

  // Reject symbol properties safely without reading
  if (Object.getOwnPropertySymbols(raw).length > 0) {
    throw new ValidationError('Symbol properties are prohibited on command', 'command');
  }

  const allowedKeys = new Set([
    'workspaceId',
    'productId',
    'analysisType',
    'factSetId',
    'sourceAnalysisIds',
    'instructions',
    'idempotencyKey',
    'actorUserId',
  ]);

  const props = Object.getOwnPropertyNames(raw);
  for (const key of props) {
    if (!allowedKeys.has(key)) {
      throw new ValidationError(`Unexpected property: ${key}`, key);
    }
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (!desc) {
      throw new ValidationError(`Missing descriptor for property: ${key}`, key);
    }
    if (desc.get !== undefined || desc.set !== undefined) {
      throw new ValidationError(`Accessor properties are prohibited on ${key}`, key);
    }
    assertNoHostileCoercion(desc.value, key);
  }

  // Safely extract validated values from descriptors
  const getProp = (k: string) => Object.getOwnPropertyDescriptor(raw, k)?.value;

  const rawInstructions = getProp('instructions');
  if (rawInstructions !== undefined && rawInstructions !== null) {
    throw new ValidationError(
      'Raw instructions are not accepted in Phase 1 analysis contract',
      'instructions',
    );
  }

  const rawKey = getProp('idempotencyKey');
  if (
    typeof rawKey !== 'string' ||
    rawKey.length < 1 ||
    rawKey.length > 128 ||
    !IDEMPOTENCY_KEY_REGEX.test(rawKey)
  ) {
    throw new ValidationError(
      'Invalid Idempotency-Key: must be 1-128 ASCII printable characters',
      'idempotencyKey',
    );
  }

  const rawType = getProp('analysisType');
  if (rawType !== 'product' && rawType !== 'niche') {
    throw new ValidationError('analysisType must be "product" or "niche"', 'analysisType');
  }

  const rawSources = getProp('sourceAnalysisIds');
  let normalizedSourceIds: readonly string[] | undefined;

  // Reject sourceAnalysisIds for product analysis
  if (rawType === 'product') {
    if (rawSources !== undefined && rawSources !== null) {
      throw new ValidationError(
        'sourceAnalysisIds is prohibited for product analysis',
        'sourceAnalysisIds',
      );
    }
  } else {
    // Niche analysis: bound sourceAnalysisIds count to max 20
    if (rawSources !== undefined && rawSources !== null) {
      if (!Array.isArray(rawSources)) {
        throw new ValidationError('sourceAnalysisIds must be an array', 'sourceAnalysisIds');
      }
      if (rawSources.length > 20) {
        throw new ValidationError('sourceAnalysisIds cannot exceed 20 items', 'sourceAnalysisIds');
      }
      const validated = rawSources.map((id, idx) => {
        try {
          return parseAnalysisId(id, `sourceAnalysisIds[${idx}]`);
        } catch {
          throw new ValidationError(
            `Invalid source analysis ID at index ${idx}`,
            `sourceAnalysisIds[${idx}]`,
          );
        }
      });
      normalizedSourceIds = Object.freeze([...new Set(validated)].sort());
    }
  }

  return Object.freeze({
    workspaceId: parseWorkspaceId(getProp('workspaceId')),
    productId: parseProductId(getProp('productId')),
    analysisType: rawType,
    factSetId: parseProductFactSetId(getProp('factSetId')),
    sourceAnalysisIds: normalizedSourceIds,
    idempotencyKey: rawKey,
    actorUserId: parseUserId(getProp('actorUserId')),
  });
}

export function validateAIModelConfig(config: unknown): AIModelConfiguration {
  if (typeof config !== 'object' || config === null || util.types.isProxy(config)) {
    throw new ValidationError(
      'aiModelConfig must be a valid configuration object',
      'aiModelConfig',
    );
  }
  const allowedKeys = new Set([
    'provider',
    'model',
    'promptTemplate',
    'promptVersion',
    'inputSchemaVersion',
    'outputSchemaVersion',
    'estimatedCostMicrounits',
  ]);
  if (Object.getOwnPropertySymbols(config).length > 0) {
    throw new ValidationError('Symbol properties are prohibited on aiModelConfig', 'aiModelConfig');
  }
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(config)) {
    if (!allowedKeys.has(key)) {
      throw new ValidationError(`Unexpected property: ${key}`, `aiModelConfig.${key}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(config, key);
    if (!descriptor || descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new ValidationError(
        `Accessor properties are prohibited on aiModelConfig.${key}`,
        `aiModelConfig.${key}`,
      );
    }
    assertNoHostileCoercion(descriptor.value, `aiModelConfig.${key}`);
    values[key] = descriptor.value;
  }

  const checkStr = (val: unknown, name: string, maxLen: number): string => {
    if (typeof val !== 'string') {
      throw new ValidationError(`${name} must be a string`, name);
    }
    const trimmed = val.trim();
    if (trimmed.length < 1 || trimmed.length > maxLen || CONTROL_CHARS_REGEX.test(trimmed)) {
      throw new ValidationError(
        `${name} must be 1-${maxLen} characters without control characters`,
        name,
      );
    }
    return trimmed;
  };

  const checkVer = (val: unknown, name: string): number => {
    if (typeof val !== 'number' || !Number.isSafeInteger(val) || val < 1 || val > 1000) {
      throw new ValidationError(`${name} must be a positive integer between 1 and 1000`, name);
    }
    return val;
  };

  return Object.freeze({
    provider: checkStr(values.provider, 'aiModelConfig.provider', 128),
    model: checkStr(values.model, 'aiModelConfig.model', 128),
    promptTemplate: checkStr(values.promptTemplate, 'aiModelConfig.promptTemplate', 128),
    promptVersion: checkStr(values.promptVersion, 'aiModelConfig.promptVersion', 64),
    inputSchemaVersion: checkVer(values.inputSchemaVersion, 'aiModelConfig.inputSchemaVersion'),
    outputSchemaVersion: checkVer(values.outputSchemaVersion, 'aiModelConfig.outputSchemaVersion'),
    estimatedCostMicrounits: (() => {
      const value = values.estimatedCostMicrounits;
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > 10_000_000
      ) {
        throw new ValidationError(
          'aiModelConfig.estimatedCostMicrounits must be a safe integer between 1 and 10000000',
          'aiModelConfig.estimatedCostMicrounits',
        );
      }
      return value;
    })(),
  });
}

export async function verifyAnalysisPrerequisites(
  command: EnqueueAnalysisCommand,
  deps: EnqueueAnalysisDependencies,
  wsId: WorkspaceId,
  prodId: ProductId,
  factSetId: ProductFactSetId,
  actorId: UserId,
): Promise<void> {
  const membership = await deps.authPort.findMembership({
    workspaceId: wsId,
    userId: actorId,
  });
  if (!membership || membership.status !== 'active') {
    throw new WorkspaceAccessDeniedError();
  }
  if (!canWorkspaceRole(membership.role, 'catalog.manage')) {
    throw new WorkspaceAccessDeniedError();
  }

  const product = await deps.catalogPort.findProductById({
    workspaceId: wsId,
    productId: prodId,
  });
  if (!product) {
    throw new ProductNotFoundError(command.productId);
  }
  if (product.status === 'archived') {
    throw new ProductArchivedError();
  }

  const factSetWithFacts = await deps.catalogPort.findFactSetById({
    workspaceId: wsId,
    productId: prodId,
    factSetId,
  });
  if (!factSetWithFacts) {
    throw new FactSetNotFoundError(command.factSetId);
  }
  if (factSetWithFacts.factSet.status !== 'confirmed') {
    throw new FactSetNotConfirmedError(command.factSetId);
  }

  if (command.analysisType === 'niche' && command.sourceAnalysisIds) {
    for (const sourceId of command.sourceAnalysisIds) {
      const source = await deps.analysisPort.getAnalysisById(wsId, parseAnalysisId(sourceId));
      if (!source || source.productId !== prodId || source.status !== 'accepted') {
        throw new SourceAnalysisNotAcceptedError(sourceId);
      }
    }
  }
}
