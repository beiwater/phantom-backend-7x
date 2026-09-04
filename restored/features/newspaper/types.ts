/**
 * Newspaper Feature Types
 */

import type { NewspaperEdition, NewspaperArticle } from '../../api/newspaper-api.ts';

export interface NewspaperState {
  currentEdition: NewspaperEdition | null;
  selectedArticle: NewspaperArticle | null;
  loading: boolean;
  error: string | null;
}
