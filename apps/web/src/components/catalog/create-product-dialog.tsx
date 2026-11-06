'use client';

import { useRef, useState, type FormEvent, type ReactElement } from 'react';
import type { CreateProductPayload } from '../../types/catalog.js';
import { generateCryptoIdempotencyKey } from '../../lib/crypto-idempotency.js';
import {
  createCanonicalPayloadSignature,
  IdempotencyKeyTracker,
  normalizeCanonicalProductUrlForSignature,
} from '../../lib/catalog-idempotency.js';

interface CreateProductDialogProps {
  readonly onSave: (payload: CreateProductPayload, idempotencyKey: string) => Promise<void>;
  readonly onCancel: () => void;
}

export function CreateProductDialog({ onSave, onCancel }: CreateProductDialogProps): ReactElement {
  const [name, setName] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [canonicalUrl, setCanonicalUrl] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [audienceNotes, setAudienceNotes] = useState('');
  const [allowedClaimsNotes, setAllowedClaimsNotes] = useState('');
  const [prohibitedClaimsNotes, setProhibitedClaimsNotes] = useState('');

  const keyTrackerRef = useRef<IdempotencyKeyTracker | null>(null);
  if (keyTrackerRef.current === null) {
    keyTrackerRef.current = new IdempotencyKeyTracker(generateCryptoIdempotencyKey);
  }
  const keyTracker = keyTrackerRef.current;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidUrl = (val: string): boolean => {
    try {
      const u = new URL(val);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const isFormValid =
    name.trim().length > 0 &&
    merchantName.trim().length > 0 &&
    canonicalUrl.trim().length > 0 &&
    isValidUrl(canonicalUrl.trim()) &&
    category.trim().length > 0 &&
    description.trim().length > 0 &&
    !isSubmitting;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;

    const payload: CreateProductPayload = {
      name: name.trim(),
      merchantName: merchantName.trim(),
      canonicalUrl: canonicalUrl.trim(),
      category: category.trim(),
      description: description.trim(),
      audienceNotes: audienceNotes.trim() ? audienceNotes.trim() : null,
      allowedClaimsNotes: allowedClaimsNotes.trim() ? allowedClaimsNotes.trim() : null,
      prohibitedClaimsNotes: prohibitedClaimsNotes.trim() ? prohibitedClaimsNotes.trim() : null,
    };
    const key = keyTracker.getKey(
      createCanonicalPayloadSignature({
        ...payload,
        canonicalUrl: normalizeCanonicalProductUrlForSignature(payload.canonicalUrl),
      }),
    );
    if (!key) {
      setError('Secure random number generator is unavailable. Please reload.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSave(payload, key);
      keyTracker.clear();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create product. Please retry.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-product-title"
      className="modal-content product-dialog"
    >
      <h2 id="create-product-title" className="modal-title">
        Create Product
      </h2>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      <form onSubmit={(e) => void handleSubmit(e)} className="form-container">
        <div className="form-group">
          <label htmlFor="product-name">Product Name *</label>
          <input
            id="product-name"
            type="text"
            required
            maxLength={256}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSubmitting}
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label htmlFor="merchant-name">Merchant Name *</label>
          <input
            id="merchant-name"
            type="text"
            required
            maxLength={256}
            value={merchantName}
            onChange={(e) => setMerchantName(e.target.value)}
            disabled={isSubmitting}
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label htmlFor="canonical-url">Canonical Product URL * (https://...)</label>
          <input
            id="canonical-url"
            type="url"
            required
            maxLength={2048}
            value={canonicalUrl}
            onChange={(e) => setCanonicalUrl(e.target.value)}
            disabled={isSubmitting}
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label htmlFor="product-category">Category *</label>
          <input
            id="product-category"
            type="text"
            required
            maxLength={128}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isSubmitting}
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label htmlFor="product-description">Description *</label>
          <textarea
            id="product-description"
            required
            maxLength={10000}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSubmitting}
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label htmlFor="audience-notes">Audience Notes</label>
          <textarea
            id="audience-notes"
            maxLength={5000}
            rows={2}
            value={audienceNotes}
            onChange={(e) => setAudienceNotes(e.target.value)}
            disabled={isSubmitting}
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label htmlFor="allowed-claims">Allowed Claims Notes</label>
          <textarea
            id="allowed-claims"
            maxLength={5000}
            rows={2}
            value={allowedClaimsNotes}
            onChange={(e) => setAllowedClaimsNotes(e.target.value)}
            disabled={isSubmitting}
            className="form-input"
          />
        </div>
        <div className="form-group">
          <label htmlFor="prohibited-claims">Prohibited Claims Notes</label>
          <textarea
            id="prohibited-claims"
            maxLength={5000}
            rows={2}
            value={prohibitedClaimsNotes}
            onChange={(e) => setProhibitedClaimsNotes(e.target.value)}
            disabled={isSubmitting}
            className="form-input"
          />
        </div>
        <div className="modal-actions">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button type="submit" disabled={!isFormValid || isSubmitting} className="btn-primary">
            {isSubmitting ? 'Creating...' : 'Create Product'}
          </button>
        </div>
      </form>
    </div>
  );
}
