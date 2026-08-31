export interface SeasonalEvent {
  id: string;
  name: string;
  active: boolean;
  resourceKinds: number[];
  buildingKinds: string[];
}

export const SEASONAL_EVENTS: Record<string, SeasonalEvent> = {
  summer: {
    id: 'summer',
    name: 'Summer Festival',
    active: false,
    resourceKinds: [120, 121], // Seasonal event resources
    buildingKinds: ['z']       // Beach market
  }
};

export function getActiveSeasonalEvents(): SeasonalEvent[] {
  return Object.values(SEASONAL_EVENTS).filter(event => event.active);
}
