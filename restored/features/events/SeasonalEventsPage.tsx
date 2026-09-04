/**
 * Root Seasonal & Holiday Events Page
 */

import React from 'react';
import { useSeasonalEvents } from './useSeasonalEvents.ts';
import { EggHuntModal } from './EggHuntModal.tsx';

export const SeasonalEventsPage: React.FC = () => {
  const { state, collectEgg, dismissResult } = useSeasonalEvents();

  return (
    <div className="seasonal-events-page max-w-4xl mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Seasonal & Holiday Events</h1>
        <p className="text-sm text-gray-500">
          Participate in live holiday campaigns, event commodity trading, and special collector mini-games.
        </p>
      </div>

      <div className="space-y-4">
        {state.events.map(ev => (
          <div
            key={ev.id}
            className={`p-6 rounded-lg border shadow-sm ${
              ev.isActive
                ? 'bg-white dark:bg-gray-800 border-blue-500 dark:border-blue-400'
                : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 opacity-75'
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{ev.name}</h3>
                <span className="text-xs text-gray-400">Annual Duration: {ev.startDate} ~ {ev.endDate}</span>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  ev.isActive
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                }`}
              >
                {ev.isActive ? '● Live Active' : 'Off-Season'}
              </span>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{ev.description}</p>

            {ev.isActive && ev.id === 'easter' && (
              <div className="pt-3 border-t dark:border-gray-700 flex justify-end">
                <button
                  type="button"
                  onClick={collectEgg}
                  disabled={state.collectingEgg}
                  className="px-4 py-2 bg-gradient-to-r from-amber-500 to-pink-500 hover:opacity-90 text-white text-sm font-semibold rounded-lg shadow disabled:opacity-50"
                >
                  {state.collectingEgg ? 'Searching...' : 'Search for Hidden Easter Egg'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {state.eggHuntResult && (
        <EggHuntModal result={state.eggHuntResult} onClose={dismissResult} />
      )}
    </div>
  );
};
