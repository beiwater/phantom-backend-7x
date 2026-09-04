/**
 * Root Newspaper Frontpage
 */

import React from 'react';
import { useNewspaper } from './useNewspaper.ts';
import { ArticleDetail } from './ArticleDetail.tsx';

export interface NewspaperPageProps {
  realmId?: number;
}

export const NewspaperPage: React.FC<NewspaperPageProps> = ({ realmId = 0 }) => {
  const { state, viewArticle, voteArticle } = useNewspaper(realmId);

  if (state.loading) {
    return <div className="p-8 text-center text-gray-500">Printing latest edition...</div>;
  }

  if (state.error || !state.currentEdition) {
    return <div className="p-8 text-center text-red-500">{state.error || 'No edition available'}</div>;
  }

  if (state.selectedArticle) {
    return (
      <div className="py-6 px-4">
        <ArticleDetail
          article={state.selectedArticle}
          onVote={voteArticle}
          onBack={() => viewArticle(null)}
        />
      </div>
    );
  }

  const { editionNumber, date, articles, sponsor } = state.currentEdition;

  return (
    <div className="newspaper-page max-w-5xl mx-auto py-6 px-4 font-serif">
      {/* Newspaper Masthead */}
      <div className="border-b-4 border-black dark:border-gray-300 pb-3 mb-6 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-white uppercase">
          Sim Companies Times
        </h1>
        <div className="flex justify-between items-center text-xs text-gray-500 mt-2 border-t border-b py-1">
          <span>Edition #{editionNumber}</span>
          <span>Official Economic Gazette</span>
          <span>{new Date(date).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Sponsor Banner */}
      {sponsor && (
        <div className="p-4 mb-6 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 rounded-lg flex items-center justify-between text-xs">
          <div>
            <span className="font-bold text-amber-900 dark:text-amber-200">Sponsored by {sponsor.companyName}:</span>
            <span className="ml-2 italic text-gray-600 dark:text-gray-400">&ldquo;{sponsor.message}&rdquo;</span>
          </div>
          <span className="text-[10px] text-amber-600 uppercase font-bold tracking-wider">Featured Partner</span>
        </div>
      )}

      {/* Articles Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {articles.map((art, idx) => (
          <div
            key={art.id}
            className={`p-5 bg-white dark:bg-gray-800 rounded-lg shadow border dark:border-gray-700 flex flex-col justify-between ${
              idx === 0 ? 'md:col-span-2' : ''
            }`}
          >
            <div>
              <div className="text-xs text-gray-400 mb-1">By {art.author}</div>
              <h2 className={`font-bold text-gray-900 dark:text-white mb-2 ${idx === 0 ? 'text-2xl' : 'text-lg'}`}>
                {art.title}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3 mb-4 font-sans">
                {art.summary}
              </p>
            </div>
            <div className="flex justify-between items-center pt-3 border-t text-xs font-sans">
              <button
                type="button"
                onClick={() => viewArticle(art)}
                className="text-blue-600 font-semibold hover:underline"
              >
                Read Full Story →
              </button>
              <span className="text-gray-400">{art.votes} Votes</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
