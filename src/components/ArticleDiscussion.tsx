import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { CommentText } from './CommentText';
import {
  readActivity,
  writeActivity,
  type ArticleComment,
  type ActivityAction,
} from '../lib/community';
import { ConfirmDialog } from '../features/portal/shared';
import { Feedback, Loading, Pagination, errorMessage, formatDate } from './UI';

export function ArticleDiscussion({ articleId, slug }: { articleId: string; slug: string }) {
  const { user, role, profile } = useAuth();
  const cache = useQueryClient();
  const [page, setPage] = useState(0);
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<ArticleComment | null>(null);
  const [editBody, setEditBody] = useState('');
  const [deleting, setDeleting] = useState<ArticleComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reviewer = role === 'reviewer' && profile?.profile_complete;
  const result = useQuery({
    queryKey: ['community', articleId, user?.id, page],
    queryFn: () => readActivity(articleId, page),
    refetchInterval: 30_000,
  });
  async function act(action: ActivityAction, options: Parameters<typeof writeActivity>[2] = {}) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await writeActivity(articleId, action, options);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['community', articleId] }),
        cache.invalidateQueries({ queryKey: ['reading-list'] }),
        cache.invalidateQueries({ queryKey: ['private'] }),
      ]);
      if (action === 'comment') {
        setBody('');
        setPage(0);
        setNotice('Your comment has been posted.');
      }
      if (action === 'edit_comment') {
        setEditing(null);
        setNotice('Your comment has been updated.');
      }
      if (action === 'delete_comment') {
        setDeleting(null);
        setNotice('Comment deleted.');
        if (result.data?.comments.length === 1 && page > 0) setPage(page - 1);
      }
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void act('comment', { body: body.trim() });
  };
  const join = `/login?role=reviewer&next=${encodeURIComponent(`/articles/${slug}#discussion`)}`;
  return (
    <section id="discussion" className="card mt-6 scroll-mt-24" aria-labelledby="discussion-title">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div>
          <p className="eyebrow mb-2">Research conversation</p>
          <h2 id="discussion-title" className="font-serif text-2xl font-bold">
            Discussion
          </h2>
        </div>
        {result.data && (
          <span className="text-xs text-slate-500">
            {result.data.like_count} {result.data.like_count === 1 ? 'like' : 'likes'} ·{' '}
            {result.data.comment_count} comments
          </span>
        )}
      </div>
      {result.isPending ? (
        <Loading>Loading discussion…</Loading>
      ) : result.isError ? (
        <>
          <Feedback error={errorMessage(result.error)} />
          <button className="btn-secondary" onClick={() => void result.refetch()}>
            Retry discussion
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-5">
            {reviewer ? (
              <>
                <button
                  className={`btn-secondary ${result.data.liked ? 'reaction-selected' : ''}`}
                  disabled={busy}
                  aria-pressed={result.data.liked}
                  onClick={() => void act('like', { enabled: !result.data.liked })}
                >
                  {result.data.liked ? '♥ Liked' : '♡ Like'}
                </button>
                <button
                  className={`btn-secondary ${result.data.saved ? 'reaction-selected' : ''}`}
                  disabled={busy}
                  aria-pressed={result.data.saved}
                  onClick={() => void act('save', { enabled: !result.data.saved })}
                >
                  {result.data.saved ? '✓ Saved' : '+ Save to reading list'}
                </button>
                <Link className="text-link text-sm" to="/reviewer">
                  My reading list
                </Link>
              </>
            ) : !user ? (
              <Link className="btn-secondary" to={join}>
                Sign in as Reviewer to participate
              </Link>
            ) : (
              <p className="text-sm text-slate-600">
                Comments, likes and saves are available to Reviewer accounts.{' '}
                {role === 'admin' && (
                  <Link className="text-link" to="/admin/publications">
                    Manage publications
                  </Link>
                )}
                {!profile?.profile_complete && (
                  <Link
                    className="text-link"
                    to={`/account/setup?next=${encodeURIComponent(`/articles/${slug}`)}`}
                  >
                    Complete your profile
                  </Link>
                )}
              </p>
            )}
          </div>
          <Feedback error={deleting ? null : error} success={notice} />
          {reviewer && (
            <form onSubmit={submit} className="discussion-composer mb-6">
              <label htmlFor="new-comment" className="text-sm font-semibold">
                Comment as @{profile.username}
              </label>
              <textarea
                id="new-comment"
                required
                minLength={1}
                maxLength={4000}
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={busy}
                placeholder="Share a thoughtful question or observation about this research…"
              />
              <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
                <p className="text-xs text-slate-500">
                  Public discussion · Authors are notified here, never by email.
                </p>
                <button className="btn" disabled={busy || !body.trim()}>
                  {busy ? 'Saving…' : 'Post comment'}
                </button>
              </div>
            </form>
          )}
          {!result.data.comments.length ? (
            <p className="py-5 text-sm text-slate-500">
              {page > 0
                ? 'There are no comments on this page.'
                : 'No comments yet. Start a constructive conversation about this paper.'}
            </p>
          ) : (
            <ol className="space-y-5">
              {result.data.comments.map((comment) => (
                <li key={comment.id} className="comment-card">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <strong className="text-sm">@{comment.username}</strong>
                      <span className="ml-3 text-xs text-slate-500">
                        {formatDate(comment.created_at)} {comment.version > 1 && '· Edited'}
                      </span>
                    </div>
                    <div className="flex gap-4 text-xs">
                      {reviewer && user?.id === comment.reviewer_id && (
                        <button
                          className="text-link"
                          disabled={busy}
                          onClick={() => {
                            setEditing(comment);
                            setEditBody(comment.body);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {(role === 'admin' || (reviewer && user?.id === comment.reviewer_id)) && (
                        <button
                          className="text-red-700"
                          disabled={busy}
                          onClick={() => {
                            setDeleting(comment);
                            setError(null);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  {editing?.id === comment.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void act('edit_comment', { comment: editing, body: editBody.trim() });
                      }}
                      className="mt-3"
                    >
                      <label>
                        Edit your comment
                        <textarea
                          required
                          maxLength={4000}
                          rows={4}
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          disabled={busy}
                        />
                      </label>
                      <div className="flex gap-3 mt-3">
                        <button className="btn" disabled={busy || !editBody.trim()}>
                          Save changes
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <CommentText body={comment.body} />
                  )}
                </li>
              ))}
            </ol>
          )}
          {(result.data.comment_count > 5 || page > 0) && (
            <Pagination
              page={page}
              total={result.data.comment_count}
              pageSize={5}
              onChange={setPage}
            />
          )}
        </>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete this comment?"
          busy={busy}
          onClose={() => {
            setDeleting(null);
            setError(null);
          }}
          onConfirm={() => void act('delete_comment', { comment: deleting })}
        >
          <p>The comment will be removed from the discussion. This cannot be undone.</p>
          <Feedback error={error} />
        </ConfirmDialog>
      )}
    </section>
  );
}
