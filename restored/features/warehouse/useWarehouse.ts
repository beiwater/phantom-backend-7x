/**
 * Custom Hook for Warehouse & B2B Contracts
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { warehouseApi } from '../../api/warehouse-api.ts';
import type { WarehouseState } from './types.ts';

export function useWarehouse(companyId: number) {
  const [state, setState] = useState<WarehouseState>({
    items: [],
    incomingContracts: [],
    outgoingContracts: [],
    searchQuery: '',
    loading: true,
    error: null
  });

  const loadWarehouseData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const [inv, incoming, outgoing] = await Promise.all([
        warehouseApi.fetchInventory(companyId),
        warehouseApi.fetchIncomingContracts(companyId).catch(() => []),
        warehouseApi.fetchOutgoingContracts(companyId).catch(() => [])
      ]);
      setState(prev => ({
        ...prev,
        items: inv,
        incomingContracts: incoming,
        outgoingContracts: outgoing,
        loading: false
      }));
    } catch {
      setState(prev => ({ ...prev, loading: false, error: 'Failed to load warehouse data' }));
    }
  }, [companyId]);

  useEffect(() => {
    loadWarehouseData();
  }, [loadWarehouseData]);

  const filteredItems = useMemo(() => {
    if (!state.searchQuery) return state.items;
    const q = state.searchQuery.toLowerCase();
    return state.items.filter(item =>
      String(item.resourceId).includes(q) || (item.name && item.name.toLowerCase().includes(q))
    );
  }, [state.items, state.searchQuery]);

  const acceptContract = async (contractId: number) => {
    await warehouseApi.acceptContract(contractId);
    setState(prev => ({
      ...prev,
      incomingContracts: prev.incomingContracts.filter(c => c.id !== contractId)
    }));
    loadWarehouseData();
  };

  const rejectContract = async (contractId: number) => {
    await warehouseApi.rejectContract(contractId);
    setState(prev => ({
      ...prev,
      incomingContracts: prev.incomingContracts.filter(c => c.id !== contractId)
    }));
  };

  return {
    state,
    filteredItems,
    setSearchQuery: (q: string) => setState(prev => ({ ...prev, searchQuery: q })),
    acceptContract,
    rejectContract,
    reload: loadWarehouseData
  };
}
