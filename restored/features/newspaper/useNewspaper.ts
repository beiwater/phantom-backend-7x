/**
 * Custom Hook for Newspaper Editions and Articles
 */

import { useState, useEffect, useCallback } from 'react';
import { newspaperApi, type NewspaperArticle } from '../../api/newspaper-api.ts';
import type { NewspaperState } from './types.ts';

export function useNewspaper(realmId = 0) {
  const [state, setState] = useState<NewspaperState>({
    currentEdition: null,
    selectedArticle: null,
    loading: true,
    error: null
  });

  const loadCurrentEdition = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const edition = await newspaperApi.fetchCurrentEdition(realmId);
      setState(prev => ({ ...prev, currentEdition: edition, loading: false }));
    } catch {
      setState(prev => ({ ...prev, loading: false, error: 'Failed to load newspaper edition' }));
    }
  }, [realmId]);

  useEffect(() => {
    loadCurrentEdition();
  }, [loadCurrentEdition]);

  const viewArticle = (article: NewspaperArticle | null) => {
    setState(prev => ({ ...prev, selectedArticle: article }));
  };

  const voteArticle = async (articleId: number) => {
    try {
      const res = await newspaperApi.voteArticle(articleId);
      setState(prev => {
        if (!prev.currentEdition) return prev;
        const updatedArticles = prev.currentEdition.articles.map(a =>
          a.id === articleId ? { ...a, votes: res.votes, hasVoted: true } : a
        );
        return {
          ...prev,
          currentEdition: { ...prev.currentEdition, articles: updatedArticles }
        };
      });
    } catch {
      // Ignored
    }
  };

  return {
    state,
    viewArticle,
    voteArticle,
    reload: loadCurrentEdition
  };
}
