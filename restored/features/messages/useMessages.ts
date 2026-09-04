/**
 * Custom Hook for Direct Messages
 */

import { useState, useEffect, useCallback } from 'react';
import { messagesApi, type DirectMessage } from '../../api/messages-api.ts';
import type { MessagesState } from './types.ts';

export function useMessages(myCompanyId: number) {
  const [state, setState] = useState<MessagesState>({
    conversations: [],
    selectedCompanyId: null,
    thread: [],
    loading: true,
    sending: false,
    error: null
  });

  const loadConversations = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true }));
    try {
      const convs = await messagesApi.fetchConversations(myCompanyId);
      setState(prev => ({
        ...prev,
        conversations: convs,
        selectedCompanyId: prev.selectedCompanyId ?? (convs[0]?.companyId ?? null),
        loading: false
      }));
    } catch {
      setState(prev => ({ ...prev, loading: false, error: 'Failed to load conversations' }));
    }
  }, [myCompanyId]);

  const loadThread = useCallback(async (targetCompanyId: number) => {
    try {
      const thread = await messagesApi.fetchThread(myCompanyId, targetCompanyId);
      setState(prev => ({ ...prev, thread }));
    } catch {
      setState(prev => ({ ...prev, error: 'Failed to load message thread' }));
    }
  }, [myCompanyId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (state.selectedCompanyId) {
      loadThread(state.selectedCompanyId);
    }
  }, [state.selectedCompanyId, loadThread]);

  const selectCompany = (companyId: number) => {
    setState(prev => ({ ...prev, selectedCompanyId: companyId }));
  };

  const sendMessage = async (body: string) => {
    if (!state.selectedCompanyId || !body.trim()) return;
    setState(prev => ({ ...prev, sending: true }));
    try {
      const msg = await messagesApi.sendMessage({
        recipientCompanyId: state.selectedCompanyId,
        body
      });
      setState(prev => ({
        ...prev,
        thread: [...prev.thread, msg],
        sending: false
      }));
    } finally {
      setState(prev => ({ ...prev, sending: false }));
    }
  };

  return {
    state,
    selectCompany,
    sendMessage,
    refresh: loadConversations
  };
}
