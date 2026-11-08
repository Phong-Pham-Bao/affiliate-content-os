'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ContentArtifactSummaryDTO,
  WorkOrderDetailDTO,
  WorkOrderSummaryDTO,
} from '../../types/workforce.js';
import {
  fetchWorkOrderApi,
  fetchWorkOrderArtifactsApi,
  fetchWorkOrdersApi,
} from '../../lib/workforce-api-client.js';
import { pollWorkOrderUntilTerminal } from '../../lib/workforce-operation-polling.js';

export function useWorkforceOrders(workspaceId: string, productId: string) {
  const [workOrders, setWorkOrders] = useState<readonly WorkOrderSummaryDTO[]>([]);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<WorkOrderDetailDTO | null>(null);
  const [artifacts, setArtifacts] = useState<readonly ContentArtifactSummaryDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollAbortControllerRef = useRef<AbortController | null>(null);

  const loadWorkOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWorkOrdersApi(workspaceId, { productId });
      const productOrders = res.items.filter((item) => item.productId === productId);
      setWorkOrders(productOrders);
      if (productOrders.length > 0) {
        setSelectedWorkOrderId((prev) =>
          prev && productOrders.some((p) => p.id === prev) ? prev : productOrders[0]!.id,
        );
      } else {
        setSelectedWorkOrderId(null);
        setActiveDetail(null);
        setArtifacts([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load work orders');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, productId]);

  const loadOrderDetail = useCallback(
    async (workOrderId: string, signal?: AbortSignal) => {
      try {
        const detail = await fetchWorkOrderApi(workspaceId, workOrderId, signal);
        setActiveDetail(detail);
        const arts = await fetchWorkOrderArtifactsApi(workspaceId, workOrderId, signal);
        setArtifacts(arts);

        if (detail.workOrder.status === 'in_progress' || detail.workOrder.status === 'pending') {
          pollAbortControllerRef.current?.abort();
          const ctrl = new AbortController();
          pollAbortControllerRef.current = ctrl;
          pollWorkOrderUntilTerminal(workspaceId, workOrderId, ctrl.signal, (updated) => {
            setActiveDetail(updated);
            void fetchWorkOrderArtifactsApi(workspaceId, workOrderId, ctrl.signal).then(
              setArtifacts,
            );
          }).catch((err) => {
            if (!(err instanceof Error && err.name === 'AbortError')) {
              setError(err instanceof Error ? err.message : 'Polling failed');
            }
          });
        }
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) {
          setError(err instanceof Error ? err.message : 'Failed to load order details');
        }
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    void loadWorkOrders();
    return () => {
      pollAbortControllerRef.current?.abort();
    };
  }, [loadWorkOrders]);

  useEffect(() => {
    if (selectedWorkOrderId) void loadOrderDetail(selectedWorkOrderId);
  }, [selectedWorkOrderId, loadOrderDetail]);

  return {
    workOrders,
    selectedWorkOrderId,
    setSelectedWorkOrderId,
    activeDetail,
    artifacts,
    loading,
    error,
    setError,
    loadWorkOrders,
    loadOrderDetail,
  };
}
