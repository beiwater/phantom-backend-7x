/**
 * Easter Egg Hunt Reward Modal
 */

import React from 'react';
import type { EggCollectResult } from '../../api/events-api.ts';

export interface EggHuntModalProps {
  result: EggCollectResult;
  onClose: () => void;
}

export const EggHuntModal: React.FC<EggHuntModalProps> = ({ result, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-xl max-w-sm w-full text-center border dark:border-gray-700">
        <div className="w-20 h-20 mx-auto mb-4 bg-amber-100 rounded-full flex items-center justify-center text-4xl">
          🥚
        </div>
        <h3 className="text-xl font-bold mb-2 text-gray-900 dark:text-white">Easter Egg Found!</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          You discovered a decorative <span className="font-semibold">{result.eggType}</span>!
        </p>
        <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-6 text-sm">
          Total Eggs in Basket: <span className="font-bold text-indigo-600">{result.totalCollected}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm"
        >
          Collect & Continue
        </button>
      </div>
    </div>
  );
};
