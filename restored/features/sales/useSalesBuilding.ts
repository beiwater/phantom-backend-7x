/**
 * Custom Hook for Sales Building Logic
 * Reconstructed from building container & sales components
 */

import { useState, useEffect, useCallback } from 'react';
import { salesApi } from '../../api/sales-api.ts';
import { SALES_BUILDING_KINDS } from '../../shared/game-constants.ts';
import type { SalesBuildingState, SalesBuildingCategory } from './types.ts';
import type { PlayerBuilding } from '../../shared/types.ts';

export function useSalesBuilding(building: PlayerBuilding) {
  const buildingKind = building.kind;
  let category: SalesBuildingCategory = 'generic_retail';

  if (buildingKind === SALES_BUILDING_KINDS.SALES_OFFICE) {
    category = 'sales_office';
  } else if (buildingKind === SALES_BUILDING_KINDS.RESTAURANT) {
    category = 'restaurant';
  }

  const [state, setState] = useState<SalesBuildingState>({
    building,
    buildingKind,
    category,
    loading: true,
    error: null,
    retailQueue: [],
    salesOrders: [],
    isSearchingCustomer: false,
    restaurantProperties: null,
    restaurantRuns: []
  });

  const loadData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      if (category === 'generic_retail') {
        const queue = await salesApi.fetchQueue(building.id);
        setState(prev => ({ ...prev, retailQueue: queue, loading: false }));
      } else if (category === 'sales_office') {
        const orders = await salesApi.fetchSalesOrders(building.id);
        setState(prev => ({ ...prev, salesOrders: orders, loading: false }));
      } else if (category === 'restaurant') {
        const [props, runs] = await Promise.all([
          salesApi.fetchRestaurantProperties(building.id),
          salesApi.fetchRestaurantRuns(building.id)
        ]);
        setState(prev => ({
          ...prev,
          restaurantProperties: props,
          restaurantRuns: runs,
          loading: false
        }));
      }
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: 'Failed to load building data'
      }));
    }
  }, [building.id, category]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Actions for Generic Retail
  const startRetailTask = async (resourceId: number, amount: number, price: number) => {
    const updated = await salesApi.startRetailTask(building.id, { resourceId, amount, price });
    setState(prev => ({ ...prev, retailQueue: updated }));
  };

  const cancelRetailTask = async (taskId: number) => {
    await salesApi.cancelRetailTask(building.id, taskId);
    setState(prev => ({
      ...prev,
      retailQueue: prev.retailQueue.filter(t => t.id !== taskId)
    }));
  };

  // Actions for Sales Office
  const findCustomer = async () => {
    setState(prev => ({ ...prev, isSearchingCustomer: true }));
    try {
      const order = await salesApi.findCustomer(building.id);
      setState(prev => ({
        ...prev,
        salesOrders: [...prev.salesOrders, order],
        isSearchingCustomer: false
      }));
    } finally {
      setState(prev => ({ ...prev, isSearchingCustomer: false }));
    }
  };

  const deliverSalesOrder = async (orderId: number, lowestQualityFirst = true) => {
    const res = await salesApi.deliverSalesOrder(building.id, orderId, { lowestQualityFirst });
    setState(prev => ({
      ...prev,
      salesOrders: prev.salesOrders.filter(o => o.id !== orderId)
    }));
    return res;
  };

  const rejectSalesOrder = async (orderId: number) => {
    await salesApi.rejectSalesOrder(building.id, orderId);
    setState(prev => ({
      ...prev,
      salesOrders: prev.salesOrders.filter(o => o.id !== orderId)
    }));
  };

  return {
    state,
    reload: loadData,
    retail: {
      startRetailTask,
      cancelRetailTask
    },
    salesOffice: {
      findCustomer,
      deliverSalesOrder,
      rejectSalesOrder
    }
  };
}
