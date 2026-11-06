import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  AffiliateDestinationDTO,
  FactDTO,
  FactSetDTO,
  ProductDTO,
} from '../src/types/catalog.js';
import { ProductListView } from '../src/components/catalog/product-list-view.js';
import { CreateProductDialog } from '../src/components/catalog/create-product-dialog.js';
import { ProductDetailView } from '../src/components/catalog/product-detail-view.js';
import { FactSetsSection } from '../src/components/catalog/fact-sets-section.js';
import { AffiliateDestinationsSection } from '../src/components/catalog/affiliate-destinations-section.js';
import { CatalogWorkspaceView } from '../src/components/catalog/catalog-workspace-view.js';

describe('Catalog Web Components Rendering', () => {
  const dummyProduct: ProductDTO = {
    id: '0192b012-3456-789a-8bcd-ef0123456701',
    workspaceId: '0192b012-3456-789a-8bcd-ef0123456702',
    name: 'Ergonomic Desk Chair',
    merchantName: 'ChairCo',
    canonicalUrl: 'https://example.com/chair',
    category: 'furniture',
    description: 'High quality chair',
    audienceNotes: 'Office workers',
    allowedClaimsNotes: 'Holds 300 lbs',
    prohibitedClaimsNotes: null,
    status: 'draft',
    currentFactSetId: null,
    createdAt: '2026-11-06T12:00:00Z',
    updatedAt: '2026-11-06T12:00:00Z',
    version: 1,
    duplicateWarning: true,
  };

  const dummyFactSet: FactSetDTO = {
    id: '0192b012-3456-789a-8bcd-ef0123456703',
    workspaceId: '0192b012-3456-789a-8bcd-ef0123456702',
    productId: dummyProduct.id,
    revisionNumber: 1,
    status: 'proposed',
    summary: 'Hardware specs',
    confirmedByUserId: null,
    confirmedAt: null,
    createdByUserId: '0192b012-3456-789a-8bcd-ef0123456704',
    createdAt: '2026-11-06T12:00:00Z',
    updatedAt: '2026-11-06T12:00:00Z',
    version: 1,
  };

  const dummyFacts: readonly FactDTO[] = [
    {
      id: '0192b012-3456-789a-8bcd-ef0123456705',
      workspaceId: dummyProduct.workspaceId,
      productId: dummyProduct.id,
      factSetId: dummyFactSet.id,
      factKey: 'max_weight_lbs',
      valueText: '300',
      sourceType: 'document',
      sourceUrl: null,
      sourceExcerpt: null,
      confidence: 'suggested',
      claimUsage: 'allowed',
      createdAt: '2026-11-06T12:00:00Z',
    },
  ];

  const dummyAffiliate: AffiliateDestinationDTO = {
    id: '0192b012-3456-789a-8bcd-ef0123456706',
    workspaceId: dummyProduct.workspaceId,
    productId: dummyProduct.id,
    label: 'Primary Amazon Storefront',
    url: 'https://amazon.com/dp/123?tag=aff',
    networkName: 'Amazon',
    status: 'active',
    createdAt: '2026-11-06T12:00:00Z',
    updatedAt: '2026-11-06T12:00:00Z',
    version: 1,
  };

  describe('ProductListView', () => {
    it('renders loading state with aria-live polite', () => {
      const html = renderToStaticMarkup(
        <ProductListView
          products={[]}
          isLoading={true}
          error={null}
          selectedProductId={null}
          statusFilter=""
          canManage={true}
          onSelectProduct={() => {}}
          onFilterChange={() => {}}
          onOpenCreate={() => {}}
          onRetry={() => {}}
          hasMore={false}
          isLoadingMore={false}
          onLoadMore={() => {}}
        />,
      );
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
      expect(html).toContain('Loading products...');
    });

    it('renders empty state and create product button for editors', () => {
      const html = renderToStaticMarkup(
        <ProductListView
          products={[]}
          isLoading={false}
          error={null}
          selectedProductId={null}
          statusFilter=""
          canManage={true}
          onSelectProduct={() => {}}
          onFilterChange={() => {}}
          onOpenCreate={() => {}}
          onRetry={() => {}}
          hasMore={false}
          isLoadingMore={false}
          onLoadMore={() => {}}
        />,
      );
      expect(html).toContain('No products in this workspace.');
      expect(html).toContain('Create your first product');
    });

    it('renders product items with duplicate URL warning and status badge', () => {
      const html = renderToStaticMarkup(
        <ProductListView
          products={[dummyProduct]}
          isLoading={false}
          error={null}
          selectedProductId={null}
          statusFilter=""
          canManage={true}
          onSelectProduct={() => {}}
          onFilterChange={() => {}}
          onOpenCreate={() => {}}
          onRetry={() => {}}
          hasMore={true}
          isLoadingMore={false}
          onLoadMore={() => {}}
        />,
      );
      expect(html).toContain('Ergonomic Desk Chair');
      expect(html).toContain('Duplicate URL');
      expect(html).toContain('status-badge status-draft');
      expect(html).toContain('Load more products');
    });

    it('hides create button when canManage is false for viewers', () => {
      const html = renderToStaticMarkup(
        <ProductListView
          products={[]}
          isLoading={false}
          error={null}
          selectedProductId={null}
          statusFilter=""
          canManage={false}
          onSelectProduct={() => {}}
          onFilterChange={() => {}}
          onOpenCreate={() => {}}
          onRetry={() => {}}
          hasMore={false}
          isLoadingMore={false}
          onLoadMore={() => {}}
        />,
      );
      expect(html).not.toContain('+ New Product');
    });
  });

  describe('CreateProductDialog', () => {
    it('renders modal dialog with accessible attributes and input fields', () => {
      const html = renderToStaticMarkup(
        <CreateProductDialog onSave={async () => {}} onCancel={() => {}} />,
      );
      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-labelledby="create-product-title"');
      expect(html).toContain('Product Name');
      expect(html).toContain('Canonical Product URL');
    });
  });

  describe('ProductDetailView', () => {
    it('renders product details and actions for managers', () => {
      const html = renderToStaticMarkup(
        <ProductDetailView
          product={dummyProduct}
          canManage={true}
          affiliates={[dummyAffiliate]}
          isAffiliatesLoading={false}
          affiliatesError={null}
          factSets={[dummyFactSet]}
          activeRevisionId={dummyFactSet.id}
          selectedRevisionFacts={dummyFacts}
          isFactSetsLoading={false}
          isFactsLoading={false}
          factSetsError={null}
          onRefreshProduct={async () => {}}
          onUpdateProduct={async () => {}}
          onArchiveProduct={async () => {}}
          onRetryAffiliates={() => {}}
          onCreateAffiliate={async () => {}}
          onUpdateAffiliate={async () => {}}
          onArchiveAffiliate={async () => {}}
          onSelectRevision={() => {}}
          onRetryFactSets={() => {}}
          onProposeFactSet={async () => {}}
          onConfirmFactSet={async () => {}}
          affiliatesHasMore={false}
          isAffiliatesLoadingMore={false}
          onLoadMoreAffiliates={() => {}}
          factSetsHasMore={false}
          isFactSetsLoadingMore={false}
          onLoadMoreFactSets={() => {}}
        />,
      );
      expect(html).toContain('Ergonomic Desk Chair');
      expect(html).toContain('Edit Details');
      expect(html).toContain('Archive');
    });

    it('hides edit and archive buttons for viewers (canManage=false)', () => {
      const html = renderToStaticMarkup(
        <ProductDetailView
          product={dummyProduct}
          canManage={false}
          affiliates={[dummyAffiliate]}
          isAffiliatesLoading={false}
          affiliatesError={null}
          factSets={[dummyFactSet]}
          activeRevisionId={dummyFactSet.id}
          selectedRevisionFacts={dummyFacts}
          isFactSetsLoading={false}
          isFactsLoading={false}
          factSetsError={null}
          onRefreshProduct={async () => {}}
          onUpdateProduct={async () => {}}
          onArchiveProduct={async () => {}}
          onRetryAffiliates={() => {}}
          onCreateAffiliate={async () => {}}
          onUpdateAffiliate={async () => {}}
          onArchiveAffiliate={async () => {}}
          onSelectRevision={() => {}}
          onRetryFactSets={() => {}}
          onProposeFactSet={async () => {}}
          onConfirmFactSet={async () => {}}
          affiliatesHasMore={false}
          isAffiliatesLoadingMore={false}
          onLoadMoreAffiliates={() => {}}
          factSetsHasMore={false}
          isFactSetsLoadingMore={false}
          onLoadMoreFactSets={() => {}}
        />,
      );
      expect(html).not.toContain('Edit Details');
      expect(html).not.toContain('Archive');
    });
  });

  describe('FactSetsSection', () => {
    it('renders revisions list, facts table, and grounding notice', () => {
      const html = renderToStaticMarkup(
        <FactSetsSection
          factSets={[dummyFactSet]}
          activeRevisionId={dummyFactSet.id}
          currentConfirmedFactSetId={null}
          selectedRevisionFacts={dummyFacts}
          isLoading={false}
          isFactsLoading={false}
          error={null}
          canManage={true}
          onSelectRevision={() => {}}
          onRetry={() => {}}
          onPropose={async () => {}}
          onConfirm={async () => {}}
          hasMore={true}
          isLoadingMore={false}
          onLoadMore={() => {}}
        />,
      );
      expect(html).toContain('Grounding Rule:');
      expect(html).toContain('Suggested or uncertain facts are never implied to be verified.');
      expect(html).toContain('max_weight_lbs');
      expect(html).toContain('300');
      expect(html).toContain('Confirm Revision');
      expect(html).toContain('Load more revisions');
    });

    it('renders confirmed fact set as immutable badge and hides confirm action', () => {
      const confirmedFactSet = {
        ...dummyFactSet,
        status: 'confirmed' as const,
        confirmedAt: '2026-11-06T13:00:00Z',
      };
      const html = renderToStaticMarkup(
        <FactSetsSection
          factSets={[confirmedFactSet]}
          activeRevisionId={confirmedFactSet.id}
          currentConfirmedFactSetId={confirmedFactSet.id}
          selectedRevisionFacts={dummyFacts}
          isLoading={false}
          isFactsLoading={false}
          error={null}
          canManage={true}
          onSelectRevision={() => {}}
          onRetry={() => {}}
          onPropose={async () => {}}
          onConfirm={async () => {}}
          hasMore={false}
          isLoadingMore={false}
          onLoadMore={() => {}}
        />,
      );
      expect(html).toContain('Revision #1 (confirmed)');
      expect(html).not.toContain('Confirm Revision');
    });
  });

  describe('AffiliateDestinationsSection', () => {
    it('renders destinations list and hides actions for viewer', () => {
      const html = renderToStaticMarkup(
        <AffiliateDestinationsSection
          affiliates={[dummyAffiliate]}
          isLoading={false}
          error={null}
          canManage={false}
          onRetry={() => {}}
          onCreate={async () => {}}
          onUpdate={async () => {}}
          onArchive={async () => {}}
          hasMore={true}
          isLoadingMore={false}
          onLoadMore={() => {}}
        />,
      );
      expect(html).toContain('Primary Amazon Storefront');
      expect(html).not.toContain('+ Add Destination');
      expect(html).not.toContain('Edit');
      expect(html).not.toContain('Archive');
      expect(html).toContain('Load more destinations');
    });
  });

  describe('CatalogWorkspaceView', () => {
    it('renders viewer banner when user is in viewer role', () => {
      const html = renderToStaticMarkup(
        <CatalogWorkspaceView workspaceId={dummyProduct.workspaceId} userRole="viewer" />,
      );
      expect(html).toContain(
        'Viewing as <strong>Viewer</strong>. Catalog modifications are disabled.',
      );
    });
  });
});
