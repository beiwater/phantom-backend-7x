/**
 * Root Chatroom Page
 */

import React from 'react';
import { useChatroom } from './useChatroom.ts';
import { ChatMessageList } from './ChatMessageList.tsx';
import { ChatInput } from './ChatInput.tsx';

export interface ChatroomPageProps {
  currentCompanyId: number;
  initialChannel?: string;
}

export const ChatroomPage: React.FC<ChatroomPageProps> = ({
  currentCompanyId,
  initialChannel = 'game'
}) => {
  const { state, switchChannel, sendMessage } = useChatroom(currentCompanyId, initialChannel);

  return (
    <div className="chatroom-page max-w-5xl mx-auto py-6 px-4 flex flex-col md:flex-row gap-6 h-[80vh]">
      {/* Channel Sidebar */}
      <div className="w-full md:w-56 bg-white dark:bg-gray-800 p-3 rounded-lg border dark:border-gray-700 flex flex-col">
        <h3 className="font-bold text-sm uppercase text-gray-500 mb-3 px-2">Chat Channels</h3>
        <div className="space-y-1">
          {state.rooms.map(room => (
            <button
              key={room.channel}
              type="button"
              onClick={() => switchChannel(room.channel)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition ${
                state.currentChannel === room.channel
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              #{room.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main Chat Stream */}
      <div className="flex-1 flex flex-col bg-white dark:bg-gray-800 p-4 rounded-lg border dark:border-gray-700">
        <div className="flex justify-between items-center mb-3 pb-2 border-b dark:border-gray-700">
          <div className="font-bold text-base text-gray-900 dark:text-white capitalize">
            #{state.currentChannel} Channel
          </div>
          <span className="text-xs text-gray-400">Live Global Communication</span>
        </div>

        <ChatMessageList messages={state.messages} currentCompanyId={currentCompanyId} />
        <ChatInput onSendMessage={sendMessage} disabled={state.sending} />
      </div>
    </div>
  );
};
