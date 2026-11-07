'use client';

import { useState, type FormEvent, type ReactElement } from 'react';
import type {
  AffiliateDestinationDTO,
  CreateAffiliatePayload,
  CreateFactSetPayload,
  FactDTO,
  FactSetDTO,
  ProductDTO,
  UpdateAffiliatePayload,
  UpdateProductPayload,
} from '../../types/catalog.js';
import { AffiliateDestinationsSection } from './affiliate-destinations-section.js';
import { FactSetsSection } from './fact-sets-section.js';
import { AnalysesSection } from './analyses-section.js';
import { ApiError } from '../../lib/api-validators-common.js';

interface ProductDetailViewProps {
  readonly product: ProductDTO;
  readonly canManage: boolean;
  readonly affiliates: readonly AffiliateDestinationDTO[];
  readonly isAffiliatesLoading: boolean;
  readonly affiliatesError: string | null;
  readonly factSets: readonly FactSetDTO[];
  readonly activeRevisionId: string | null;
  readonly selectedRevisionFacts: readonly FactDTO[];
  readonly isFactSetsLoading: boolean;
  readonly isFactsLoading: boolean;
  readonly factSetsError: string | null;
  readonly onRefreshProduct: () => Promise<void>;
  readonly onUpdateProduct: (version: number, payload: UpdateProductPayload) => Promise<void>;
  readonly onArchiveProduct: () => Promise<void>;
  readonly onRetryAffiliates: () => void;
  readonly onCreateAffiliate: (payload: CreateAffiliatePayload, key: string) => Promise<void>;
  readonly onUpdateAffiliate: (
    destinationId: string,
    version: number,
    payload: UpdateAffiliatePayload,
  ) => Promise<void>;
  readonly onArchiveAffiliate: (destinationId: string) => Promise<void>;
  readonly onSelectRevision: (factSetId: string) => void;
  readonly onRetryFactSets: () => void;
  readonly onProposeFactSet: (payload: CreateFactSetPayload, key: string) => Promise<void>;
  readonly onConfirmFactSet: (factSetId: string) => Promise<void>;
  readonly affiliatesHasMore: boolean;
  readonly isAffiliatesLoadingMore: boolean;
  readonly onLoadMoreAffiliates: () => void;
  readonly factSetsHasMore: boolean;
  readonly isFactSetsLoadingMore: boolean;
  readonly onLoadMoreFactSets: () => void;
}

