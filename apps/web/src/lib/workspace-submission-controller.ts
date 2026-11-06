import type { CreateWorkspacePayload } from './api-client.js';
import { ApiError } from './api-validators.js';
import { generateCryptoIdempotencyKey, normalizeWorkspacePayload } from './crypto-idempotency.js';

/**
 * Encapsulates idempotency key retention, rotation, cryptographic generation,
 * and double-submission protection for workspace creation.
 */
export class WorkspaceSubmissionController {
  private currentKey: string | null = null;
  private lastPayload: string | null = null;
  private isSubmitting = false;

  getIsSubmitting(): boolean {
    return this.isSubmitting;
  }

  getCurrentKey(): string | null {
    return this.currentKey;
  }

  async submit(
    payload: CreateWorkspacePayload,
    onSave: (payload: CreateWorkspacePayload, idempotencyKey: string) => Promise<void>,
  ): Promise<{ success: boolean; error?: string }> {
    if (this.isSubmitting) {
      return { success: false, error: 'Submission already in progress' };
    }

    const normalized = normalizeWorkspacePayload(
      payload.name,
      payload.slug,
      payload.timezone,
      payload.brandVoice,
      payload.defaultDisclosure,
      payload.aiEnabled,
    );

    let key = this.currentKey;
    if (!key || this.lastPayload !== normalized) {
      const generated = generateCryptoIdempotencyKey();
      if (!generated) {
        return {
          success: false,
          error:
            'Secure random generation is unavailable in this environment. Unable to create workspace safely.',
        };
      }
      key = generated;
      this.currentKey = generated;
      this.lastPayload = normalized;
    }

    this.isSubmitting = true;
    try {
      await onSave(payload, key);
      this.currentKey = null;
      this.lastPayload = null;
      return { success: true };
    } catch (err: unknown) {
      const message =
        err instanceof ApiError
          ? (err.problem.detail ?? err.problem.title ?? 'Failed to create workspace')
          : 'Failed to create workspace. Please check your connection and retry.';
      return { success: false, error: message };
    } finally {
      this.isSubmitting = false;
    }
  }

  reset(): void {
    this.currentKey = null;
    this.lastPayload = null;
    this.isSubmitting = false;
  }
}
