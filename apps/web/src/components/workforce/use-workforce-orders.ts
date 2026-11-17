'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ContentArtifactSummaryDTO,
  WorkOrderActivityDTO,
  WorkOrderDetailDTO,
  WorkOrderSummaryDTO,
} from '../../types/workforce.js';
import {
  fetchWorkOrderActivitiesApi,
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
  const [activities, setActivities] = useState<readonly WorkOrderActivityDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);

  const pollAbortControllerRef = useRef<AbortController | null>(null);
  const activeOrderIdRef = useRef<string | null>(null);

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
        setActivities([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load work orders');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, productId]);

  const loadOrderDetail = useCallback(
    async (workOrderId: string, isManualRefresh = false) => {
      pollAbortControllerRef.current?.abort();
      const ctrl = new AbortController();
      pollAbortControllerRef.current = ctrl;
      activeOrderIdRef.current = workOrderId;

      if (isManualRefresh) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }
      setPollingError(null);

      try {
        const [detail, arts, acts] = await Promise.all([
          fetchWorkOrderApi(workspaceId, workOrderId, ctrl.signal),
          fetchWorkOrderArtifactsApi(workspaceId, workOrderId, ctrl.signal),
          fetchWorkOrderActivitiesApi(workspaceId, workOrderId, ctrl.signal).catch(() => []),
        ]);

        if (activeOrderIdRef.current !== workOrderId || ctrl.signal.aborted) return;

        setActiveDetail(detail);
        setArtifacts(arts);
        setActivities(acts);
        setIsStale(false);
        setLastUpdatedAt(new Date().toISOString());

        const isRunning =
          detail.workOrder.status === 'in_progress' || detail.workOrder.status === 'pending';

        if (isRunning) {
          setIsRefreshing(true);
          pollWorkOrderUntilTerminal(workspaceId, workOrderId, ctrl.signal, (updated) => {
            if (activeOrderIdRef.current !== workOrderId || ctrl.signal.aborted) return;
            setActiveDetail(updated);
            setLastUpdatedAt(new Date().toISOString());
            void fetchWorkOrderArtifactsApi(workspaceId, workOrderId, ctrl.signal).then(
              (newArts) => {
                if (activeOrderIdRef.current === workOrderId && !ctrl.signal.aborted) {
                  setArtifacts(newArts);
                }
              },
            );
            void fetchWorkOrderActivitiesApi(workspaceId, workOrderId, ctrl.signal)
              .then((newActs) => {
                if (activeOrderIdRef.current === workOrderId && !ctrl.signal.aborted) {
                  setActivities(newActs);
                }
              })
              .catch(() => {});
          })
            .then((terminalDetail) => {
              if (activeOrderIdRef.current === workOrderId && !ctrl.signal.aborted) {
                const terminal =
                  terminalDetail.workOrder.status === 'completed' ||
                  terminalDetail.workOrder.status === 'failed' ||
                  terminalDetail.workOrder.status === 'cancelled';
                if (!terminal) {
                  setIsStale(true);
                }
              }
            })
            .catch((err) => {
              if (activeOrderIdRef.current === workOrderId && !ctrl.signal.aborted) {
                if (!(err instanceof Error && err.name === 'AbortError')) {
                  setPollingError(err instanceof Error ? err.message : 'Polling failed');
                  setIsStale(true);
                }
              }
            })
            .finally(() => {
              if (activeOrderIdRef.current === workOrderId && !ctrl.signal.aborted) {
                setIsRefreshing(false);
              }
            });
        }
      } catch (err) {
        if (activeOrderIdRef.current === workOrderId && !ctrl.signal.aborted) {
          if (!(err instanceof Error && err.name === 'AbortError')) {
            setError(err instanceof Error ? err.message : 'Failed to load order details');
          }
        }
      } finally {
        if (activeOrderIdRef.current === workOrderId && !ctrl.signal.aborted) {
          setLoading(false);
          if (!isManualRefresh) setIsRefreshing(false);
        }
      }
    },
    [workspaceId],
  );

  const refresh = useCallback(() => {
    if (selectedWorkOrderId) {
      void loadOrderDetail(selectedWorkOrderId, true);
    } else {
      void loadWorkOrders();
    }
  }, [selectedWorkOrderId, loadOrderDetail, loadWorkOrders]);

  useEffect(() => {
    void loadWorkOrders();
    return () => {
      pollAbortControllerRef.current?.abort();
      activeOrderIdRef.current = null;
    };
  }, [loadWorkOrders]);

  useEffect(() => {
    if (selectedWorkOrderId) {
      void loadOrderDetail(selectedWorkOrderId);
    }
    return () => {
      pollAbortControllerRef.current?.abort();
    };
  }, [selectedWorkOrderId, loadOrderDetail]);

  return {
    workOrders,
    selectedWorkOrderId,
    setSelectedWorkOrderId,
    activeDetail,
    artifacts,
    activities,
    loading,
    isRefreshing,
    isStale,
    lastUpdatedAt,
    error,
    pollingError,
    setError,
    loadWorkOrders,
    loadOrderDetail,
    refresh,
  };
}
