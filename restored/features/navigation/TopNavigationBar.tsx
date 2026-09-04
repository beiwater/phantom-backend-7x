/**
 * Top Navigation Bar Component
 */

import React from 'react';

export type NavigationTab =
  | 'landscape'
  | 'warehouse'
  | 'market'
  | 'encyclopedia'
  | 'newspaper'
  | 'chat'
  | 'messages'
  | 'finances'
  | 'events'
  | 'profile'
  | 'preferences';

export interface TopNavigationBarProps {
  companyName: string;
  level: number;
  money: number;
  simboosts: number;
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  onOpenAssistant: () => void;
}

export const TopNavigationBar: React.FC<TopNavigationBarProps> = ({
  companyName,
  level,
  money,
  simboosts,
  activeTab,
  onSelectTab,
  onOpenAssistant
}) => {
  const navItems: Array<{ tab: NavigationTab; label: string }> = [
    { tab: 'landscape', label: 'Map' },
    { tab: 'warehouse', label: 'Warehouse' },
    { tab: 'market', label: 'Exchange' },
    { tab: 'encyclopedia', label: 'Encyclopedia' },
    { tab: 'newspaper', label: 'Newspaper' },
    { tab: 'chat', label: 'Chat' },
    { tab: 'messages', label: 'Messages' },
    { tab: 'finances', label: 'Finances' },
    { tab: 'events', label: 'Events' }
  ];

  return (
    <header className="sticky top-0 z-40 bg-white dark:bg-gray-800 border-b dark:border-gray-700 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        {/* Company Identity */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onSelectTab('profile')}
            className="flex items-center gap-2 hover:opacity-80 transition text-left"
          >
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-xs">
              {companyName.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="text-xs font-bold text-gray-900 dark:text-white truncate max-w-[120px]">
                {companyName}
              </div>
              <span className="text-[10px] text-blue-600 font-semibold">Level {level}</span>
            </div>
          </button>
        </div>

        {/* Global Navigation Tabs */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map(item => (
            <button
              key={item.tab}
              type="button"
              onClick={() => onSelectTab(item.tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === item.tab
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Corporate Metrics (Cash & SimBoosts) & PA Trigger */}
        <div className="flex items-center gap-3 text-xs font-bold">
          <div className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-lg">
            ${money.toLocaleString()}
          </div>
          <div className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-lg flex items-center gap-1">
            <span>⚡</span>
            <span>{simboosts}</span>
          </div>

          <button
            type="button"
            onClick={onOpenAssistant}
            className="p-1.5 bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full transition text-sm"
            title="Personal Assistant"
          >
            👩‍💼
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('preferences')}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-500"
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </div>
    </header>
  );
};
