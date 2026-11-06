'use client';

import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import type {
  AffiliateDestinationDTO,
  CreateAffiliatePayload,
  UpdateAffiliatePayload,
} from '../../types/catalog.js';
import { generateCryptoIdempotencyKey } from '../../lib/crypto-idempotency.js';
import {
  createCanonicalPayloadSignature,
  IdempotencyKeyTracker,
} from '../../lib/catalog-idempotency.js';
import { ApiError } from '../../lib/api-validators-common.js';

interface AffiliateDestinationsSectionProps {
  readonly affiliates: readonly AffiliateDestinationDTO[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly canManage: boolean;
  readonly onRetry: () => void;
  readonly onCreate: (payload: CreateAffiliatePayload, key: string) => Promise<void>;
  readonly onUpdate: (
    destinationId: string,
    version: number,
    payload: UpdateAffiliatePayload,
  ) => Promise<void>;
  readonly onArchive: (destinationId: string) => Promise<void>;
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  readonly onLoadMore: () => void;
}

export function AffiliateDestinationsSection({
  affiliates,
  isLoading,
  error,
  canManage,
  onRetry,
  onCreate,
  onUpdate,
  onArchive,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: AffiliateDestinationsSectionProps): ReactElement {
  const [showCreate, setShowCreate] = useState(false);
  const [editingAffiliate, setEditingAffiliate] = useState<AffiliateDestinationDTO | null>(null);

  // Form states
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [networkName, setNetworkName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);
  const keyTrackerRef = useRef<IdempotencyKeyTracker | null>(null);
  if (keyTrackerRef.current === null) {
    keyTrackerRef.current = new IdempotencyKeyTracker(generateCryptoIdempotencyKey);
  }
  const keyTracker = keyTrackerRef.current;

  const resetForm = () => {
    setLabel('');
    setUrl('');
    setNetworkName('');
    setActionError(null);
    setIsConflict(false);
    setIsSubmitting(false);
    setShowCreate(false);
    setEditingAffiliate(null);
    keyTracker.clear();
  };

  const openCreate = () => {
    resetForm();
    setShowCreate(true);
  };

  const openEdit = (a: AffiliateDestinationDTO) => {
    setLabel(a.label);
    setUrl(a.url);
    setNetworkName(a.networkName ?? '');
    setActionError(null);
    setIsConflict(false);
    setIsSubmitting(false);
    setShowCreate(false);
    setEditingAffiliate(a);
  };

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !url.trim() || isSubmitting) return;

    const payload: CreateAffiliatePayload = {
      label: label.trim(),
      url: url.trim(),
      networkName: networkName.trim() ? networkName.trim() : null,
    };
    const key = keyTracker.getKey(createCanonicalPayloadSignature(payload));
    if (!key) {
      setActionError('Crypto RNG is unavailable.');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);
    try {
      await onCreate(payload, key);
      keyTracker.clear();
      resetForm();
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to create affiliate destination.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleArchive = async (destinationId: string) => {
    if (archivingId !== null || !globalThis.confirm('Archive this affiliate destination?')) return;
    setArchivingId(destinationId);
    setActionError(null);
    try {
      await onArchive(destinationId);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to archive destination.');
    } finally {
      setArchivingId(null);
    }
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingAffiliate || !label.trim() || !url.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setActionError(null);
    try {
      await onUpdate(editingAffiliate.id, editingAffiliate.version, {
        label: label.trim(),
        url: url.trim(),
        networkName: networkName.trim() ? networkName.trim() : null,
      });
      resetForm();
    } catch (err: unknown) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.problem.code === 'STALE_VERSION_CONFLICT'
      ) {
        setIsConflict(true);
        setActionError(
          'This destination changed elsewhere. Reload the latest list before editing.',
        );
        return;
      }
      setActionError(
        err instanceof Error ? err.message : 'Failed to update affiliate destination.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="affiliates-section">
      <div className="section-header">
        <h3 className="section-subtitle">Affiliate Destinations</h3>
        {canManage && (
          <button type="button" onClick={openCreate} className="btn-secondary btn-sm">
            + Add Link
          </button>
        )}
      </div>

      {actionError && !showCreate && editingAffiliate === null && (
        <div role="alert" className="error-banner">
          {actionError}
        </div>
      )}

      {isLoading ? (
        <div role="status" aria-live="polite" className="catalog-loading">
          Loading destinations...
        </div>
      ) : error ? (
        <div role="alert" className="error-banner">
          <p>{error}</p>
          <button type="button" onClick={onRetry} className="btn-secondary btn-sm">
            Retry
          </button>
        </div>
      ) : affiliates.length === 0 ? (
        <p className="empty-subtext">No affiliate destinations configured yet.</p>
      ) : (
        <>
          <ul role="list" className="affiliate-list">
            {affiliates.map((a) => (
              <li key={a.id} className="affiliate-card">
                <div className="affiliate-card-info">
                  <span className="affiliate-label">{a.label}</span>
                  {a.networkName && <span className="network-tag">{a.networkName}</span>}
                  <span className={`status-badge status-${a.status}`}>{a.status}</span>
                  <span className="affiliate-url-preview">{a.url}</span>
                </div>
                {canManage && a.status === 'active' && (
                  <div className="affiliate-actions">
                    <button
                      type="button"
                      onClick={() => openEdit(a)}
                      className="btn-secondary btn-sm"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleArchive(a.id)}
                      disabled={archivingId !== null}
                      className="btn-danger btn-sm"
                    >
                      {archivingId === a.id ? 'Archiving...' : 'Archive'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              className="btn-secondary btn-sm load-more-btn"
              disabled={isLoadingMore}
              onClick={onLoadMore}
            >
              {isLoadingMore ? 'Loading...' : 'Load more destinations'}
            </button>
          )}
        </>
      )}

      {(showCreate || editingAffiliate) && (
        <div className="modal-backdrop">
          <div role="dialog" aria-modal="true" className="modal-content">
            <h4 className="modal-title">{showCreate ? 'Add Destination' : 'Edit Destination'}</h4>
            {actionError && (
              <div role="alert" className="error-banner">
                {actionError}
                {isConflict && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      onRetry();
                      resetForm();
                    }}
                  >
                    Reload destinations
                  </button>
                )}
              </div>
            )}
            <form onSubmit={(e) => void (showCreate ? handleCreateSubmit(e) : handleEditSubmit(e))}>
              <div className="form-group">
                <label htmlFor="affiliate-label">Label *</label>
                <input
                  id="affiliate-label"
                  type="text"
                  required
                  maxLength={256}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  disabled={isSubmitting}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label htmlFor="affiliate-url">Destination URL *</label>
                <input
                  id="affiliate-url"
                  type="url"
                  required
                  maxLength={2048}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={isSubmitting}
                  className="form-input"
                />
              </div>
              <div className="form-group">
                <label htmlFor="affiliate-network">Network Name (optional)</label>
                <input
                  id="affiliate-network"
                  type="text"
                  maxLength={128}
                  value={networkName}
                  onChange={(e) => setNetworkName(e.target.value)}
                  disabled={isSubmitting}
                  className="form-input"
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={isSubmitting}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!label.trim() || !url.trim() || isSubmitting}
                  className="btn-primary"
                >
                  {isSubmitting ? 'Saving...' : showCreate ? 'Create' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
