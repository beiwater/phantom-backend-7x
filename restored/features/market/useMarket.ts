/**
 * Custom Hook for Market Exchange Order Book
 */

import { useState, useEffect, useCallback } from 'react';
import { marketApi, type MarketOrder } from '../../api/market-api.ts';
import type { MarketState } from './types.ts';

export function useMarket(realmId = 0, initialResourceId = 3) {
  const [state, setState] = useState<MarketState>({
    selectedResourceId: initialResourceId,
    orderBook: [],
    tickerPrice: 0,
    loading: true,
    submitting: false,
    error: null
  });

  const loadOrderBook = useCallback(async (resourceId: number) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const book = await marketApi.fetchOrderBook(realmId, resourceId);
      setState(prev => ({
        ...prev,
        orderBook: book.orders || [],
        loading: false
      }));
    } catch {
      setState(prev => ({ ...prev, loading: false, error: 'Failed to load order book' }));
    }
  }, [realmId]);

  useEffect(() => {
    loadOrderBook(state.selectedResourceId);
  }, [state.selectedResourceId, loadOrderBook]);

  const selectResource = (resourceId: number) => {
    setState(prev => ({ ...prev, selectedResourceId: resourceId }));
  };

  const takeOrder = async (orderId: number, amount: number) => {
    setState(prev => ({ ...prev, submitting: true }));
    try {
      await marketApi.takeOrder(orderId, amount);
      loadOrderBook(state.selectedResourceId);
    } finally {
      setState(prev => ({ ...prev, submitting: false }));
    }
  };

  const postOrder = async (amount: number, price: number, quality = 0) => {
    setState(prev => ({ ...prev, submitting: true }));
    try {
      const newOrder = await marketApi.postOrder({
        resourceId: state.selectedResourceId,
        amount,
        price,
        quality
      });
      setState(prev => ({
        ...prev,
        orderBook: [newOrder, ...prev.orderBook],
        submitting: false
      }));
    } finally {
      setState(prev => ({ ...prev, submitting: false }));
    }
  };

  return {
    state,
    selectResource,
    takeOrder,
    postOrder,
    reload: () => loadOrderBook(state.selectedResourceId)
  };
}
