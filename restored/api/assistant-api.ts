/**
 * Personal Assistant (PA) API Client
 */

import { httpClient } from './http-client.ts';
import { Routes } from '../routes/route-definitions.ts';

export interface AssistantQuest {
  id: number;
  title: string;
  description: string;
  category: string;
  progress: number;
  target: number;
  isCompleted: boolean;
  rewardMoney?: number;
  rewardSimboosts?: number;
}

export interface AssistantActionResponse {
  success: boolean;
  message: string;
  moneyEarned?: number;
  simboostsEarned?: number;
  nextQuest?: AssistantQuest;
}

export const assistantApi = {
  async executeAction(paId: number | string, action: string): Promise<AssistantActionResponse> {
    const res = await httpClient.post<AssistantActionResponse>(
      Routes.api.assistant.action(paId, action)
    );
    return res.data;
  }
};
