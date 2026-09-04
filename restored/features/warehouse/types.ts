/**
 * Warehouse Feature Types
 */

import type { WarehouseItem, B2BContract } from '../../api/warehouse-api.ts';

export interface WarehouseState {
  items: WarehouseItem[];
  incomingContracts: B2BContract[];
  outgoingContracts: B2BContract[];
  searchQuery: string;
  loading: boolean;
  error: string | null;
}
