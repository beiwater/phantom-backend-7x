/**
 * Custom Hook for Chatroom Data and Sending Messages
 */

import { useState, useEffect, useCallback } from 'react';
import { chatApi, type ChatMessage } from '../../api/chat-api.ts';
import type { ChatState } from './types.ts';

export function useChatroom(companyId: number, defaultChannel = 'game') {
  const [state, setState] = useState<ChatState>({
    currentChannel: defaultChannel,
    rooms: [
      { channel: 'game', name: 'Game Chat', unreadCount: 0 },
      { channel: 'sales', name: 'Sales / Exchange', unreadCount: 0 },
      { channel: 'help', name: 'Help & Beginners', unreadCount: 0 },
      { channel: 'social', name: 'Social Lounge', unreadCount: 0 },
      { channel: 'roleplay', name: 'Roleplay', unreadCount: 0 }
    ],
    messages: [],
    loading: true,
    sending: false,
    error: null
  });

  const loadMessages = useCallback(async (channel: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const msgs = await chatApi.fetchMessages(channel);
      setState(prev => ({ ...prev, messages: msgs, loading: false }));
    } catch {
      setState(prev => ({ ...prev, loading: false, error: 'Failed to load chat messages' }));
    }
  }, []);

  useEffect(() => {
    loadMessages(state.currentChannel);
  }, [state.currentChannel, loadMessages]);

  const switchChannel = (channel: string) => {
    setState(prev => ({ ...prev, currentChannel: channel }));
  };

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;
    setState(prev => ({ ...prev, sending: true }));
    try {
      const newMsg = await chatApi.postMessage(state.currentChannel, text);
      setState(prev => ({
        ...prev,
        messages: [...prev.messages, newMsg],
        sending: false
      }));
    } finally {
      setState(prev => ({ ...prev, sending: false }));
    }
  };

  return {
    state,
    switchChannel,
    sendMessage,
    refresh: () => loadMessages(state.currentChannel)
  };
}
