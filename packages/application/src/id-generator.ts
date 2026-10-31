import crypto from 'node:crypto';
import {
  parseMembershipId,
  parseUserId,
  parseWorkspaceId,
  type MembershipId,
  type UserId,
  type WorkspaceId,
} from '@affiliate-content-os/domain';
import type { IdGeneratorPort } from './ports.js';

export function generateUuidV7(timestampMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  const ms = Math.floor(timestampMs);
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;

  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export class DefaultIdGenerator implements IdGeneratorPort {
  public generateWorkspaceId(): WorkspaceId {
    return parseWorkspaceId(generateUuidV7());
  }

  public generateMembershipId(): MembershipId {
    return parseMembershipId(generateUuidV7());
  }

  public generateUserId(): UserId {
    return parseUserId(generateUuidV7());
  }
}
