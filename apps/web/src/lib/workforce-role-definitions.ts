import type { AgentRoleKey } from '../types/workforce.js';
import type { OfficeStationKey } from './workforce-view-model-types.js';

export const ORDERED_ROLES: readonly AgentRoleKey[] = [
  'chief_of_staff',
  'product_strategist',
  'audience_strategist',
  'creative_director',
  'scriptwriter',
  'compliance_reviewer',
];

export interface RoleMeta {
  readonly title: string;
  readonly department: string;
  readonly station: OfficeStationKey;
  readonly mandate: string;
  readonly defaultDependencies: readonly AgentRoleKey[];
}

export const ROLE_METADATA: Record<AgentRoleKey, RoleMeta> = {
  chief_of_staff: {
    title: 'Chief of Staff',
    department: 'Strategy room',
    station: 'strategy',
    mandate:
      'Deterministic orchestration, task graph management, blocker resolution, and handoff assembly.',
    defaultDependencies: [],
  },
  product_strategist: {
    title: 'Product Strategist',
    department: 'Product desk',
    station: 'product',
    mandate:
      'Converts confirmed facts and accepted analyses into core positioning, benefits, and campaign goals.',
    defaultDependencies: [],
  },
  audience_strategist: {
    title: 'Audience Strategist',
    department: 'Insight desk',
    station: 'insight',
    mandate: 'Defines evidence-safe audience segments, emotional drivers, pain points, and hooks.',
    defaultDependencies: [],
  },
  creative_director: {
    title: 'Creative Director',
    department: 'Creative studio',
    station: 'creative',
    mandate: 'Designs the 5-video series narrative arc, visual direction, scene pacing, and hooks.',
    defaultDependencies: ['product_strategist', 'audience_strategist'],
  },
  scriptwriter: {
    title: 'Scriptwriter',
    department: 'Content desk',
    station: 'content',
    mandate:
      'Produces platform-neutral scripts, voice-overs, on-screen text, shot lists, and CTAs.',
    defaultDependencies: ['product_strategist', 'creative_director'],
  },
  compliance_reviewer: {
    title: 'Compliance Reviewer',
    department: 'Quality lab',
    station: 'quality',
    mandate:
      'Performs deterministic compliance linting, unsupported claims detection, and advisory reports.',
    defaultDependencies: ['scriptwriter'],
  },
};
