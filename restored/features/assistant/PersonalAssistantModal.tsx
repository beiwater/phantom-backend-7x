/**
 * Personal Assistant Modal Component
 */

import React from 'react';
import type { AssistantQuest } from '../../api/assistant-api.ts';

export interface PersonalAssistantModalProps {
  isOpen: boolean;
  quest: AssistantQuest | null;
  onClose: () => void;
  onClaimReward: () => Promise<void>;
  isExecuting: boolean;
  rewardEarned: { money: number; simboosts: number } | null;
}

export const PersonalAssistantModal: React.FC<PersonalAssistantModalProps> = ({
  isOpen,
  quest,
  onClose,
  onClaimReward,
  isExecuting,
  rewardEarned
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-2xl max-w-md w-full border dark:border-gray-700">
        <div className="flex justify-between items-center mb-4 border-b pb-3 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-xl">
              👩‍💼
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">Personal Assistant</h3>
              <span className="text-xs text-gray-400">Executive Advisor</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">
            ✕
          </button>
        </div>

        {rewardEarned && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-950/40 border border-green-200 rounded-lg text-xs text-green-800 dark:text-green-200 text-center font-semibold">
            🎉 Reward Claimed: +${rewardEarned.money.toLocaleString()} & +{rewardEarned.simboosts} SimBoosts!
          </div>
        )}

        {quest ? (
          <div className="space-y-4">
            <div>
              <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Active Task</span>
              <h4 className="text-base font-bold text-gray-900 dark:text-white mt-0.5">{quest.title}</h4>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{quest.description}</p>
            </div>

            {/* Progress Bar */}
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Progress</span>
                <span>{quest.progress} / {quest.target}</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (quest.progress / quest.target) * 100)}%` }}
                />
              </div>
            </div>

            <div className="p-3 bg-gray-50 dark:bg-gray-700/40 rounded-lg flex justify-between items-center text-xs">
              <span className="text-gray-500">Completion Reward:</span>
              <span className="font-bold text-emerald-600">
                +${quest.rewardMoney?.toLocaleString()} • +{quest.rewardSimboosts} SB
              </span>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={onClaimReward}
                disabled={isExecuting || quest.progress < quest.target}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm disabled:opacity-50"
              >
                {isExecuting ? 'Processing...' : quest.progress >= quest.target ? 'Claim Reward' : 'In Progress'}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-gray-400 text-sm">
            All company guidance tasks completed for today.
          </div>
        )}
      </div>
    </div>
  );
};
