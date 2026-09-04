/**
 * Chat Feature Types
 */

import type { ChatMessage, ChatRoomInfo } from '../../api/chat-api.ts';

export interface ChatState {
  currentChannel: string;
  rooms: ChatRoomInfo[];
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  error: string | null;
}
