'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type {
  AffiliateDestinationDTO,
  CreateAffiliatePayload,
  CreateFactSetPayload,
  CreateProductPayload,
  FactDTO,
  FactSetDTO,
  ProductDTO,
  UpdateAffiliatePayload,
  UpdateProductPayload,
} from '../../types/catalog.js';
import {
  archiveAffiliateApi,
  archiveProductApi,
  confirmFactSetApi,
  createAffiliateApi,
  createFactSetApi,
  createProductApi,
  fetchAffiliatesApi,
  fetchFactSetApi,
  fetchFactSetsApi,
  fetchProductApi,
  fetchProductsApi,
  updateAffiliateApi,
  updateProductApi,
} from '../../lib/catalog-api-client.js';
import { CatalogRequestCoordinator } from '../../lib/catalog-request-coordinator.js';
import { CreateProductDialog } from './create-product-dialog.js';
import { ProductDetailView } from './product-detail-view.js';
import { ProductListView } from './product-list-view.js';

interface CatalogWorkspaceViewProps {
  readonly workspaceId: string;
  readonly userRole: 'owner' | 'editor' | 'viewer';
}

export function CatalogWorkspaceView({
  workspaceId,
  userRole,
}: CatalogWorkspaceViewProps): ReactElement {
  const canManage = userRole === 'owner' || userRole === 'editor';

  // State
  const [products, setProducts] = useState<readonly ProductDTO[]>([]);
  const [isProductsLoading, setIsProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productsNextCursor, setProductsNextCursor] = useState<string | null>(null);
  const [isProductsLoadingMore, setIsProductsLoadingMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductDTO | null>(null);
  const [isProductDetailLoading, setIsProductDetailLoading] = useState(false);
  const [productDetailError, setProductDetailError] = useState<string | null>(null);

  const [affiliates, setAffiliates] = useState<readonly AffiliateDestinationDTO[]>([]);
  const [isAffiliatesLoading, setIsAffiliatesLoading] = useState(false);
  const [affiliatesError, setAffiliatesError] = useState<string | null>(null);
  const [affiliatesNextCursor, setAffiliatesNextCursor] = useState<string | null>(null);
  const [isAffiliatesLoadingMore, setIsAffiliatesLoadingMore] = useState(false);

  const [factSets, setFactSets] = useState<readonly FactSetDTO[]>([]);
  const [activeRevisionId, setActiveRevisionId] = useState<string | null>(null);
  const [selectedRevisionFacts, setSelectedRevisionFacts] = useState<readonly FactDTO[]>([]);
  const [isFactSetsLoading, setIsFactSetsLoading] = useState(false);
  const [isFactsLoading, setIsFactsLoading] = useState(false);
  const [factSetsError, setFactSetsError] = useState<string | null>(null);
  const [factSetsNextCursor, setFactSetsNextCursor] = useState<string | null>(null);
  const [isFactSetsLoadingMore, setIsFactSetsLoadingMore] = useState(false);

  const [showCreateProduct, setShowCreateProduct] = useState(false);

  const productCoordinatorRef = useRef(new CatalogRequestCoordinator());
  const detailCoordinatorRef = useRef(new CatalogRequestCoordinator());
  const affiliateCoordinatorRef = useRef(new CatalogRequestCoordinator());
  const factSetCoordinatorRef = useRef(new CatalogRequestCoordinator());
  const factDetailCoordinatorRef = useRef(new CatalogRequestCoordinator());
  const selectedProductIdRef = useRef<string | null>(null);

  const mergeById = <T extends { readonly id: string }>(
    current: readonly T[],
    next: readonly T[],
  ): readonly T[] => {
    const byId = new Map(current.map((item) => [item.id, item]));
    for (const item of next) byId.set(item.id, item);
    return [...byId.values()];
  };

  const loadProducts = async (after?: string, append = false) => {
    const handle = productCoordinatorRef.current.startRequest();
    if (append) setIsProductsLoadingMore(true);
    else setIsProductsLoading(true);
    setProductsError(null);

    try {
      const res = await fetchProductsApi(
        workspaceId,
        {
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(after ? { after } : {}),
        },
        handle.signal,
      );
      if (!productCoordinatorRef.current.isCurrent(handle.sequence)) return;
      setProducts((prev) => (append ? mergeById(prev, res.items) : res.items));
      setProductsNextCursor(res.page.nextCursor);
      setIsProductsLoading(false);
      setIsProductsLoadingMore(false);
    } catch (err: unknown) {
      if (!productCoordinatorRef.current.isCurrent(handle.sequence)) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setProductsError(err instanceof Error ? err.message : 'Failed to load products.');
      setIsProductsLoading(false);
      setIsProductsLoadingMore(false);
    }
  };

  useEffect(() => {
    productCoordinatorRef.current.invalidate();
    detailCoordinatorRef.current.invalidate();
    affiliateCoordinatorRef.current.invalidate();
    factSetCoordinatorRef.current.invalidate();
    factDetailCoordinatorRef.current.invalidate();
    selectedProductIdRef.current = null;
    setSelectedProductId(null);
    setSelectedProduct(null);
    setAffiliates([]);
    setFactSets([]);
    setSelectedRevisionFacts([]);
    setProductsNextCursor(null);
    void loadProducts();
  }, [workspaceId, statusFilter]);

  const loadFactSetDetails = async (pId: string, fsId: string) => {
    const handle = factDetailCoordinatorRef.current.startRequest();
    setIsFactsLoading(true);
    setSelectedRevisionFacts([]);
    try {
      const res = await fetchFactSetApi(workspaceId, pId, fsId, handle.signal);
      if (!factDetailCoordinatorRef.current.isCurrent(handle.sequence)) return;
      setSelectedRevisionFacts(res.facts);
    } catch (err: unknown) {
      if (!factDetailCoordinatorRef.current.isCurrent(handle.sequence)) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setSelectedRevisionFacts([]);
    } finally {
      if (factDetailCoordinatorRef.current.isCurrent(handle.sequence)) setIsFactsLoading(false);
    }
  };

  const loadAffiliates = async (pId: string, after?: string, append = false) => {
    const handle = affiliateCoordinatorRef.current.startRequest();
    if (append) setIsAffiliatesLoadingMore(true);
    else setIsAffiliatesLoading(true);
    setAffiliatesError(null);
    try {
      const res = await fetchAffiliatesApi(
        workspaceId,
        pId,
        after ? { after } : undefined,
        handle.signal,
      );
      if (!affiliateCoordinatorRef.current.isCurrent(handle.sequence)) return;
      setAffiliates((prev) => (append ? mergeById(prev, res.items) : res.items));
      setAffiliatesNextCursor(res.page.nextCursor);
    } catch (err: unknown) {
      if (!affiliateCoordinatorRef.current.isCurrent(handle.sequence)) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setAffiliatesError(err instanceof Error ? err.message : 'Failed to load destinations.');
    } finally {
      if (affiliateCoordinatorRef.current.isCurrent(handle.sequence)) {
        setIsAffiliatesLoading(false);
        setIsAffiliatesLoadingMore(false);
      }
    }
  };

  const loadFactSets = async (
    pId: string,
    preferredRevisionId?: string | null,
    after?: string,
    append = false,
  ) => {
    const handle = factSetCoordinatorRef.current.startRequest();
    if (append) setIsFactSetsLoadingMore(true);
    else setIsFactSetsLoading(true);
    setFactSetsError(null);
    try {
      const res = await fetchFactSetsApi(
        workspaceId,
        pId,
        after ? { after } : undefined,
        handle.signal,
      );
      if (!factSetCoordinatorRef.current.isCurrent(handle.sequence)) return;
      setFactSets((prev) => (append ? mergeById(prev, res.items) : res.items));
      setFactSetsNextCursor(res.page.nextCursor);
      if (!append) {
        const targetRevision = preferredRevisionId ?? res.items[0]?.id ?? null;
        setActiveRevisionId(targetRevision);
        if (targetRevision) void loadFactSetDetails(pId, targetRevision);
      }
    } catch (err: unknown) {
      if (!factSetCoordinatorRef.current.isCurrent(handle.sequence)) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setFactSetsError(err instanceof Error ? err.message : 'Failed to load fact sets.');
    } finally {
      if (factSetCoordinatorRef.current.isCurrent(handle.sequence)) {
        setIsFactSetsLoading(false);
        setIsFactSetsLoadingMore(false);
      }
    }
  };

  const loadProductDetails = async (productId: string) => {
    const handle = detailCoordinatorRef.current.startRequest();
    affiliateCoordinatorRef.current.invalidate();
    factSetCoordinatorRef.current.invalidate();
    factDetailCoordinatorRef.current.invalidate();
    selectedProductIdRef.current = productId;
    setSelectedProductId(productId);
    setSelectedProduct(null);
    setProductDetailError(null);
    setIsProductDetailLoading(true);
    setAffiliates([]);
    setFactSets([]);
    setSelectedRevisionFacts([]);
    setAffiliatesNextCursor(null);
    setFactSetsNextCursor(null);

    try {
      const prod = await fetchProductApi(workspaceId, productId, handle.signal);
      if (!detailCoordinatorRef.current.isCurrent(handle.sequence)) return;

      setSelectedProduct(prod);
      setIsProductDetailLoading(false);
      void loadAffiliates(productId);
      void loadFactSets(productId, prod.currentFactSetId);
    } catch (err: unknown) {
      if (!detailCoordinatorRef.current.isCurrent(handle.sequence)) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setProductDetailError(err instanceof Error ? err.message : 'Failed to load product details.');
      setIsProductDetailLoading(false);
    }
  };

  const handleSelectProduct = (productId: string) => {
    void loadProductDetails(productId);
  };

  const handleCreateProductSave = async (payload: CreateProductPayload, key: string) => {
    const created = await createProductApi(workspaceId, payload, key);
    setShowCreateProduct(false);
    await loadProducts();
    void loadProductDetails(created.id);
  };

  const handleUpdateProduct = async (version: number, payload: UpdateProductPayload) => {
    const productId = selectedProductIdRef.current;
    if (!productId) return;
    const updated = await updateProductApi(workspaceId, productId, version, payload);
    if (selectedProductIdRef.current !== productId) return;
    setSelectedProduct(updated);
    setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleArchiveProduct = async () => {
    const productId = selectedProductIdRef.current;
    if (!productId) return;
    const archived = await archiveProductApi(workspaceId, productId);
    if (selectedProductIdRef.current !== productId) return;
    setSelectedProduct(archived);
    setProducts((prev) => prev.map((p) => (p.id === archived.id ? archived : p)));
  };

  const handleCreateAffiliate = async (payload: CreateAffiliatePayload, key: string) => {
    const productId = selectedProductIdRef.current;
    if (!productId) return;
    const created = await createAffiliateApi(workspaceId, productId, payload, key);
    if (selectedProductIdRef.current !== productId) return;
    setAffiliates((prev) => [created, ...prev]);
  };

  const handleUpdateAffiliate = async (
    destinationId: string,
    version: number,
    payload: UpdateAffiliatePayload,
  ) => {
    const productId = selectedProductIdRef.current;
    if (!productId) return;
    const updated = await updateAffiliateApi(
      workspaceId,
      productId,
      destinationId,
      version,
      payload,
    );
    if (selectedProductIdRef.current !== productId) return;
    setAffiliates((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  const handleArchiveAffiliate = async (destinationId: string) => {
    const productId = selectedProductIdRef.current;
    if (!productId) return;
    const archived = await archiveAffiliateApi(workspaceId, productId, destinationId);
    if (selectedProductIdRef.current !== productId) return;
    setAffiliates((prev) => prev.map((a) => (a.id === archived.id ? archived : a)));
  };

  const handleProposeFactSet = async (payload: CreateFactSetPayload, key: string) => {
    const productId = selectedProductIdRef.current;
    if (!productId) return;
    const created = await createFactSetApi(workspaceId, productId, payload, key);
    if (selectedProductIdRef.current !== productId) return;
    factDetailCoordinatorRef.current.invalidate();
    setFactSets((prev) => [created.factSet, ...prev]);
    setActiveRevisionId(created.factSet.id);
    setSelectedRevisionFacts(created.facts);
  };

  const handleConfirmFactSet = async (factSetId: string) => {
    const productId = selectedProductIdRef.current;
    if (!productId) return;
    const confirmed = await confirmFactSetApi(workspaceId, productId, factSetId);
    if (selectedProductIdRef.current !== productId) return;
    setSelectedProduct(confirmed.product);
    setProducts((prev) => prev.map((p) => (p.id === confirmed.product.id ? confirmed.product : p)));
    setFactSets((prev) => prev.map((f) => (f.id === confirmed.factSet.id ? confirmed.factSet : f)));
  };

  return (
    <div className="catalog-workspace-view">
      {!canManage && (
        <div role="status" className="viewer-readonly-banner">
          <span>
            Viewing as <strong>Viewer</strong>. Catalog modifications are disabled.
          </span>
        </div>
      )}

      <div className="catalog-layout">
        <aside className="catalog-sidebar">
          <ProductListView
            products={products}
            isLoading={isProductsLoading}
            error={productsError}
            selectedProductId={selectedProductId}
            statusFilter={statusFilter}
            canManage={canManage}
            onSelectProduct={handleSelectProduct}
            onFilterChange={(s) => setStatusFilter(s)}
            onOpenCreate={() => setShowCreateProduct(true)}
            onRetry={() => void loadProducts()}
            hasMore={productsNextCursor !== null}
            isLoadingMore={isProductsLoadingMore}
            onLoadMore={() => {
              if (productsNextCursor) void loadProducts(productsNextCursor, true);
            }}
          />
        </aside>

        <section className="catalog-main">
          {isProductDetailLoading ? (
            <div role="status" aria-live="polite" className="catalog-loading">
              Loading product details...
            </div>
          ) : productDetailError && selectedProductId ? (
            <div role="alert" className="error-banner">
              <p>{productDetailError}</p>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => void loadProductDetails(selectedProductId)}
              >
                Retry
              </button>
            </div>
          ) : selectedProduct ? (
            <ProductDetailView
              product={selectedProduct}
              canManage={canManage}
              affiliates={affiliates}
              isAffiliatesLoading={isAffiliatesLoading}
              affiliatesError={affiliatesError}
              factSets={factSets}
              activeRevisionId={activeRevisionId}
              selectedRevisionFacts={selectedRevisionFacts}
              isFactSetsLoading={isFactSetsLoading}
              isFactsLoading={isFactsLoading}
              factSetsError={factSetsError}
              onRefreshProduct={() => loadProductDetails(selectedProduct.id)}
              onUpdateProduct={handleUpdateProduct}
              onArchiveProduct={handleArchiveProduct}
              affiliatesHasMore={affiliatesNextCursor !== null}
              isAffiliatesLoadingMore={isAffiliatesLoadingMore}
              onLoadMoreAffiliates={() => {
                if (affiliatesNextCursor)
                  void loadAffiliates(selectedProduct.id, affiliatesNextCursor, true);
              }}
              onRetryAffiliates={() => void loadAffiliates(selectedProduct.id)}
              onCreateAffiliate={handleCreateAffiliate}
              onUpdateAffiliate={handleUpdateAffiliate}
              onArchiveAffiliate={handleArchiveAffiliate}
              onSelectRevision={(fsId) => {
                setActiveRevisionId(fsId);
                void loadFactSetDetails(selectedProduct.id, fsId);
              }}
              factSetsHasMore={factSetsNextCursor !== null}
              isFactSetsLoadingMore={isFactSetsLoadingMore}
              onLoadMoreFactSets={() => {
                if (factSetsNextCursor)
                  void loadFactSets(
                    selectedProduct.id,
                    selectedProduct.currentFactSetId,
                    factSetsNextCursor,
                    true,
                  );
              }}
              onRetryFactSets={() =>
                void loadFactSets(selectedProduct.id, selectedProduct.currentFactSetId)
              }
              onProposeFactSet={handleProposeFactSet}
              onConfirmFactSet={handleConfirmFactSet}
            />
          ) : (
            <div className="empty-catalog-selection">
              <p>Select a product from the list to view facts and affiliate links.</p>
            </div>
          )}
        </section>
      </div>

      {showCreateProduct && (
        <div className="modal-backdrop">
          <CreateProductDialog
            onSave={handleCreateProductSave}
            onCancel={() => setShowCreateProduct(false)}
          />
        </div>
      )}
    </div>
  );
}
