/**
 * Custom Hook for Seasonal Events
 */

import { useState } from 'react';
import { eventsApi } from '../../api/events-api.ts';
import type { SeasonalEventsState } from './types.ts';

export function useSeasonalEvents() {
  const [state, setState] = useState<SeasonalEventsState>({
    events: [
      {
        id: 'easter',
        name: 'Spring Easter Egg Hunt',
        isActive: true,
        startDate: '03-20',
        endDate: '04-30',
        description: 'Collect decorative Easter Eggs across market contracts and unlock exclusive event certificates.',
        featuredCommodities: [151, 155]
      },
      {
        id: 'summer',
        name: 'Summer Beach Festival',
        isActive: false,
        startDate: '07-14',
        endDate: '09-14',
        description: 'Retail demands for chocolate and apple ice cream peak during summer temperatures.',
        featuredCommodities: [153, 154]
      },
      {
        id: 'halloween',
        name: 'Halloween Spooktacular',
        isActive: false,
        startDate: '10-15',
        endDate: '11-15',
        description: 'Produce and retail pumpkin soup, candies, and spooky masks.',
        featuredCommodities: [146, 147, 148]
      },
      {
        id: 'xmas',
        name: 'Winter Christmas Holiday',
        isActive: false,
        startDate: '11-25',
        endDate: '12-31',
        description: 'Christmas crackers, holiday sweaters, and festive tree accumulators are in high demand.',
        featuredCommodities: [67, 144, 150]
      }
    ],
    eggHuntResult: null,
    collectingEgg: false,
    error: null
  });

  const collectEgg = async () => {
    setState(prev => ({ ...prev, collectingEgg: true }));
    try {
      const res = await eventsApi.collectEasterEgg();
      setState(prev => ({ ...prev, eggHuntResult: res, collectingEgg: false }));
    } catch {
      setState(prev => ({ ...prev, collectingEgg: false, error: 'Failed to claim easter egg' }));
    }
  };

  return {
    state,
    collectEgg,
    dismissResult: () => setState(prev => ({ ...prev, eggHuntResult: null }))
  };
}
