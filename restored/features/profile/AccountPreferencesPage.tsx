/**
 * Account Preferences & Settings Page
 */

import React, { useState } from 'react';
import { useProfile } from './useProfile.ts';
import type { PlayerPreferences } from '../../api/profile-api.ts';

export const AccountPreferencesPage: React.FC = () => {
  const { state, updatePreferences } = useProfile();
  const [formData, setFormData] = useState<PlayerPreferences>(state.preferences);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await updatePreferences(formData);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  return (
    <div className="preferences-page max-w-2xl mx-auto py-6 px-4">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow border dark:border-gray-700">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Account Preferences</h2>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Theme Selector */}
          <div>
            <label className="block text-sm font-semibold mb-2">Display Theme</label>
            <div className="flex gap-4">
              {(['light', 'dark', 'system'] as const).map(t => (
                <label key={t} className="flex items-center gap-2 cursor-pointer capitalize text-sm">
                  <input
                    type="radio"
                    name="theme"
                    checked={formData.theme === t}
                    onChange={() => setFormData(prev => ({ ...prev, theme: t }))}
                  />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Interface Toggles */}
          <div className="space-y-3 border-t pt-4 dark:border-gray-700">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="text-sm font-semibold">Simplify UI</div>
                <div className="text-xs text-gray-500">Hide animations and reduce visual decorations for speed</div>
              </div>
              <input
                type="checkbox"
                checked={formData.simplifyUI}
                onChange={e => setFormData(prev => ({ ...prev, simplifyUI: e.target.checked }))}
                className="w-4 h-4 rounded text-blue-600"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer border-t pt-3 dark:border-gray-700">
              <div>
                <div className="text-sm font-semibold">Show Online Status</div>
                <div className="text-xs text-gray-500">Display green active status badge in chat and profiles</div>
              </div>
              <input
                type="checkbox"
                checked={formData.showOnlineIndicator}
                onChange={e => setFormData(prev => ({ ...prev, showOnlineIndicator: e.target.checked }))}
                className="w-4 h-4 rounded text-blue-600"
              />
            </label>
          </div>

          <div className="border-t pt-4 dark:border-gray-700 flex items-center justify-between">
            <button
              type="submit"
              disabled={state.saving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
            >
              {state.saving ? 'Saving...' : 'Save Preferences'}
            </button>
            {savedSuccess && <span className="text-sm text-green-600 font-medium">Saved successfully!</span>}
          </div>
        </form>
      </div>
    </div>
  );
};
