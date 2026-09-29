import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '../lib/supabase';
import { resolveDownload } from '../lib/api';
import { EmptyState, Feedback, Loading, Page, errorMessage, formatDate } from '../components/UI';

export default function ArticleDetail() {
  const { slug = '' } = useParams();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [expandedAbstract, setExpandedAbstract] = useState(false);
  const result = useQuery({
    queryKey: ['article', slug],
    queryFn: async ({ signal }) => {
      const { data, error } = await getSupabase()
        .from('articles')
        .select('id,slug,title,abstract,author_names,category,keywords,published_at')
        .eq('slug', slug)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const download = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const url = await resolveDownload({ article_slug: slug });
      window.location.assign(url);
    } catch (error) {
      setDownloadError(errorMessage(error));
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Page
      title="Article"
      narrow
      actions={
        <Link to="/articles" className="text-link text-sm">
          All Articles
        </Link>
      }
    >
      {result.isPending ? (
        <Loading>Loading article…</Loading>
      ) : result.isError ? (
        <>
          <Feedback error={errorMessage(result.error)} />
          <button className="btn-secondary" onClick={() => void result.refetch()}>
            Retry
          </button>
        </>
      ) : !result.data ? (
        <EmptyState title="Article not found">
          This article does not exist or is not published.
        </EmptyState>
      ) : (
        <article className="card">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-wider mb-3">
            {result.data.category}
          </p>
          <h2 className="font-serif text-2xl sm:text-3xl font-bold text-slate-900 mb-4">
            {result.data.title}
          </h2>
          <p className="text-slate-700 mb-2">{result.data.author_names}</p>
          <p className="text-sm text-slate-500 mb-8">
            Published {formatDate(result.data.published_at)}
          </p>
          <h3 className="font-serif text-xl font-bold mb-3">Abstract</h3>
          <p
            id="article-abstract"
            className={`whitespace-pre-wrap text-slate-600 leading-relaxed ${expandedAbstract || result.data.abstract.length <= 500 ? '' : 'line-clamp-8'}`}
          >
            {result.data.abstract}
          </p>
          {result.data.abstract.length > 500 && (
            <button
              type="button"
              className="text-link text-sm mt-3"
              aria-expanded={expandedAbstract}
              aria-controls="article-abstract"
              onClick={() => setExpandedAbstract(!expandedAbstract)}
            >
              {expandedAbstract ? 'Show less' : 'Read full abstract'}
            </button>
          )}
          {result.data.keywords?.length > 0 && (
            <p className="mt-5 text-sm text-slate-500">
              <strong>Keywords: </strong>
              {result.data.keywords.join(', ')}
            </p>
          )}
          <Feedback error={downloadError} />
          <button
            type="button"
            className="btn mt-8"
            onClick={() => void download()}
            disabled={downloading}
          >
            {downloading ? 'Preparing download…' : 'Download Article'}
          </button>
          <p className="text-xs text-slate-500 mt-3">
            Downloads the publication file selected for this article.
          </p>
        </article>
      )}
    </Page>
  );
}
