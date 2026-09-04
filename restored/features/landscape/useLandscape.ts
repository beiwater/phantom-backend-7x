/**
 * Custom Hook for Landscape Map Slots and Construction
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { landscapeApi } from '../../api/landscape-api.ts';
import type { LandscapeState, MapSlot } from './types.ts';
import type { PlayerBuilding } from '../../shared/types.ts';

export function useLandscape(companyId: number) {
  const [state, setState] = useState<LandscapeState>({
    buildings: [],
    slots: [],
    selectedBuilding: null,
    isConstructing: false,
    targetSlotPosition: null,
    loading: true,
    error: null
  });

  const loadBuildings = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const list = await landscapeApi.fetchBuildings(companyId);
      setState(prev => ({ ...prev, buildings: list, loading: false }));
    } catch {
      setState(prev => ({ ...prev, loading: false, error: 'Failed to load landscape buildings' }));
    }
  }, [companyId]);

  useEffect(() => {
    loadBuildings();
  }, [loadBuildings]);

  // Generate 20 grid slots
  const gridSlots = useMemo<MapSlot[]>(() => {
    const slots: MapSlot[] = [];
    for (let i = 0; i < 20; i++) {
      const pos = `slot-${i}`;
      const building = state.buildings.find(b => b.position === pos) || null;
      slots.push({
        position: pos,
        building,
        isUnlocked: i < 12 // first 12 slots base unlocked
      });
    }
    return slots;
  }, [state.buildings]);

  const openConstruction = (position: string) => {
    setState(prev => ({ ...prev, isConstructing: true, targetSlotPosition: position }));
  };

  const closeConstruction = () => {
    setState(prev => ({ ...prev, isConstructing: false, targetSlotPosition: null }));
  };

  const constructBuilding = async (kind: string) => {
    if (!state.targetSlotPosition) return;
    try {
      const newB = await landscapeApi.constructBuilding(companyId, {
        kind,
        position: state.targetSlotPosition
      });
      setState(prev => ({
        ...prev,
        buildings: [...prev.buildings, newB],
        isConstructing: false,
        targetSlotPosition: null
      }));
    } catch {
      setState(prev => ({ ...prev, error: 'Construction failed' }));
    }
  };

  const upgradeBuilding = async (buildingId: number) => {
    try {
      const updated = await landscapeApi.upgradeBuilding(companyId, buildingId);
      setState(prev => ({
        ...prev,
        buildings: prev.buildings.map(b => (b.id === buildingId ? updated : b))
      }));
    } catch {
      setState(prev => ({ ...prev, error: 'Upgrade failed' }));
    }
  };

  return {
    state,
    gridSlots,
    openConstruction,
    closeConstruction,
    constructBuilding,
    upgradeBuilding,
    reload: loadBuildings
  };
}
