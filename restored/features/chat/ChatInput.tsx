/**
 * Chat Input Component
 */

import React, { useState } from 'react';

export interface ChatInputProps {
  onSendMessage: (text: string) => Promise<void>;
  disabled?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, disabled = false }) => {
  const [text, setText] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    const toSend = text;
    setText('');
    await onSendMessage(toSend);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
      <input
        type="text"
        placeholder="Type a message to the channel..."
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={disabled}
        className="flex-1 px-4 py-2 text-sm border rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-gray-100"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm disabled:opacity-50"
      >
        Send
      </button>
    </form>
  );
};
