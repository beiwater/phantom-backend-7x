/**
 * Custom Hook for Encyclopedia Data and Calculations
 * Reconstructed from index-cgzgptQ8.js offsets 4068000-4085000
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { encyclopediaApi } from '../../api/encyclopedia-api.ts';
import { AVERAGE_SALARY } from '../../shared/game-constants.ts';
import type { EncyclopediaState, ResourceCostBreakdown } from './types.ts';
import type { ResourceDefinition, BuildingDefinition } from '../../shared/types.ts';

export function useEncyclopedia(
  realmId = 0,
  initialResources: ResourceDefinition[] = [],
  initialBuildings: BuildingDefinition[] = []
) {
  const [state, setState] = useState<EncyclopediaState>({
    realmId,
    activeCategory: null,
    searchQuery: '',
    selectedResourceId: null,
    selectedBuildingKind: null,
    selectedQuality: 0,
    loading: true,
    error: null,
    resources: initialResources,
    buildings: initialBuildings,
    retailInfo: {},
    tickerPrices: {},
    adminOverhead: 0
  });

  const loadDynamicData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true }));
    try {
      const [retail, ticker, overhead] = await Promise.all([
        encyclopediaApi.fetchResourceRetailInfo(realmId).catch(() => ({})),
        encyclopediaApi.fetchMarketTicker(realmId).catch(() => ({})),
        encyclopediaApi.fetchAdminOverhead().catch(() => ({ administrationOverhead: 0 }))
      ]);

      const prices: Record<number, number> = {};
      for (const [k, v] of Object.entries(ticker)) {
        prices[Number(k)] = v.price;
      }

      setState(prev => ({
        ...prev,
        retailInfo: retail,
        tickerPrices: prices,
        adminOverhead: overhead.administrationOverhead,
        loading: false
      }));
    } catch {
      setState(prev => ({ ...prev, loading: false, error: 'Failed to load encyclopedia data' }));
    }
  }, [realmId]);

  useEffect(() => {
    loadDynamicData();
  }, [loadDynamicData]);

  // Filtered resources by search and category
  const filteredResources = useMemo(() => {
    return state.resources.filter(res => {
      const matchesSearch =
        state.searchQuery === '' ||
        res.name.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
        String(res.dbLetter) === state.searchQuery;

      return matchesSearch;
    });
  }, [state.resources, state.searchQuery]);

  // Cost calculation for a resource
  const calculateCostBreakdown = useCallback(
    (resource: ResourceDefinition, building?: BuildingDefinition): ResourceCostBreakdown => {
      let rawMaterialCost = 0;
      for (const [inputResId, qty] of Object.entries(resource.producedFrom)) {
        const inputPrice = state.tickerPrices[Number(inputResId)] || 1;
        rawMaterialCost += inputPrice * qty;
      }

      const salaryMod = building?.salaryModifier ?? 1.0;
      const hourlyWage = AVERAGE_SALARY * salaryMod;
      const laborCost = resource.producedPerHourRaw > 0 ? hourlyWage / resource.producedPerHourRaw : 0;
      const administrationCost = laborCost * (state.adminOverhead / 100);
      const totalProductionCost = rawMaterialCost + laborCost + administrationCost;
      const marketPrice = state.tickerPrices[resource.dbLetter] || totalProductionCost * 1.1;
      const estimatedProfit = marketPrice - totalProductionCost;

      return {
        rawMaterialCost,
        laborCost,
        administrationCost,
        totalProductionCost,
        marketPrice,
        estimatedProfit
      };
    },
    [state.tickerPrices, state.adminOverhead]
  );

  return {
    state,
    filteredResources,
    setSearchQuery: (query: string) => setState(prev => ({ ...prev, searchQuery: query })),
    setActiveCategory: (cat: string | null) => setState(prev => ({ ...prev, activeCategory: cat })),
    setSelectedResource: (id: number | null) => setState(prev => ({ ...prev, selectedResourceId: id })),
    setSelectedBuilding: (kind: string | null) => setState(prev => ({ ...prev, selectedBuildingKind: kind })),
    calculateCostBreakdown
  };
}