export function ProductDetailView(props: ProductDetailViewProps): ReactElement {
  const { product, canManage, onUpdateProduct, onArchiveProduct, onRefreshProduct } = props;

  const [isEditing, setIsEditing] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  // Edit form state
  const [name, setName] = useState(product.name);
  const [merchantName, setMerchantName] = useState(product.merchantName);
  const [canonicalUrl, setCanonicalUrl] = useState(product.canonicalUrl);
  const [category, setCategory] = useState(product.category);
  const [description, setDescription] = useState(product.description);
  const [audienceNotes, setAudienceNotes] = useState(product.audienceNotes ?? '');
  const [allowedClaimsNotes, setAllowedClaimsNotes] = useState(product.allowedClaimsNotes ?? '');
  const [prohibitedClaimsNotes, setProhibitedClaimsNotes] = useState(
    product.prohibitedClaimsNotes ?? '',
  );
  const [status, setStatus] = useState<'draft' | 'active'>(
    product.status === 'active' ? 'active' : 'draft',
  );

  const startEdit = () => {
    setName(product.name);
    setMerchantName(product.merchantName);
    setCanonicalUrl(product.canonicalUrl);
    setCategory(product.category);
    setDescription(product.description);
    setAudienceNotes(product.audienceNotes ?? '');
    setAllowedClaimsNotes(product.allowedClaimsNotes ?? '');
    setProhibitedClaimsNotes(product.prohibitedClaimsNotes ?? '');
    setStatus(product.status === 'active' ? 'active' : 'draft');
    setError(null);
    setIsConflict(false);
    setIsEditing(true);
  };

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setIsConflict(false);

    try {
      await onUpdateProduct(product.version, {
        name: name.trim(),
        merchantName: merchantName.trim(),
        canonicalUrl: canonicalUrl.trim(),
        category: category.trim(),
        description: description.trim(),
        audienceNotes: audienceNotes.trim() ? audienceNotes.trim() : null,
        allowedClaimsNotes: allowedClaimsNotes.trim() ? allowedClaimsNotes.trim() : null,
        prohibitedClaimsNotes: prohibitedClaimsNotes.trim() ? prohibitedClaimsNotes.trim() : null,
        status,
      });
      setIsEditing(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update product.';
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.problem.code === 'STALE_VERSION_CONFLICT'
      ) {
        setIsConflict(true);
        setError(
          'Version Conflict: This product has been updated elsewhere. Please refresh to load latest version and try again.',
        );
      } else {
        setError(msg);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchive = async () => {
    setIsArchiving(true);
    try {
      await onArchiveProduct();
      setShowArchiveConfirm(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to archive product.');
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <div className="product-detail-container">
      <div className="product-detail-header">
        <div>
          <div className="detail-title-row">
            <h2 className="detail-product-name">{product.name}</h2>
            <span className={`status-badge status-${product.status}`}>{product.status}</span>
            {product.duplicateWarning && <span className="badge-warning">Duplicate URL</span>}
          </div>
          <p className="detail-merchant">
            Merchant: {product.merchantName} &bull; Category: {product.category}
          </p>
        </div>

        {canManage && product.status !== 'archived' && (
          <div className="detail-header-actions">
            {!isEditing && (
              <>
                <button type="button" onClick={startEdit} className="btn-secondary btn-sm">
                  Edit Details
                </button>
                <button
                  type="button"
                  onClick={() => setShowArchiveConfirm(true)}
                  className="btn-danger btn-sm"
                >
                  Archive
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="error-banner">
          <p>{error}</p>
          {isConflict && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await onRefreshProduct();
                  setIsEditing(false);
                  setError(null);
                  setIsConflict(false);
                } catch (err: unknown) {
                  setError(err instanceof Error ? err.message : 'Failed to refresh product.');
                }
              }}
              className="btn-secondary btn-sm btn-retry"
            >
              Refresh Product
            </button>
          )}
        </div>
      )}

      {isEditing ? (
        <form
          onSubmit={(e) => void handleEditSubmit(e)}
          className="form-container edit-product-form"
        >
          <div className="form-group">
            <label htmlFor="edit-name">Name *</label>
            <input
              id="edit-name"
              type="text"
              required
              maxLength={256}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSaving}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label htmlFor="edit-merchant">Merchant Name *</label>
            <input
              id="edit-merchant"
              type="text"
              required
              maxLength={256}
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              disabled={isSaving}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label htmlFor="edit-url">Canonical URL *</label>
            <input
              id="edit-url"
              type="url"
              required
              maxLength={2048}
              value={canonicalUrl}
              onChange={(e) => setCanonicalUrl(e.target.value)}
              disabled={isSaving}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label htmlFor="edit-category">Category *</label>
            <input
              id="edit-category"
              type="text"
              required
              maxLength={128}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={isSaving}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label htmlFor="edit-status">Status</label>
            <select
              id="edit-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'active')}
              disabled={isSaving}
              className="form-select"
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="edit-description">Description *</label>
            <textarea
              id="edit-description"
              required
              maxLength={10000}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSaving}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label htmlFor="edit-audience">Audience Notes</label>
            <textarea
              id="edit-audience"
              maxLength={5000}
              rows={2}
              value={audienceNotes}
              onChange={(e) => setAudienceNotes(e.target.value)}
              disabled={isSaving}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label htmlFor="edit-allowed">Allowed Claims Notes</label>
            <textarea
              id="edit-allowed"
              maxLength={5000}
              rows={2}
              value={allowedClaimsNotes}
              onChange={(e) => setAllowedClaimsNotes(e.target.value)}
              disabled={isSaving}
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label htmlFor="edit-prohibited">Prohibited Claims Notes</label>
            <textarea
              id="edit-prohibited"
              maxLength={5000}
              rows={2}
              value={prohibitedClaimsNotes}
              onChange={(e) => setProhibitedClaimsNotes(e.target.value)}
              disabled={isSaving}
              className="form-input"
            />
          </div>
          <div className="modal-actions">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              disabled={isSaving}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="btn-primary">
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      ) : (
        <div className="product-summary-card">
          <div className="summary-field">
            <span className="field-label">Canonical URL:</span>
            <span className="field-value">
              <a href={product.canonicalUrl} target="_blank" rel="noopener noreferrer">
                {product.canonicalUrl}
              </a>
            </span>
          </div>
          <div className="summary-field">
            <span className="field-label">Description:</span>
            <p className="field-value">{product.description}</p>
          </div>
          {product.audienceNotes && (
            <div className="summary-field">
              <span className="field-label">Audience Notes:</span>
              <p className="field-value">{product.audienceNotes}</p>
            </div>
          )}
          {product.allowedClaimsNotes && (
            <div className="summary-field">
              <span className="field-label">Allowed Claims:</span>
              <p className="field-value">{product.allowedClaimsNotes}</p>
            </div>
          )}
          {product.prohibitedClaimsNotes && (
            <div className="summary-field">
              <span className="field-label">Prohibited Claims:</span>
              <p className="field-value">{product.prohibitedClaimsNotes}</p>
            </div>
          )}
        </div>
      )}

      <AffiliateDestinationsSection
        affiliates={props.affiliates}
        isLoading={props.isAffiliatesLoading}
        error={props.affiliatesError}
        canManage={canManage}
        onRetry={props.onRetryAffiliates}
        onCreate={props.onCreateAffiliate}
        onUpdate={props.onUpdateAffiliate}
        onArchive={props.onArchiveAffiliate}
        hasMore={props.affiliatesHasMore}
        isLoadingMore={props.isAffiliatesLoadingMore}
        onLoadMore={props.onLoadMoreAffiliates}
      />

      <FactSetsSection
        factSets={props.factSets}
        activeRevisionId={props.activeRevisionId}
        currentConfirmedFactSetId={product.currentFactSetId}
        selectedRevisionFacts={props.selectedRevisionFacts}
        isLoading={props.isFactSetsLoading}
        isFactsLoading={props.isFactsLoading}
        error={props.factSetsError}
        canManage={canManage}
        onSelectRevision={props.onSelectRevision}
        onRetry={props.onRetryFactSets}
        onPropose={props.onProposeFactSet}
        onConfirm={props.onConfirmFactSet}
        hasMore={props.factSetsHasMore}
        isLoadingMore={props.isFactSetsLoadingMore}
        onLoadMore={props.onLoadMoreFactSets}
      />

      <AnalysesSection
        workspaceId={product.workspaceId}
        productId={product.id}
        factSetId={product.currentFactSetId}
        canManage={canManage}
      />

      {showArchiveConfirm && (
        <div className="modal-backdrop">
          <div role="dialog" aria-modal="true" className="modal-content confirm-dialog">
            <h4 className="modal-title">Archive Product &ldquo;{product.name}&rdquo;</h4>
            <p className="warning-text">
              Are you sure you want to archive this product? Archived products remain readable in
              catalog history but cannot be targeted for new analyses.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setShowArchiveConfirm(false)}
                disabled={isArchiving}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleArchive()}
                disabled={isArchiving}
                className="btn-danger"
              >
                {isArchiving ? 'Archiving...' : 'Archive Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
