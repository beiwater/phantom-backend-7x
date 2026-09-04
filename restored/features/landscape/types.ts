/**
 * Landscape Map Feature Types
 */

import type { PlayerBuilding } from '../../shared/types.ts';

export interface MapSlot {
  position: string;
  building: PlayerBuilding | null;
  isUnlocked: boolean;
}

export interface LandscapeState {
  buildings: PlayerBuilding[];
  slots: MapSlot[];
  selectedBuilding: PlayerBuilding | null;
  isConstructing: boolean;
  targetSlotPosition: string | null;
  loading: boolean;
  error: string | null;
}
