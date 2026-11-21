import crypto from 'node:crypto';
import { DomainValidationError } from '../errors.js';

export const MAX_THREADS_TEXT_LENGTH = 500;

export interface RenderableVideoInput {
  readonly title?: string | undefined;
  readonly hook?:
    | {
        readonly spokenHook?: string | undefined;
        readonly visualHook?: string | undefined;
      }
    | undefined;
  readonly voiceOver?: string | undefined;
  readonly callToAction?:
    | {
        readonly text?: string | undefined;
        readonly visualDirection?: string | undefined;
      }
    | undefined;
  readonly disclosure?:
    | {
        readonly placement?: string | undefined;
        readonly text?: string | undefined;
      }
    | undefined;
}

export function renderPublicationText(
  video: RenderableVideoInput,
  options?: {
    readonly explicitDisclosure?: string | undefined;
    readonly maxLength?: number | undefined;
  },
): string {
  const parts: string[] = [];

  const spoken = video.hook?.spokenHook?.trim();
  if (spoken) {
    parts.push(spoken);
  }

  const cta = video.callToAction?.text?.trim();
  if (cta) {
    parts.push(cta);
  }

  const disclosure = options?.explicitDisclosure?.trim() || video.disclosure?.text?.trim();
  if (disclosure) {
    parts.push(disclosure);
  }

  let text = parts.join('\n\n').trim();

  // Fallback to voiceOver or title if spoken hook / cta were empty
  if (!text) {
    if (video.voiceOver?.trim()) {
      text = video.voiceOver.trim();
    } else if (video.title?.trim()) {
      text = video.title.trim();
    }
  }

  if (!text) {
    throw new DomainValidationError('Rendered publication text cannot be empty');
  }

  const maxLen = options?.maxLength ?? MAX_THREADS_TEXT_LENGTH;
  if (text.length > maxLen) {
    throw new DomainValidationError(
      `Rendered publication text length (${text.length}) exceeds maximum allowed of ${maxLen} characters`,
    );
  }

  return text;
}

export function computePreviewHash(renderedText: string): Uint8Array {
  return new Uint8Array(crypto.createHash('sha256').update(renderedText, 'utf8').digest());
}

export function computePreviewHashHex(renderedText: string): string {
  return Buffer.from(computePreviewHash(renderedText)).toString('hex');
}
