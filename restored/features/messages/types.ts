/**
 * Direct Messages Feature Types
 */

import type { DirectMessage, ContactItem } from '../../api/messages-api.ts';

export interface MessagesState {
  conversations: ContactItem[];
  selectedCompanyId: number | null;
  thread: DirectMessage[];
  loading: boolean;
  sending: boolean;
  error: string | null;
}
