/**
 * Custom Hook for Player Profile and Preferences
 */

import { useState, useEffect, useCallback } from 'react';
import { profileApi, type PlayerPreferences } from '../../api/profile-api.ts';
import type { ProfileState } from './types.ts';

export function useProfile(companyId?: number) {
  const [state, setState] = useState<ProfileState>({
    profile: null,
    preferences: {
      theme: 'system',
      simplifyUI: false,
      language: 'en',
      showOnlineIndicator: true
    },
    loading: true,
    saving: false,
    error: null
  });

  const loadData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const profile = companyId
        ? await profileApi.fetchCompanyProfile(companyId)
        : await profileApi.fetchCurrentCompany();
      setState(prev => ({ ...prev, profile, loading: false }));
    } catch {
      setState(prev => ({ ...prev, loading: false, error: 'Failed to load company profile' }));
    }
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updatePreferences = async (newPrefs: Partial<PlayerPreferences>) => {
    setState(prev => ({ ...prev, saving: true }));
    try {
      const updated = await profileApi.updatePreferences(newPrefs);
      setState(prev => ({ ...prev, preferences: updated, saving: false }));
    } catch {
      setState(prev => ({ ...prev, saving: false, error: 'Failed to save preferences' }));
    }
  };

  return {
    state,
    updatePreferences,
    reload: loadData
  };
}
