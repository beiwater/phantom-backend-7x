/**
 * Direct Message Conversation Thread View
 */

import React, { useState } from 'react';
import type { DirectMessage } from '../../api/messages-api.ts';

export interface ConversationViewProps {
  thread: DirectMessage[];
  myCompanyId: number;
  recipientName: string;
  onSendMessage: (body: string) => Promise<void>;
  sending: boolean;
}

export const ConversationView: React.FC<ConversationViewProps> = ({
  thread,
  myCompanyId,
  recipientName,
  onSendMessage,
  sending
}) => {
  const [text, setText] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    const toSend = text;
    setText('');
    await onSendMessage(toSend);
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="p-3 border-b dark:border-gray-700 font-semibold text-sm">
        Direct Message with: {recipientName}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-900">
        {thread.length === 0 ? (
          <div className="text-center text-gray-400 py-12 text-sm">No messages exchanged yet.</div>
        ) : (
          thread.map(msg => {
            const isMe = msg.senderCompanyId === myCompanyId;
            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div className="text-[10px] text-gray-400 mb-0.5">
                  {new Date(msg.sentAt).toLocaleTimeString()}
                </div>
                <div
                  className={`px-3.5 py-2 rounded-2xl text-sm max-w-md ${
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

      <form onSubmit={handleSubmit} className="p-3 border-t dark:border-gray-700 flex gap-2">
        <input
          type="text"
          placeholder="Type private message..."
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={sending}
          className="flex-1 px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
};
