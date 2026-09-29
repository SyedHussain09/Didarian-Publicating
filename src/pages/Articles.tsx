import { useEffect, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '../lib/supabase';
import { categories } from '../lib/models';
import { Hero } from '../components/Hero';
import {
  EmptyState,
  Feedback,
  Loading,
  Pagination,
  errorMessage,
  formatDate,
} from '../components/UI';

const PAGE_SIZE = 4;
export default function Articles({ home = false }: { home?: boolean }) {
  const [search, setSearch] = useSearchParams();
  const term = (search.get('q') || '').trim().slice(0, 120);
  const requestedCategory = search.get('category') || '';
  const category = categories.includes(requestedCategory) ? requestedCategory : '';
  const rawPage = Number(search.get('page') || '1');
  const page = Number.isSafeInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage - 1, 100000) : 0;
  const queryClient = useQueryClient();
  const result = useQuery({
    queryKey: ['articles', term, category, page],
    queryFn: async ({ signal }) => {
      let query = getSupabase()
        .from('articles')
        .select('id,slug,title,abstract,author_names,category,keywords,published_at', {
          count: 'exact',
        })
        .order('published_at', { ascending: false })
        .order('id')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (term) query = query.ilike('title', `%${term.replace(/[\\%_]/g, '\\$&')}%`);
      if (category) query = query.eq('category', category);
      const { data, error, count } = await query.abortSignal(signal);
      if (error) throw error;
      return { rows: data || [], count: count || 0 };
    },
    refetchInterval: 60_000,
  });
  useEffect(() => {
    let client: ReturnType<typeof getSupabase>;
    try {
      client = getSupabase();
    } catch {
      return;
    }
    const channel = client
      .channel('public-article-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'articles' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['articles'] });
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [queryClient]);
  const updateSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const q = String(fields.get('q') || '').trim();
    const selected = String(fields.get('category') || '');
    setSearch({ ...(q ? { q } : {}), ...(selected ? { category: selected } : {}) });
  };
  const changePage = (next: number) => {
    setSearch({
      ...(term ? { q: term } : {}),
      ...(category ? { category } : {}),
      page: String(next + 1),
    });
    document.getElementById('article-library')?.scrollIntoView({ block: 'start' });
  };
  return (
    <section className="page-section library-page">
      <div className="site-container">
        {home ? (
          <header className="library-hero">
            <div className="relative z-10">
              <p className="eyebrow">
                <span className="status-dot" /> Open access · Multidisciplinary research
              </p>
              <h1>
                Research, <em>open to everyone.</em>
              </h1>
              <p className="library-intro">
                Discover ideas across disciplines. Read published research, explore new
                perspectives, and share your own.
              </p>
              <Link to="/about" className="hero-text-link">
                Publish with Didarian <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <div className="library-art" aria-hidden="true">
              <Hero />
            </div>
          </header>
        ) : (
          <header className="page-heading">
            <div>
              <p className="eyebrow mb-2">The research library</p>
              <h1>Articles</h1>
            </div>
            <Link className="btn-secondary" to="/about">
              Publish with us <span aria-hidden="true">↗</span>
            </Link>
          </header>
        )}
        <section id="article-library" aria-labelledby="library-title" className="article-library">
          <div className="library-heading">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="library-title" className="font-serif text-2xl text-slate-900">
                {term || category ? 'Search results' : 'Latest articles'}
              </h2>
              {result.isSuccess && (
                <span className="count-label">
                  {result.data.count} {result.data.count === 1 ? 'article' : 'articles'}
                </span>
              )}
            </div>
            <span className="text-xs text-slate-500">Newest first</span>
          </div>
          <form
            onSubmit={updateSearch}
            className="library-filters"
            role="search"
            aria-label="Find articles"
          >
            <div className="search-field">
              <label className="sr-only" htmlFor="article-search">
                Search article titles
              </label>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 4.5 4.5" />
              </svg>
              <input
                key={term}
                id="article-search"
                type="search"
                name="q"
                defaultValue={term}
                placeholder="Search article titles…"
                maxLength={120}
              />
            </div>
            <div className="category-field">
              <label className="sr-only" htmlFor="article-category">
                Research discipline
              </label>
              <select key={category} id="article-category" name="category" defaultValue={category}>
                <option value="">All disciplines</option>
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </div>
            <button className="btn" type="submit">
              Search
            </button>
            {(term || category) && (
              <button type="button" className="clear-filters" onClick={() => setSearch({})}>
                Clear filters
              </button>
            )}
          </form>
          {result.isPending ? (
            <Loading>Loading published articles…</Loading>
          ) : result.isError ? (
            <div className="card">
              <Feedback error={errorMessage(result.error)} />
              <button className="btn-secondary" onClick={() => void result.refetch()}>
                Retry
              </button>
            </div>
          ) : (
            <>
              {result.data.rows.length === 0 ? (
                <div className="library-empty">
                  <div className="empty-book" aria-hidden="true">
                    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M24 12c-5-4-12-5-18-3v27c6-2 13-1 18 3 5-4 12-5 18-3V9c-6-2-13-1-18 3Zm0 0v27M11 16c3 0 6 .6 8 2m-8 5c3 0 6 .6 8 2m10-7c2-1.4 5-2 8-2m-8 9c2-1.4 5-2 8-2" />
                    </svg>
                  </div>
                  <EmptyState
                    title={
                      page > 0
                        ? 'No articles on this page'
                        : term || category
                          ? 'No matching articles'
                          : 'No published articles yet'
                    }
                  >
                    {page > 0
                      ? 'Return to the first page to explore the available research.'
                      : term || category
                        ? 'Try another title or discipline, or clear your filters.'
                        : 'Our research library is ready for its first publication. Accepted and published papers will appear here.'}
                  </EmptyState>
                  {page > 0 ? (
                    <button className="btn-secondary" onClick={() => changePage(0)}>
                      First page
                    </button>
                  ) : !term && !category ? (
                    <Link className="btn-secondary" to="/author/submissions/new">
                      Submit Your Paper <span aria-hidden="true">↗</span>
                    </Link>
                  ) : (
                    <button className="btn-secondary" onClick={() => setSearch({})}>
                      View all articles
                    </button>
                  )}
                </div>
              ) : (
                <div className="article-grid">
                  {result.data.rows.map((article) => (
                    <article key={article.id} className="article-card">
                      <Link to={`/articles/${article.slug}`} className="article-card-link">
                        <div className="flex justify-between gap-3 items-center mb-3">
                          <span className="article-category">{article.category}</span>
                          <span className="text-slate-400 text-lg" aria-hidden="true">
                            ↗
                          </span>
                        </div>
                        <h3 className="font-serif text-xl text-slate-900 leading-snug line-clamp-2">
                          {article.title}
                        </h3>
                        <p className="article-authors line-clamp-1">{article.author_names}</p>
                        <p className="article-abstract line-clamp-2">{article.abstract}</p>
                        <div className="article-card-footer">
                          <time dateTime={article.published_at || undefined}>
                            {formatDate(article.published_at)}
                          </time>
                          <span>
                            Read Article <span aria-hidden="true">→</span>
                          </span>
                        </div>
                      </Link>
                    </article>
                  ))}
                </div>
              )}
              {(result.data.count > 0 || page > 0) && (
                <Pagination
                  page={page}
                  total={result.data.count}
                  pageSize={PAGE_SIZE}
                  onChange={changePage}
                />
              )}
            </>
          )}
        </section>
        {home && (
          <aside className="publication-strip">
            <div>
              <span className="eyebrow">For authors</span>
              <p className="font-serif text-lg text-slate-900 mt-1">
                Give your next idea a place to grow.
              </p>
            </div>
            <Link className="text-link text-sm" to="/about">
              Explore the publication process <span aria-hidden="true">↗</span>
            </Link>
          </aside>
        )}
      </div>
    </section>
  );
}
