'use client';

import { type ReactElement } from 'react';
import type { ProductDTO } from '../../types/catalog.js';

interface ProductListViewProps {
  readonly products: readonly ProductDTO[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly selectedProductId: string | null;
  readonly statusFilter: string;
  readonly canManage: boolean;
  readonly onSelectProduct: (productId: string) => void;
  readonly onFilterChange: (status: string) => void;
  readonly onOpenCreate: () => void;
  readonly onRetry: () => void;
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  readonly onLoadMore: () => void;
}

export function ProductListView({
  products,
  isLoading,
  error,
  selectedProductId,
  statusFilter,
  canManage,
  onSelectProduct,
  onFilterChange,
  onOpenCreate,
  onRetry,
  hasMore,
  isLoadingMore,
  onLoadMore,
}: ProductListViewProps): ReactElement {
  return (
    <div className="product-list-panel">
      <div className="product-list-header">
        <div className="product-list-title-group">
          <h2 className="section-title">Products</h2>
          <span className="count-badge">{products.length}</span>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={onOpenCreate}
            className="btn-primary btn-sm create-product-btn"
          >
            + New Product
          </button>
        )}
      </div>

      <div className="product-filter-bar">
        <label htmlFor="product-status-filter" className="sr-only">
          Filter by status
        </label>
        <select
          id="product-status-filter"
          value={statusFilter}
          onChange={(e) => onFilterChange(e.target.value)}
          className="form-select filter-select"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {isLoading ? (
        <div role="status" aria-live="polite" className="catalog-loading">
          Loading products...
        </div>
      ) : error ? (
        <div role="alert" className="error-banner">
          <p>{error}</p>
          <button type="button" onClick={onRetry} className="btn-secondary btn-sm">
            Retry
          </button>
        </div>
      ) : products.length === 0 ? (
        <div className="empty-state">
          <p className="empty-text">No products in this workspace.</p>
          {canManage && (
            <button type="button" onClick={onOpenCreate} className="btn-primary btn-sm">
              Create your first product
            </button>
          )}
        </div>
      ) : (
        <>
          <ul role="list" className="product-list">
            {products.map((p) => {
              const isSelected = p.id === selectedProductId;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onSelectProduct(p.id)}
                    className={`product-list-item ${isSelected ? 'selected' : ''}`}
                    aria-current={isSelected ? 'true' : undefined}
                  >
                    <div className="product-item-main">
                      <span className="product-item-name">{p.name}</span>
                      <span className="product-item-merchant">{p.merchantName}</span>
                    </div>
                    <div className="product-item-meta">
                      <span className={`status-badge status-${p.status}`}>{p.status}</span>
                      {p.duplicateWarning && (
                        <span
                          className="badge-warning"
                          title="Another product uses the same canonical URL"
                        >
                          Duplicate URL
                        </span>
                      )}
                    </div>
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
              {isLoadingMore ? 'Loading...' : 'Load more products'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
