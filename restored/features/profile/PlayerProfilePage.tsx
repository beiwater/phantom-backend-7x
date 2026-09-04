/**
 * Player / Company Profile View Page
 */

import React from 'react';
import { useProfile } from './useProfile.ts';

export interface PlayerProfilePageProps {
  companyId?: number;
}

export const PlayerProfilePage: React.FC<PlayerProfilePageProps> = ({ companyId }) => {
  const { state } = useProfile(companyId);

  if (state.loading) {
    return <div className="p-8 text-center text-gray-500">Loading company profile...</div>;
  }

  if (state.error || !state.profile) {
    return <div className="p-8 text-center text-red-500">{state.error || 'Profile not found'}</div>;
  }

  const p = state.profile;

  return (
    <div className="profile-page max-w-4xl mx-auto py-6 px-4">
      {/* Profile Header */}
      <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow mb-6 flex flex-col sm:flex-row items-center gap-6">
        <div className="w-24 h-24 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center font-bold text-3xl text-blue-600">
          {p.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 text-center sm:text-left">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{p.name}</h1>
            <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded self-center sm:self-auto">
              Level {p.level}
            </span>
          </div>
          <div className="text-sm text-gray-500">
            Rating: <span className="font-semibold text-emerald-600">{p.rating}</span> • Realm #{p.realmId}
          </div>
          {p.note && <p className="mt-3 text-sm text-gray-600 dark:text-gray-300 italic">&ldquo;{p.note}&rdquo;</p>}
        </div>
      </div>

      {/* Company Assets Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border dark:border-gray-700 text-center">
          <span className="text-xs text-gray-400 uppercase font-bold">Liquid Funds</span>
          <div className="text-2xl font-extrabold text-emerald-600 mt-1">${p.money.toLocaleString()}</div>
        </div>
        <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border dark:border-gray-700 text-center">
          <span className="text-xs text-gray-400 uppercase font-bold">SimBoosts</span>
          <div className="text-2xl font-extrabold text-amber-500 mt-1">{p.simboosts}</div>
        </div>
        <div className="p-4 bg-white dark:bg-gray-800 rounded-lg shadow border dark:border-gray-700 text-center">
          <span className="text-xs text-gray-400 uppercase font-bold">Experience XP</span>
          <div className="text-2xl font-extrabold text-indigo-600 mt-1">{p.experience.toLocaleString()}</div>
        </div>
      </div>

      {/* Facilities & Unlocks */}
      <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border dark:border-gray-700">
        <h3 className="font-bold text-base mb-4 text-gray-900 dark:text-white">Facility Capacity & Unlocks</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
            <span className="text-gray-500">Bonus Building Slots:</span>
            <span className="float-right font-semibold">+{p.extraBuildingSlots}</span>
          </div>
          <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
            <span className="text-gray-500">Executive Board Slots:</span>
            <span className="float-right font-semibold">+{p.extraExecutiveSlots}</span>
          </div>
          <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded">
            <span className="text-gray-500">Display Case Slots:</span>
            <span className="float-right font-semibold">{p.displayCaseSlots}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
