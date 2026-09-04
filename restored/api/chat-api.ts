/**
 * Chatroom API Client
 * Reconstructed from index-cgzgptQ8.js chatentry & chatroom handlers
 */

import { httpClient } from './http-client.ts';
import { Routes } from '../routes/route-definitions.ts';

export interface ChatMessage {
  id: number;
  companyId: number;
  companyName: string;
  channel: string;
  body: string;
  timestamp: string;
  isModerator?: boolean;
  avatarUrl?: string;
}

export interface ChatRoomInfo {
  channel: string;
  name: string;
  unreadCount: number;
}

export const chatApi = {
  async fetchMessages(channelId: string): Promise<ChatMessage[]> {
    const res = await httpClient.get<ChatMessage[]>(Routes.api.chat.messages(channelId));
    return res.data;
  },

  async postMessage(channelId: string, message: string): Promise<ChatMessage> {
    const res = await httpClient.post<ChatMessage>(Routes.api.chat.postMessage(channelId), {
      message
    });
    return res.data;
  },

  async fetchCompanyRooms(companyId: number | string): Promise<ChatRoomInfo[]> {
    const res = await httpClient.get<ChatRoomInfo[]>(Routes.api.chat.rooms(companyId));
    return res.data;
  },

  async deleteMessage(messageId: number | string): Promise<void> {
    await httpClient.delete(Routes.api.chat.deleteMessage(messageId));
  }
};
