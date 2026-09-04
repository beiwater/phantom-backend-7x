/**
 * Player Profile & Preferences Types
 */

import type { CompanyProfile, PlayerPreferences } from '../../api/profile-api.ts';

export interface ProfileState {
  profile: CompanyProfile | null;
  preferences: PlayerPreferences;
  loading: boolean;
  saving: boolean;
  error: string | null;
}
