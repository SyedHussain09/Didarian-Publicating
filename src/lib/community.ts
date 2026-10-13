import { command } from './api';

export interface ArticleComment {
  id: string;
  article_id: string;
  reviewer_id: string;
  username: string;
  body: string;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface Activity {
  like_count: number;
  comment_count: number;
  liked: boolean;
  saved: boolean;
  comments: ArticleComment[];
}
export type ActivityAction = 'comment' | 'edit_comment' | 'delete_comment' | 'like' | 'save';
export const readActivity = (id: string, page: number) =>
  command<Activity>('article_activity', { p_article_id: id, p_page: page });
export const writeActivity = (
  id: string,
  action: ActivityAction,
  options: {
    comment?: Pick<ArticleComment, 'id' | 'version'>;
    body?: string;
    enabled?: boolean;
  } = {},
) =>
  command<{ ok: boolean }>('write_article_activity', {
    p_article_id: id,
    p_action: action,
    p_comment_id: options.comment?.id ?? null,
    p_expected_version: options.comment?.version ?? null,
    p_body: options.body ?? null,
    p_enabled: options.enabled ?? null,
  });
export interface ReadingItem {
  id: string;
  slug: string;
  title: string;
  author_names: string;
  category: string;
  deleted_at: string | null;
  created_at: string;
  comment_id: string | null;
  body: string | null;
  version: number | null;
}
export type ReadingKind = 'saved' | 'liked' | 'comments';
export const readingList = (kind: ReadingKind, page: number) =>
  command<{ count: number; rows: ReadingItem[] }>('my_reading_list', {
    p_kind: kind,
    p_page: page,
  });
export interface ManagedArticle {
  id: string;
  slug: string;
  title: string;
  author_names: string;
  category: string;
  published_at: string;
  deleted_at: string | null;
}
export const adminPublications = (page: number, removed: boolean) =>
  command<{ count: number; rows: ManagedArticle[] }>('admin_publications', {
    p_page: page,
    p_removed: removed,
  });
export const moderateArticle = (id: string, removed: boolean, reason: string) =>
  command<void>('moderate_article', { p_article_id: id, p_removed: removed, p_reason: reason });
