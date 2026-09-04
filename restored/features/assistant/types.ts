/**
 * Personal Assistant (PA) Feature Types
 */

import type { AssistantQuest } from '../../api/assistant-api.ts';

export interface AssistantState {
  paId: number;
  isOpen: boolean;
  currentQuest: AssistantQuest | null;
  loading: boolean;
  actionExecuting: boolean;
  lastReward: { money: number; simboosts: number } | null;
  error: string | null;
}
