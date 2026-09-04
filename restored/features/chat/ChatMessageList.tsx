/**
 * Chat Message List Component
 */

import React from 'react';
import type { ChatMessage } from '../../api/chat-api.ts';

export interface ChatMessageListProps {
  messages: ChatMessage[];
  currentCompanyId: number;
}

export const ChatMessageList: React.FC<ChatMessageListProps> = ({ messages, currentCompanyId }) => {
  return (
    <div className="chat-messages-container flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-900 rounded border">
      {messages.length === 0 ? (
        <div className="text-center text-gray-400 py-12 text-sm">No messages in this channel yet.</div>
      ) : (
        messages.map(msg => {
          const isMe = msg.companyId === currentCompanyId;
          return (
            <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                <span className="font-semibold text-gray-700 dark:text-gray-300">
                  {msg.companyName}
                </span>
                {msg.isModerator && (
                  <span className="bg-amber-100 text-amber-800 text-[10px] px-1 py-0.2 rounded">MOD</span>
                )}
                <span className="text-[10px]">{new Date(msg.timestamp).toLocaleTimeString()}</span>
              </div>
              <div
                className={`max-w-md px-3.5 py-2 rounded-2xl text-sm ${
                  isMe
                    ? 'bg-blue-600 text-white rounded-tr-none'
                    : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-tl-none border dark:border-gray-700'
                }`}
              >
                {msg.body}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
