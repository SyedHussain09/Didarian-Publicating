-- Composite foreign-key indexes requested by the Supabase performance advisor.
create index submissions_current_file_idx on public.submissions(id,current_file_id);
create index article_sources_submission_file_idx on private.article_sources(submission_id,file_id);
