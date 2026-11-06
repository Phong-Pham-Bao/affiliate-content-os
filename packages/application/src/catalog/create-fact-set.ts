import {
  dateToIsoTimestamp,
  parseProductId,
  validateFactSetSummary,
  type ProductFactSetSnapshot,
  type ProductFactSnapshot,
} from '@affiliate-content-os/domain';
import { authorizeWorkspaceAction } from '../authorize-workspace-action.js';
import type { ClockPort, IdGeneratorPort, WorkspaceAuthorizationPort } from '../ports.js';
import { snapshotCreateFactSetCommand } from './command-snapshots.js';
import { DuplicateFactKeyError, ProductNotFoundError } from './errors.js';
import { validateAndMapFactSnapshots } from './fact-input-validation.js';
import {
  buildFactSetAuditEvent,
  buildFactSetCreateIdempotencyRecord,
  getValidClockDate,
  resolveProductFactSetId,
  type CatalogAuditContext,
  type ProductCreateIdempotencyInput,
} from './helpers.js';
import type { CatalogPersistencePort } from './ports.js';

export interface FactInput {
  readonly factKey: string;
  readonly valueText: string;
  readonly sourceType: string;
  readonly sourceUrl?: string | null | undefined;
  readonly sourceExcerpt?: string | null | undefined;
  readonly confidence: string;
  readonly claimUsage: string;
}

export interface CreateFactSetCommand {
  readonly workspaceId: string;
  readonly userId: string;
  readonly productId: string;
  readonly summary?: string | null | undefined;
  readonly facts: readonly FactInput[];
  readonly idempotency?: ProductCreateIdempotencyInput | undefined;
  readonly auditContext?: CatalogAuditContext | undefined;
}

export interface CreateFactSetDependencies {
  readonly catalogPersistence: CatalogPersistencePort;
  readonly workspaceAuthorization: WorkspaceAuthorizationPort;
  readonly clock: ClockPort;
  readonly idGenerator: IdGeneratorPort;
}

export interface CreateFactSetResult {
  readonly factSet: ProductFactSetSnapshot;
  readonly facts: readonly ProductFactSnapshot[];
  readonly cached?: boolean | undefined;
}

export async function createFactSet(
  command: CreateFactSetCommand,
  deps: CreateFactSetDependencies,
): Promise<CreateFactSetResult> {
  const snap = snapshotCreateFactSetCommand(command);

  const authContext = await authorizeWorkspaceAction(
    {
      workspaceId: snap.workspaceId,
      userId: snap.userId,
      capability: 'catalog.manage',
    },
    { authorization: deps.workspaceAuthorization },
  );

  const productId = parseProductId(snap.productId);

  const product = await deps.catalogPersistence.findProductById({
    workspaceId: authContext.workspaceId,
    productId,
  });

  if (!product) {
    throw new ProductNotFoundError(productId);
  }

  const seenFactKeys = new Set<string>();
  for (const f of snap.facts) {
    if (seenFactKeys.has(f.factKey)) {
      throw new DuplicateFactKeyError(f.factKey);
    }
    seenFactKeys.add(f.factKey);
  }

  let summary: string | null = null;
  if (snap.summary !== undefined && snap.summary !== null) {
    summary = validateFactSetSummary(snap.summary);
  }

  const clockDate = getValidClockDate(deps.clock);
  const now = dateToIsoTimestamp(clockDate);
  const factSetId = resolveProductFactSetId(deps.idGenerator);

  const factSetInput: Omit<ProductFactSetSnapshot, 'revisionNumber'> = Object.freeze({
    id: factSetId,
    workspaceId: authContext.workspaceId,
    productId,
    status: 'proposed',
    summary,
    confirmedByUserId: null,
    confirmedAt: null,
    createdByUserId: authContext.userId,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });

  const validatedFacts = validateAndMapFactSnapshots({
    facts: snap.facts,
    workspaceId: authContext.workspaceId,
    productId,
    factSetId,
    now,
    idGenerator: deps.idGenerator,
  });

  const auditEvent = buildFactSetAuditEvent({
    workspaceId: authContext.workspaceId,
    userId: authContext.userId,
    resourceId: factSetInput.id,
    action: 'catalog.fact_set_created',
    changes: {
      revision_number: { before: null, after: 'pending' },
      fact_count: { before: null, after: String(validatedFacts.length) },
    },
    now,
    idGenerator: deps.idGenerator,
    auditContext: snap.auditContext,
  });

  const idempotencyRecord = snap.idempotency
    ? buildFactSetCreateIdempotencyRecord({
        workspaceId: authContext.workspaceId,
        productId,
        factSetId,
        userId: authContext.userId,
        now,
        clockDate,
        idGenerator: deps.idGenerator,
        idempotency: snap.idempotency,
      })
    : undefined;

  const persisted = await deps.catalogPersistence.createFactSet({
    factSet: factSetInput,
    facts: validatedFacts,
    auditEvent,
    idempotencyRecord,
  });

  return {
    factSet: Object.freeze(persisted.factSet),
    facts: Object.freeze(persisted.facts),
    cached: persisted.cached,
  };
}
