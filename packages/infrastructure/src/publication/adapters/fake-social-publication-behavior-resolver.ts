import type { PublishTextRequest } from '@affiliate-content-os/application';
import type { FakePublicationBehavior } from './fake-social-publication-types.js';

const VALID_BEHAVIORS = new Set<FakePublicationBehavior>([
  'published',
  'transient',
  'rate_limited',
  'permanent_rejected',
  'processing',
  'outcome_unknown',
  'timeout_hang',
]);

export function isFakePublicationBehavior(val: unknown): val is FakePublicationBehavior {
  return typeof val === 'string' && VALID_BEHAVIORS.has(val as FakePublicationBehavior);
}

export interface FakeBehaviorResolutionContext {
  readonly defaultBehavior: FakePublicationBehavior;
  readonly behaviorByPublication: ReadonlyMap<string, FakePublicationBehavior>;
  readonly behaviorByAttempt: ReadonlyMap<string, FakePublicationBehavior>;
}

export function resolveFakePublicationBehavior(
  request: PublishTextRequest,
  context: FakeBehaviorResolutionContext,
): FakePublicationBehavior {
  const setting = request.platformSettings['simulatedBehavior'];
  if (isFakePublicationBehavior(setting)) return setting;

  const text = request.renderedText;
  if (text.includes('sim:transient') || text.includes('sim_transient')) return 'transient';
  if (text.includes('sim:rate_limited') || text.includes('sim_rate_limited')) return 'rate_limited';
  if (text.includes('sim:permanent_rejected') || text.includes('sim_permanent_rejected'))
    return 'permanent_rejected';
  if (text.includes('sim:processing') || text.includes('sim_processing')) return 'processing';
  if (text.includes('sim:outcome_unknown') || text.includes('sim_outcome_unknown'))
    return 'outcome_unknown';
  if (text.includes('sim:timeout_hang') || text.includes('sim_timeout_hang')) return 'timeout_hang';
  if (text.includes('sim:published') || text.includes('sim_published')) return 'published';

  const key = request.attemptIdempotencyKey;
  const pubId = request.publicationId;
  if (key.includes('fail_transient') || pubId.includes('fail_transient')) return 'transient';
  if (key.includes('fail_rate_limit') || pubId.includes('fail_rate_limit')) return 'rate_limited';
  if (
    key.includes('fail_permanent') ||
    key.includes('fail_rejected') ||
    pubId.includes('fail_permanent')
  ) {
    return 'permanent_rejected';
  }
  if (key.includes('simulate_processing') || pubId.includes('simulate_processing'))
    return 'processing';
  if (key.includes('fail_unknown') || pubId.includes('fail_unknown')) return 'outcome_unknown';
  if (
    key.includes('simulate_timeout') ||
    key.includes('hang') ||
    pubId.includes('simulate_timeout')
  ) {
    return 'timeout_hang';
  }

  if (context.behaviorByAttempt.has(request.attemptIdempotencyKey)) {
    return context.behaviorByAttempt.get(request.attemptIdempotencyKey)!;
  }
  if (context.behaviorByPublication.has(request.publicationId)) {
    return context.behaviorByPublication.get(request.publicationId)!;
  }

  return context.defaultBehavior;
}
