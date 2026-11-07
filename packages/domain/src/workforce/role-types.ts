import type { IsoTimestamp } from '../timestamps.js';
import { parseAgentRoleDefinitionId, type AgentRoleDefinitionId } from './ids.js';

export const AGENT_ROLE_KEYS = [
  'chief_of_staff',
  'product_strategist',
  'audience_strategist',
  'creative_director',
  'scriptwriter',
  'compliance_reviewer',
] as const;

export type AgentRoleKey = (typeof AGENT_ROLE_KEYS)[number];

export function isAgentRoleKey(value: unknown): value is AgentRoleKey {
  return typeof value === 'string' && (AGENT_ROLE_KEYS as readonly string[]).includes(value);
}

export function parseAgentRoleKey(value: unknown, fieldName = 'roleKey'): AgentRoleKey {
  if (!isAgentRoleKey(value)) {
    throw new Error(`Invalid agent role key: ${String(value)} on ${fieldName}`);
  }
  return value;
}

export interface AgentRoleDefinitionSnapshot {
  readonly id: AgentRoleDefinitionId;
  readonly roleKey: AgentRoleKey;
  readonly displayName: string;
  readonly department: string;
  readonly roleVersion: number;
  readonly isActive: boolean;
  readonly allowedArtifactTypes: readonly string[];
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly version: number;
}

export const SEEDED_ROLE_DEFINITIONS: readonly Readonly<{
  id: AgentRoleDefinitionId;
  roleKey: AgentRoleKey;
  displayName: string;
  department: string;
  roleVersion: number;
  allowedArtifactTypes: readonly string[];
}>[] = Object.freeze([
  Object.freeze({
    id: parseAgentRoleDefinitionId('018f0000-0000-7000-8000-000000000001'),
    roleKey: 'chief_of_staff' as const,
    displayName: 'Chief of Staff',
    department: 'Strategy room',
    roleVersion: 1,
    allowedArtifactTypes: Object.freeze(['work_plan', 'executive_summary']),
  }),
  Object.freeze({
    id: parseAgentRoleDefinitionId('018f0000-0000-7000-8000-000000000002'),
    roleKey: 'product_strategist' as const,
    displayName: 'Product Strategist',
    department: 'Product desk',
    roleVersion: 1,
    allowedArtifactTypes: Object.freeze(['product_campaign_plan']),
  }),
  Object.freeze({
    id: parseAgentRoleDefinitionId('018f0000-0000-7000-8000-000000000003'),
    roleKey: 'audience_strategist' as const,
    displayName: 'Audience Strategist',
    department: 'Insight desk',
    roleVersion: 1,
    allowedArtifactTypes: Object.freeze(['audience_insight_board']),
  }),
  Object.freeze({
    id: parseAgentRoleDefinitionId('018f0000-0000-7000-8000-000000000004'),
    roleKey: 'creative_director' as const,
    displayName: 'Creative Director',
    department: 'Creative studio',
    roleVersion: 1,
    allowedArtifactTypes: Object.freeze(['video_series_plan', 'video_idea']),
  }),
  Object.freeze({
    id: parseAgentRoleDefinitionId('018f0000-0000-7000-8000-000000000005'),
    roleKey: 'scriptwriter' as const,
    displayName: 'Scriptwriter',
    department: 'Content desk',
    roleVersion: 1,
    allowedArtifactTypes: Object.freeze([
      'script_package',
      'script',
      'shot_list',
      'caption_variant',
    ]),
  }),
  Object.freeze({
    id: parseAgentRoleDefinitionId('018f0000-0000-7000-8000-000000000006'),
    roleKey: 'compliance_reviewer' as const,
    displayName: 'Compliance Reviewer',
    department: 'Quality lab',
    roleVersion: 1,
    allowedArtifactTypes: Object.freeze(['compliance_report']),
  }),
]);
