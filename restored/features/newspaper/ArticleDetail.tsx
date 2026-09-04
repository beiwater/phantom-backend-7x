/**
 * Newspaper Article Detail View
 */

import React from 'react';
import type { NewspaperArticle } from '../../api/newspaper-api.ts';

export interface ArticleDetailProps {
  article: NewspaperArticle;
  onVote: (articleId: number) => Promise<void>;
  onBack: () => void;
}

export const ArticleDetail: React.FC<ArticleDetailProps> = ({ article, onVote, onBack }) => {
  return (
    <article className="article-detail max-w-3xl mx-auto bg-white dark:bg-gray-800 p-8 rounded-lg shadow border dark:border-gray-700">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
      >
        ← Back to Edition Frontpage
      </button>

      <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">{article.title}</h1>
      <div className="text-xs text-gray-400 mb-6 flex justify-between items-center border-b pb-3 dark:border-gray-700">
        <span>By {article.author} • Published on {new Date(article.publishedAt).toLocaleDateString()}</span>
        <button
          type="button"
          onClick={() => onVote(article.id)}
          disabled={article.hasVoted}
          className={`px-3 py-1 rounded text-xs font-semibold ${
            article.hasVoted ? 'bg-green-100 text-green-800' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
          }`}
        >
          {article.hasVoted ? '✓ Upvoted' : `▲ Upvote (${article.votes})`}
        </button>
      </div>

      <div className="prose dark:prose-invert text-sm leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-line">
        {article.body}
      </div>
    </article>
  );
};
