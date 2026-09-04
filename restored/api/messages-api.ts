/**
 * Direct Messages & Contacts API Client
 */

import { httpClient } from './http-client.ts';
import { Routes } from '../routes/route-definitions.ts';

export interface DirectMessage {
  id: number;
  senderCompanyId: number;
  senderCompanyName: string;
  recipientCompanyId: number;
  recipientCompanyName: string;
  body: string;
  sentAt: string;
  isRead: boolean;
}

export interface ContactItem {
  companyId: number;
  name: string;
  logo: string;
  unreadCount: number;
  lastMessage?: string;
  lastMessageAt?: string;
}

export const messagesApi = {
  async fetchConversations(companyId: number | string): Promise<ContactItem[]> {
    const res = await httpClient.get<ContactItem[]>(Routes.api.messages.list(companyId));
    return res.data;
  },

  async fetchThread(companyId: number | string, targetCompanyId: number | string): Promise<DirectMessage[]> {
    const res = await httpClient.get<DirectMessage[]>(Routes.api.messages.thread(companyId, targetCompanyId));
    return res.data;
  },

  async sendMessage(params: {
    recipientCompanyId: number;
    body: string;
  }): Promise<DirectMessage> {
    const res = await httpClient.post<DirectMessage>(Routes.api.messages.send(), params);
    return res.data;
  },

  async fetchContacts(companyId: number | string): Promise<ContactItem[]> {
    const res = await httpClient.get<ContactItem[]>(Routes.api.messages.contacts(companyId));
    return res.data;
  }
};
