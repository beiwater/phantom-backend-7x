/**
 * Root Direct Messaging & Contacts Page
 */

import React from 'react';
import { useMessages } from './useMessages.ts';
import { ConversationView } from './ConversationView.tsx';

export interface MessagesPageProps {
  myCompanyId: number;
}

export const MessagesPage: React.FC<MessagesPageProps> = ({ myCompanyId }) => {
  const { state, selectCompany, sendMessage } = useMessages(myCompanyId);

  const activeContact = state.conversations.find(c => c.companyId === state.selectedCompanyId);

  return (
    <div className="messages-page max-w-5xl mx-auto py-6 px-4 flex flex-col md:flex-row gap-6 h-[80vh]">
      {/* Conversations List Sidebar */}
      <div className="w-full md:w-64 bg-white dark:bg-gray-800 p-3 rounded-lg border dark:border-gray-700 flex flex-col overflow-y-auto">
        <h3 className="font-bold text-sm uppercase text-gray-500 mb-3 px-2">Conversations</h3>
        {state.conversations.length === 0 ? (
          <div className="text-xs text-gray-400 p-2">No active contacts found.</div>
        ) : (
          <div className="space-y-1">
            {state.conversations.map(conv => (
              <button
                key={conv.companyId}
                type="button"
                onClick={() => selectCompany(conv.companyId)}
                className={`w-full text-left p-2.5 rounded-lg text-sm transition flex justify-between items-center ${
                  state.selectedCompanyId === conv.companyId
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <div className="truncate">
                  <div className="font-semibold truncate">{conv.name}</div>
                  {conv.lastMessage && (
                    <div className="text-xs text-gray-400 truncate">{conv.lastMessage}</div>
                  )}
                </div>
                {conv.unreadCount > 0 && (
                  <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                    {conv.unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Thread */}
      <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 flex flex-col overflow-hidden">
        {state.selectedCompanyId ? (
          <ConversationView
            thread={state.thread}
            myCompanyId={myCompanyId}
            recipientName={activeContact?.name || `Company #${state.selectedCompanyId}`}
            onSendMessage={sendMessage}
            sending={state.sending}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Select a conversation from the left to read messages.
          </div>
        )}
      </div>
    </div>
  );
};
