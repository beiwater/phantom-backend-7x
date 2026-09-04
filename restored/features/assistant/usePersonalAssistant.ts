/**
 * Custom Hook for Personal Assistant Interaction
 */

import { useState } from 'react';
import { assistantApi } from '../../api/assistant-api.ts';
import type { AssistantState } from './types.ts';

export function usePersonalAssistant(initialPaId = 1) {
  const [state, setState] = useState<AssistantState>({
    paId: initialPaId,
    isOpen: false,
    currentQuest: {
      id: 1,
      title: 'First Retail Venture',
      description: 'Produce and sell 100 units of Apples in your Grocery Store.',
      category: 'RETAIL',
      progress: 45,
      target: 100,
      isCompleted: false,
      rewardMoney: 12000,
      rewardSimboosts: 5
    },
    loading: false,
    actionExecuting: false,
    lastReward: null,
    error: null
  });

  const openAssistant = () => setState(prev => ({ ...prev, isOpen: true }));
  const closeAssistant = () => setState(prev => ({ ...prev, isOpen: false, lastReward: null }));

  const executeAction = async (action: string) => {
    setState(prev => ({ ...prev, actionExecuting: true, error: null }));
    try {
      const res = await assistantApi.executeAction(state.paId, action);
      setState(prev => ({
        ...prev,
        actionExecuting: false,
        lastReward: {
          money: res.moneyEarned ?? 0,
          simboosts: res.simboostsEarned ?? 0
        },
        currentQuest: res.nextQuest ?? prev.currentQuest
      }));
    } catch {
      setState(prev => ({ ...prev, actionExecuting: false, error: 'Failed to complete assistant task' }));
    }
  };

  return {
    state,
    openAssistant,
    closeAssistant,
    executeAction
  };
}
