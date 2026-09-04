/**
 * Newspaper API Client
 */

import { httpClient } from './http-client.ts';
import { Routes } from '../routes/route-definitions.ts';

export interface NewspaperArticle {
  id: number;
  title: string;
  author: string;
  publishedAt: string;
  summary: string;
  body: string;
  votes: number;
  hasVoted?: boolean;
}

export interface NewspaperEdition {
  editionNumber: number;
  date: string;
  articles: NewspaperArticle[];
  sponsor?: {
    companyName: string;
    companyId: number;
    logoUrl: string;
    message: string;
  };
}

export const newspaperApi = {
  async fetchCurrentEdition(realmId: number | string = 0): Promise<NewspaperEdition> {
    const res = await httpClient.get<NewspaperEdition>(Routes.api.newspaper.current(realmId));
    return res.data;
  },

  async fetchArchivedEdition(realmId: number | string, edition: number | string): Promise<NewspaperEdition> {
    const res = await httpClient.get<NewspaperEdition>(Routes.api.newspaper.archive(realmId, edition));
    return res.data;
  },

  async fetchArticle(articleId: number | string): Promise<NewspaperArticle> {
    const res = await httpClient.get<NewspaperArticle>(Routes.api.newspaper.article(articleId));
    return res.data;
  },

  async voteArticle(articleId: number | string): Promise<{ votes: number }> {
    const res = await httpClient.post<{ votes: number }>(Routes.api.newspaper.vote(articleId));
    return res.data;
  }
};
