'use client';

import { useState, type ReactElement } from 'react';
import type { CreateFactSetPayload, FactDTO, FactSetDTO } from '../../types/catalog.js';
import { CreateFactSetDialog } from './create-fact-set-dialog.js';

interface FactSetsSectionProps {
  readonly factSets: readonly FactSetDTO[];
  readonly activeRevisionId: string | null;
  readonly currentConfirmedFactSetId: string | null;
  readonly selectedRevisionFacts: readonly FactDTO[];
  readonly isLoading: boolean;
  readonly isFactsLoading: boolean;
  readonly error: string | null;
  readonly canManage: boolean;
  readonly onSelectRevision: (factSetId: string) => void;
  readonly onRetry: () => void;
  readonly onPropose: (payload: CreateFactSetPayload, idempotencyKey: string) => Promise<void>;
  readonly onConfirm: (factSetId: string) => Promise<void>;
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  readonly onLoadMore: () => void;
}

export function FactSetsSection({
  factSets,
  activeRevisionId,
  currentConfirmedFactSetId,
  selectedRevisionFacts,
  isLoading,
  isFactsLoading,
  error,
  canManage,
  onSelectRevision,
  onRetry,
  onPropose,
  onConfirm,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: FactSetsSectionProps): ReactElement {
  const [showProposeModal, setShowProposeModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const activeFactSet = factSets.find((f) => f.id === activeRevisionId) ?? factSets[0];

  const handleConfirmSubmit = async () => {
    if (!activeFactSet || isConfirming) return;
    setIsConfirming(true);
    setConfirmError(null);
    try {
      await onConfirm(activeFactSet.id);
      setShowConfirmModal(false);
    } catch (err: unknown) {
      setConfirmError(err instanceof Error ? err.message : 'Confirmation failed. Please retry.');
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="fact-sets-section">
      <div className="section-header">
        <div className="section-title-group">
          <h3 className="section-subtitle">Fact Sets & Provenance</h3>
          {currentConfirmedFactSetId && (
            <span className="badge-confirmed-active">Active Fact Set Confirmed</span>
          )}
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowProposeModal(true)}
            className="btn-secondary btn-sm"
          >
            + Propose Revision
          </button>
        )}
      </div>

      {isLoading ? (
        <div role="status" aria-live="polite" className="catalog-loading">
          Loading revisions...
        </div>
      ) : error ? (
        <div role="alert" className="error-banner">
          <p>{error}</p>
          <button type="button" onClick={onRetry} className="btn-secondary btn-sm">
            Retry
          </button>
        </div>
      ) : factSets.length === 0 ? (
        <p className="empty-subtext">No fact sets proposed yet.</p>
      ) : (
        <div className="fact-sets-layout">
          <div className="revision-sidebar">
            <h4 className="sidebar-heading">Revisions</h4>
            <ul role="list" className="revision-list">
              {factSets.map((fs) => {
                const isSelected = fs.id === (activeFactSet?.id ?? '');
                const isCurrent = fs.id === currentConfirmedFactSetId;
                return (
                  <li key={fs.id}>
                    <button
                      type="button"
                      onClick={() => onSelectRevision(fs.id)}
                      className={`revision-item ${isSelected ? 'selected' : ''}`}
                    >
                      <div className="revision-title">
                        <span>Rev {fs.revisionNumber}</span>
                        {isCurrent && <span className="badge-active">Current</span>}
                      </div>
                      <span className={`status-badge status-${fs.status}`}>{fs.status}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {hasMore && (
              <button
                type="button"
                className="btn-secondary btn-sm load-more-btn"
                disabled={isLoadingMore}
                onClick={onLoadMore}
              >
                {isLoadingMore ? 'Loading...' : 'Load more revisions'}
              </button>
            )}
          </div>

          <div className="revision-content">
            {activeFactSet && (
              <>
                <div className="revision-meta-bar">
                  <div>
                    <h4>
                      Revision #{activeFactSet.revisionNumber} ({activeFactSet.status})
                    </h4>
                    {activeFactSet.summary && (
                      <p className="revision-summary">{activeFactSet.summary}</p>
                    )}
                  </div>
                  {canManage && activeFactSet.status === 'proposed' && (
                    <button
                      type="button"
                      onClick={() => setShowConfirmModal(true)}
                      className="btn-primary btn-sm confirm-btn"
                    >
                      Confirm Revision
                    </button>
                  )}
                </div>

                <div className="fact-provenance-notice" role="note">
                  <strong>Grounding Rule:</strong> Only confirmed facts in a confirmed revision may
                  ground affirmative AI claims. Suggested or uncertain facts are never implied to be
                  verified.
                </div>

                {isFactsLoading ? (
                  <div role="status" aria-live="polite" className="catalog-loading">
                    Loading facts...
                  </div>
                ) : selectedRevisionFacts.length === 0 ? (
                  <p className="empty-subtext">No facts recorded in this revision.</p>
                ) : (
                  <div className="facts-table-container">
                    <table className="facts-table">
                      <thead>
                        <tr>
                          <th>Fact Key</th>
                          <th>Value</th>
                          <th>Confidence</th>
                          <th>Claim Usage</th>
                          <th>Provenance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRevisionFacts.map((fact) => (
                          <tr key={fact.id}>
                            <td className="fact-key-cell">
                              <code>{fact.factKey}</code>
                            </td>
                            <td className="fact-value-cell">{fact.valueText}</td>
                            <td>
                              <span className={`confidence-badge confidence-${fact.confidence}`}>
                                {fact.confidence}
                              </span>
                            </td>
                            <td>
                              <span className={`usage-badge usage-${fact.claimUsage}`}>
                                {fact.claimUsage}
                              </span>
                            </td>
                            <td className="fact-provenance-cell">
                              <span className="source-type">{fact.sourceType}</span>
                              {fact.sourceUrl && (
                                <a
                                  href={fact.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="source-url-link"
                                >
                                  Source
                                </a>
                              )}
                              {fact.sourceExcerpt && (
                                <span className="source-excerpt" title={fact.sourceExcerpt}>
                                  &ldquo;{fact.sourceExcerpt}&rdquo;
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {showProposeModal && (
        <div className="modal-backdrop">
          <CreateFactSetDialog
            onSave={async (payload, key) => {
              await onPropose(payload, key);
              setShowProposeModal(false);
            }}
            onCancel={() => setShowProposeModal(false)}
          />
        </div>
      )}

      {showConfirmModal && activeFactSet && (
        <div className="modal-backdrop">
          <div role="dialog" aria-modal="true" className="modal-content confirm-dialog">
            <h4 className="modal-title">
              Confirm Fact Set Revision #{activeFactSet.revisionNumber}
            </h4>
            {confirmError && (
              <div role="alert" className="error-banner">
                {confirmError}
              </div>
            )}
            <p className="warning-text">
              Warning: Confirming this fact set makes it immutable and establishes it as the active
              fact set for product grounding. Any subsequent corrections will require proposing a
              new revision.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isConfirming}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmSubmit()}
                disabled={isConfirming}
                className="btn-primary"
              >
                {isConfirming ? 'Confirming...' : 'Yes, Confirm Revision'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
