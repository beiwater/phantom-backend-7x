/**
 * Encyclopedia Category Grid Component
 */

import React from 'react';
import { RESOURCE_CATEGORIES } from '../../shared/game-constants.ts';

export interface EncyclopediaCategoryListProps {
  activeCategory: string | null;
  onSelectCategory: (categoryId: string | null) => void;
}

export const EncyclopediaCategoryList: React.FC<EncyclopediaCategoryListProps> = ({
  activeCategory,
  onSelectCategory
}) => {
  return (
    <div className="encyclopedia-categories mb-6">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSelectCategory(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
            activeCategory === null
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200'
          }`}
        >
          All Sectors
        </button>
        {RESOURCE_CATEGORIES.map(cat => (
          <button
            key={cat.id}
            type="button"
            onClick={() => onSelectCategory(cat.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
              activeCategory === cat.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>
    </div>
  );
};
