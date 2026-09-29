-- Authoritative schema draft. The CLI-created migration contains this exact SQL.
-- Apply only to an inspected, designated development project before production rollout.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
revoke create on schema public from public, anon, authenticated;

create type public.app_role as enum ('author', 'admin');
create type public.submission_status as enum ('draft', 'submitted', 'under_review', 'published', 'rejected');
create type public.file_verification_state as enum ('pending', 'verified', 'rejected', 'deleting');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null check (char_length(last_name) between 1 and 80),
  affiliation text not null default '' check (char_length(affiliation) <= 200),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'author'
);
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  title text not null default '' check (char_length(title) <= 300),
  abstract text not null default '' check (char_length(abstract) <= 10000),
  author_names text not null default '' check (char_length(author_names) <= 1000),
  category text not null default '' check (char_length(category) <= 100),
  keywords text[] not null default '{}' check (cardinality(keywords) <= 12 and char_length(array_to_string(keywords, ',')) <= 600),
  publication_consent boolean not null default false,
  status public.submission_status not null default 'draft',
  current_file_id uuid,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), submitted_at timestamptz,
  check ((status = 'draft') or (current_file_id is not null and publication_consent))
);
create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id),
  storage_path text not null unique check (char_length(storage_path) <= 200),
  original_name text not null check (char_length(original_name) between 1 and 180),
  media_type text not null check (media_type in ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  byte_size bigint not null check (byte_size between 16 and 20971520),
  version integer not null check (version > 0),
  verification_state public.file_verification_state not null default 'pending',
  sha256 text check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(), verified_at timestamptz,
  unique(submission_id, version), unique(submission_id, id),
  check (verification_state <> 'verified' or (sha256 is not null and verified_at is not null))
);
alter table public.submissions add constraint submissions_current_file_fkey foreign key (id, current_file_id) references public.submission_files(submission_id, id);
create table public.submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id),
  kind text not null check (kind in ('submitted','review_started','accepted','published','rejected')),
  from_status public.submission_status not null, to_status public.submission_status not null,
  feedback text not null default '' check (char_length(feedback) <= 4000),
  created_at timestamptz not null default now(),
  unique(submission_id,kind)
);
create table public.articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (char_length(slug) between 1 and 180),
  title text not null check (char_length(title) between 5 and 300),
  abstract text not null check (char_length(abstract) between 30 and 10000),
  author_names text not null check (char_length(author_names) between 2 and 1000),
  category text not null check (char_length(category) between 2 and 100),
  keywords text[] not null default '{}',
  download_filename text not null, download_media_type text not null,
  published_at timestamptz not null default now()
);
create table private.article_sources (
  article_id uuid primary key references public.articles(id),
  submission_id uuid not null unique references public.submissions(id),
  file_id uuid not null references public.submission_files(id),
  published_by uuid not null references auth.users(id),
  foreign key(submission_id,file_id) references public.submission_files(submission_id,id)
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(id),
  submission_id uuid not null references public.submissions(id), event_id uuid not null unique references public.submission_events(id),
  message text not null check (char_length(message) <= 1000), read_at timestamptz, created_at timestamptz not null default now()
);
create table public.admin_notes (
  id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.submissions(id),
  actor_id uuid not null references auth.users(id), note text not null check (char_length(note) between 1 and 4000), created_at timestamptz not null default now()
);
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(), name text not null check (char_length(name) between 2 and 100),
  email text not null check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  message text not null check (char_length(message) between 10 and 5000), state text not null default 'new' check (state in ('new','read','handled')),
  created_at timestamptz not null default now(), handled_at timestamptz
);
create table private.contact_rate_limits (
  key text not null, window_start timestamptz not null, count integer not null check (count > 0), primary key(key,window_start)
);
create index submissions_owner_created_idx on public.submissions(owner_id,created_at desc);
create index submissions_status_submitted_idx on public.submissions(status,submitted_at desc);
create index submission_events_submission_created_idx on public.submission_events(submission_id,created_at);
create index notifications_recipient_created_idx on public.notifications(recipient_id,created_at desc);
create index notifications_submission_idx on public.notifications(submission_id);
create index admin_notes_submission_idx on public.admin_notes(submission_id,created_at);
create index admin_notes_actor_idx on public.admin_notes(actor_id);
create index articles_published_idx on public.articles(published_at desc,id);
create index contact_messages_state_created_idx on public.contact_messages(state,created_at desc);
create index article_sources_file_idx on private.article_sources(file_id);
create index article_sources_actor_idx on private.article_sources(published_by);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_files enable row level security;
alter table public.submission_events enable row level security;
alter table public.articles enable row level security;
alter table public.notifications enable row level security;
alter table public.admin_notes enable row level security;
alter table public.contact_messages enable row level security;
alter table private.article_sources enable row level security;
alter table private.contact_rate_limits enable row level security;

create function private.active_user() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := auth.uid(); session_text text := auth.jwt()->>'session_id';
begin
  if actor is null or session_text is null or not exists(select 1 from auth.sessions s where s.id::text = session_text and s.user_id = actor) then
    raise exception using errcode='42501', message='Your session ended. Sign in again.';
  end if;
  return actor;
end $$;
create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin')
$$;
create function private.require_admin() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := private.active_user();
begin
  if not private.is_admin() then raise exception using errcode='42501', message='Administrator access is required.'; end if;
  return actor;
end $$;
create function private.can_read_submission(p_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from public.submissions s where s.id = p_id and (s.owner_id = auth.uid() or (s.status <> 'draft' and private.is_admin())))
$$;
create policy profiles_self_or_relevant_admin on public.profiles for select to authenticated using (
  id = (select auth.uid()) or ((select private.is_admin()) and exists(select 1 from public.submissions s where s.owner_id = id and s.status <> 'draft'))
);
create policy roles_self on public.user_roles for select to authenticated using (user_id = (select auth.uid()));
create policy submissions_owner_or_queue_admin on public.submissions for select to authenticated using (owner_id = (select auth.uid()) or (status <> 'draft' and (select private.is_admin())));
create policy files_authorized on public.submission_files for select to authenticated using (private.can_read_submission(submission_id));
create policy events_authorized on public.submission_events for select to authenticated using (private.can_read_submission(submission_id));
create policy articles_public on public.articles for select to anon,authenticated using (true);
create policy notifications_self on public.notifications for select to authenticated using (recipient_id = (select auth.uid()));
create policy notes_admin on public.admin_notes for select to authenticated using ((select private.is_admin()) and private.can_read_submission(submission_id));
create policy contact_admin on public.contact_messages for select to authenticated using ((select private.is_admin()));

revoke all on public.profiles,public.user_roles,public.submissions,public.submission_files,public.submission_events,public.articles,public.notifications,public.admin_notes,public.contact_messages from anon,authenticated;
grant select on public.profiles,public.user_roles,public.submissions,public.submission_files,public.submission_events,public.notifications,public.admin_notes,public.contact_messages to authenticated;
grant select on public.articles to anon,authenticated;
grant all on public.profiles,public.user_roles,public.submissions,public.submission_files,public.submission_events,public.articles,public.notifications,public.admin_notes,public.contact_messages to service_role;
revoke all on all tables in schema private from public,anon,authenticated;
grant all on all tables in schema private to service_role;

create function private.on_auth_user_created() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Metadata supplies display names only. All role claims are deliberately ignored.
  insert into public.profiles(id,first_name,last_name,affiliation) values(new.id,
    coalesce(nullif(left(btrim(new.raw_user_meta_data->>'first_name'),80),''),'Author'),
    coalesce(nullif(left(btrim(new.raw_user_meta_data->>'last_name'),80),''),'Account'),
    coalesce(left(btrim(new.raw_user_meta_data->>'affiliation'),200),''));
  insert into public.user_roles(user_id,role) values(new.id,'author');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.on_auth_user_created();
-- Existing identities get authorship only; no identity is implicitly promoted.
insert into public.profiles(id,first_name,last_name,affiliation)
select id,coalesce(nullif(left(btrim(raw_user_meta_data->>'first_name'),80),''),'Author'),coalesce(nullif(left(btrim(raw_user_meta_data->>'last_name'),80),''),'Account'),coalesce(left(btrim(raw_user_meta_data->>'affiliation'),200),'') from auth.users on conflict(id) do nothing;
insert into public.user_roles(user_id,role) select id,'author' from auth.users on conflict(user_id) do nothing;

create function private.submission_result(p_id uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(s) || jsonb_build_object('article_slug',(select a.slug from private.article_sources x join public.articles a on a.id=x.article_id where x.submission_id=s.id)) from public.submissions s where s.id=p_id
$$;
create function private.save_draft(p_id uuid,p_expected_version integer,p_title text,p_abstract text,p_author_names text,p_category text,p_keywords text[],p_publication_consent boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.active_user(); item public.submissions;
begin
  if p_id is null then
    insert into public.submissions(owner_id,title,abstract,author_names,category,keywords,publication_consent)
    values(actor,btrim(p_title),btrim(p_abstract),btrim(p_author_names),btrim(p_category),p_keywords,p_publication_consent) returning * into item;
  else
    select * into item from public.submissions where id=p_id for update;
    if not found or item.owner_id <> actor then raise exception using errcode='42501',message='Draft is not available.'; end if;
    if item.status <> 'draft' or item.version is distinct from p_expected_version then raise exception using errcode='40001',message='Submission changed. Reload before saving.'; end if;
    update public.submissions set title=btrim(p_title),abstract=btrim(p_abstract),author_names=btrim(p_author_names),category=btrim(p_category),keywords=p_keywords,publication_consent=p_publication_consent,version=version+1,updated_at=now() where id=p_id returning * into item;
  end if;
  return private.submission_result(item.id);
end $$;

create function private.validate_ready(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare item public.submissions; asset public.submission_files;
begin
  select * into item from public.submissions where id=p_id;
  select * into asset from public.submission_files where id=item.current_file_id and submission_id=item.id;
  if char_length(btrim(item.title)) < 5 or char_length(btrim(item.abstract)) < 30 or char_length(btrim(item.author_names)) < 2 or char_length(btrim(item.category)) < 2 or not item.publication_consent then
    raise exception using errcode='22023',message='Complete the publication fields and permission confirmation first.';
  end if;
  if asset.id is null or asset.verification_state <> 'verified' or not exists(select 1 from storage.objects o where o.bucket_id='manuscripts' and o.name=asset.storage_path) then
    raise exception using errcode='22023',message='A verified manuscript is required.';
  end if;
end $$;

create function private.transition(p_id uuid,p_expected_version integer,p_action text,p_feedback text default '') returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.active_user(); item public.submissions; asset public.submission_files;
  next_status public.submission_status; event_id uuid; article_id uuid; article_slug text; kind text;
begin
  if p_action not in ('submit','review','publish','reject','admin_publish') then raise exception using errcode='22023',message='Unknown workflow action.'; end if;
  if p_action <> 'submit' then perform private.require_admin(); end if;
  if p_feedback is null or char_length(p_feedback) > 4000 then raise exception using errcode='22023',message='Feedback must be at most 4000 characters.'; end if;
  select * into item from public.submissions where id=p_id for update;
  if not found then raise exception using errcode='P0002',message='Submission not found.'; end if;
  if p_action='submit' and item.owner_id <> actor then raise exception using errcode='42501',message='Only the author can submit this draft.'; end if;
  if p_action='admin_publish' and item.owner_id <> actor then raise exception using errcode='42501',message='Only your own publication draft can be published directly.'; end if;
  -- Same completed command is idempotent, even with the original optimistic version.
  if (p_action in ('publish','admin_publish') and item.status='published') or (p_action='reject' and item.status='rejected') or
     (p_action='review' and item.status='under_review') or (p_action='submit' and item.status='submitted') then return private.submission_result(p_id); end if;
  if item.version is distinct from p_expected_version then raise exception using errcode='40001',message='Submission changed. Reload to see its current decision.'; end if;
  if (p_action='submit' and item.status <> 'draft') or (p_action='review' and item.status <> 'submitted') or
     (p_action in ('publish','reject') and item.status not in ('submitted','under_review')) or (p_action='admin_publish' and item.status <> 'draft') then
    raise exception using errcode='40001',message='This action is no longer available for the current status.';
  end if;
  if p_action='reject' and char_length(btrim(p_feedback)) < 3 then raise exception using errcode='22023',message='A rejection reason is required (at least 3 characters).'; end if;
  if p_action in ('submit','publish','admin_publish') then perform private.validate_ready(p_id); end if;
  next_status := case p_action when 'submit' then 'submitted'::public.submission_status when 'review' then 'under_review'::public.submission_status when 'reject' then 'rejected'::public.submission_status else 'published'::public.submission_status end;
  kind := case p_action when 'submit' then 'submitted' when 'review' then 'review_started' when 'reject' then 'rejected' else 'published' end;
  if next_status='published' then
    select * into asset from public.submission_files where id=item.current_file_id;
    article_id := gen_random_uuid();
    article_slug := coalesce(nullif(left(trim(both '-' from regexp_replace(lower(item.title),'[^a-z0-9]+','-','g')),100),''),'article') || '-' || replace(article_id::text,'-','');
    insert into public.articles(id,slug,title,abstract,author_names,category,keywords,download_filename,download_media_type)
    values(article_id,article_slug,item.title,item.abstract,item.author_names,item.category,item.keywords,asset.original_name,asset.media_type);
    insert into private.article_sources(article_id,submission_id,file_id,published_by) values(article_id,p_id,asset.id,actor);
    insert into public.submission_events(submission_id,kind,from_status,to_status,feedback) values(p_id,'accepted',item.status,'published',btrim(p_feedback));
  end if;
  update public.submissions set status=next_status,version=version+1,updated_at=now(),submitted_at=case when p_action='submit' then now() else submitted_at end where id=p_id;
  insert into public.submission_events(submission_id,kind,from_status,to_status,feedback) values(p_id,kind,item.status,next_status,btrim(p_feedback)) returning id into event_id;
  insert into public.notifications(recipient_id,submission_id,event_id,message) values(item.owner_id,p_id,event_id,
    case next_status when 'submitted' then 'Your manuscript was submitted for review.' when 'under_review' then 'Review has started for your manuscript.' when 'published' then 'Your manuscript has been approved and published.' else 'A decision is available: your manuscript was rejected. Open it to read the feedback.' end);
  return private.submission_result(p_id);
end $$;

create function private.prepare_file(p_submission_id uuid,p_expected_version integer,p_original_name text,p_media_type text,p_byte_size bigint) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.active_user(); item public.submissions; asset public.submission_files; extension text; file_id uuid := gen_random_uuid();
begin
  select * into item from public.submissions where id=p_submission_id for update;
  if not found or item.owner_id <> actor then raise exception using errcode='42501',message='Draft is not available.'; end if;
  if item.status <> 'draft' or item.version is distinct from p_expected_version then raise exception using errcode='40001',message='Draft changed. Reload before uploading.'; end if;
  if (select count(*) from public.submission_files where submission_id=item.id and verification_state='pending') >= 5 then raise exception using errcode='22023',message='Too many incomplete uploads. Clean up old uploads and retry.'; end if;
  extension := lower(substring(p_original_name from '\.([^.]+)$'));
  if extension is null or p_original_name ~ '[[:cntrl:]/\\]' or
    not ((extension='pdf' and p_media_type='application/pdf') or (extension='doc' and p_media_type='application/msword') or (extension='docx' and p_media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document')) then
    raise exception using errcode='22023',message='File extension and media type must match PDF, DOC or DOCX.';
  end if;
  insert into public.submission_files(id,submission_id,storage_path,original_name,media_type,byte_size,version)
  values(file_id,item.id,actor::text||'/'||item.id::text||'/'||file_id::text||'.'||extension,p_original_name,p_media_type,p_byte_size,
    coalesce((select max(version)+1 from public.submission_files where submission_id=item.id),1)) returning * into asset;
  return to_jsonb(asset);
end $$;

create function private.finalize_file(p_file_id uuid,p_sha256 text,p_byte_size bigint,p_media_type text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare asset public.submission_files; item public.submissions;
begin
  select * into asset from public.submission_files where id=p_file_id;
  if not found then raise exception using errcode='P0002',message='File not found.'; end if;
  select * into item from public.submissions where id=asset.submission_id for update;
  select * into asset from public.submission_files where id=p_file_id for update;
  if asset.verification_state='verified' then return private.submission_result(item.id); end if;
  if item.status <> 'draft' or asset.verification_state <> 'pending' then raise exception using errcode='40001',message='This file cannot be attached now. Reload the submission.'; end if;
  if asset.byte_size <> p_byte_size or asset.media_type <> p_media_type or not exists(select 1 from storage.objects o where o.bucket_id='manuscripts' and o.name=asset.storage_path) then raise exception using errcode='22023',message='Uploaded file does not match its reservation.'; end if;
  update public.submission_files set verification_state='verified',sha256=p_sha256,verified_at=now() where id=p_file_id;
  update public.submissions set current_file_id=p_file_id,version=version+1,updated_at=now() where id=item.id;
  return private.submission_result(item.id);
end $$;

create function private.claim_cleanup(p_submission_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.active_user(); item public.submissions; result jsonb;
begin
  select * into item from public.submissions where id=p_submission_id for update;
  if not found or item.owner_id <> actor or item.status <> 'draft' then raise exception using errcode='42501',message='Only unused files in your own draft can be cleaned up.'; end if;
  -- Signed upload URLs expire after two hours. Waiting three hours prevents reuse
  -- of a still-valid token after deletion. Never remove a current/reviewed asset.
  with claimed as (update public.submission_files set verification_state='deleting'
    where submission_id=item.id and id is distinct from item.current_file_id and created_at < now()-interval '3 hours'
      and not exists(select 1 from private.article_sources x where x.file_id=public.submission_files.id)
    returning id,storage_path)
  select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
  return result;
end $$;

create function private.update_profile(p_first_name text,p_last_name text,p_affiliation text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.active_user(); result public.profiles;
begin
  update public.profiles set first_name=btrim(p_first_name),last_name=btrim(p_last_name),affiliation=btrim(p_affiliation),updated_at=now() where id=actor returning * into result;
  if not found then raise exception using errcode='P0002',message='Profile is missing. Contact support.'; end if;
  return to_jsonb(result);
end $$;
create function private.mark_notification_read(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin update public.notifications set read_at=coalesce(read_at,now()) where id=p_id and recipient_id=private.active_user(); end $$;
create function private.add_admin_note(p_submission_id uuid,p_note text) returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_admin();
begin
  if not private.can_read_submission(p_submission_id) then raise exception using errcode='42501',message='Submission is not available.'; end if;
  insert into public.admin_notes(submission_id,actor_id,note) values(p_submission_id,actor,btrim(p_note));
end $$;
create function private.handle_contact_message(p_id uuid,p_state text) returns void language plpgsql security definer set search_path = '' as $$
begin perform private.require_admin(); update public.contact_messages set state=p_state,handled_at=case when p_state='handled' then now() else null end where id=p_id; end $$;

create function private.receive_contact(p_name text,p_email text,p_message text,p_ip_hash text,p_email_hash text) returns uuid language plpgsql security definer set search_path = '' as $$
declare current_window timestamptz := date_trunc('hour',now()); quota integer; result uuid; key_value text;
begin
  if p_ip_hash !~ '^[a-f0-9]{64}$' or p_email_hash !~ '^[a-f0-9]{64}$' then raise exception using errcode='22023',message='Missing rate-limit identity.'; end if;
  -- Ordered row locks make the two limits atomic and avoid deadlocks.
  for key_value in select k from unnest(array['ip:'||p_ip_hash,'email:'||p_email_hash]) k order by k loop
    insert into private.contact_rate_limits(key,window_start,count) values(key_value,current_window,1)
    on conflict(key,window_start) do update set count=private.contact_rate_limits.count+1 returning count into quota;
    if quota > 5 then raise exception using errcode='P0001',message='Too many messages. Please try again in an hour.'; end if;
  end loop;
  insert into public.contact_messages(name,email,message) values(btrim(p_name),lower(btrim(p_email)),btrim(p_message)) returning id into result;
  delete from private.contact_rate_limits where private.contact_rate_limits.window_start < now()-interval '48 hours';
  return result;
end $$;

-- All exposed RPCs are invokers; privileged bodies are kept outside the Data API.
create function public.assert_active_session() returns uuid language sql stable security invoker set search_path='' as $$ select private.active_user() $$;
create function public.my_role() returns text language sql stable security invoker set search_path='' as $$ select role::text from public.user_roles where user_id=private.active_user() $$;
create function public.get_submission(p_submission_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin perform private.active_user(); if not private.can_read_submission(p_submission_id) then raise exception using errcode='42501',message='Submission is not available.'; end if; return private.submission_result(p_submission_id); end $$;
create function public.submission_article_slug(p_submission_id uuid) returns text language sql stable security invoker set search_path='' as $$ select public.get_submission(p_submission_id)->>'article_slug' $$;
create function public.save_draft(p_id uuid,p_expected_version integer,p_title text,p_abstract text,p_author_names text,p_category text,p_keywords text[],p_publication_consent boolean) returns jsonb language sql security invoker set search_path='' as $$ select private.save_draft(p_id,p_expected_version,p_title,p_abstract,p_author_names,p_category,p_keywords,p_publication_consent) $$;
create function public.submit_submission(p_submission_id uuid,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$ select private.transition(p_submission_id,p_expected_version,'submit') $$;
create function public.start_review(p_submission_id uuid,p_expected_version integer) returns jsonb language sql security invoker set search_path='' as $$ select private.transition(p_submission_id,p_expected_version,'review') $$;
create function public.accept_and_publish(p_submission_id uuid,p_expected_version integer,p_feedback text default '') returns jsonb language sql security invoker set search_path='' as $$ select private.transition(p_submission_id,p_expected_version,'publish',p_feedback) $$;
create function public.reject_submission(p_submission_id uuid,p_expected_version integer,p_feedback text) returns jsonb language sql security invoker set search_path='' as $$ select private.transition(p_submission_id,p_expected_version,'reject',p_feedback) $$;
create function public.publish_admin_article(p_submission_id uuid,p_expected_version integer,p_feedback text default '') returns jsonb language sql security invoker set search_path='' as $$ select private.transition(p_submission_id,p_expected_version,'admin_publish',p_feedback) $$;
create function public.prepare_file(p_submission_id uuid,p_expected_version integer,p_original_name text,p_media_type text,p_byte_size bigint) returns jsonb language sql security invoker set search_path='' as $$ select private.prepare_file(p_submission_id,p_expected_version,p_original_name,p_media_type,p_byte_size) $$;
create function public.claim_cleanup(p_submission_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.claim_cleanup(p_submission_id) $$;
create function public.update_profile(p_first_name text,p_last_name text,p_affiliation text) returns jsonb language sql security invoker set search_path='' as $$ select private.update_profile(p_first_name,p_last_name,p_affiliation) $$;
create function public.mark_notification_read(p_id uuid) returns void language sql security invoker set search_path='' as $$ select private.mark_notification_read(p_id) $$;
create function public.add_admin_note(p_submission_id uuid,p_note text) returns void language sql security invoker set search_path='' as $$ select private.add_admin_note(p_submission_id,p_note) $$;
create function public.handle_contact_message(p_id uuid,p_state text) returns void language sql security invoker set search_path='' as $$ select private.handle_contact_message(p_id,p_state) $$;
create function public.finalize_file(p_file_id uuid,p_sha256 text,p_byte_size bigint,p_media_type text) returns jsonb language sql security invoker set search_path='' as $$ select private.finalize_file(p_file_id,p_sha256,p_byte_size,p_media_type) $$;
create function public.receive_contact(p_name text,p_email text,p_message text,p_ip_hash text,p_email_hash text) returns uuid language sql security invoker set search_path='' as $$ select private.receive_contact(p_name,p_email,p_message,p_ip_hash,p_email_hash) $$;
create function public.resolve_public_asset(p_slug text) returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('storage_path',f.storage_path,'original_name',f.original_name,'media_type',f.media_type)
  from public.articles a join private.article_sources x on x.article_id=a.id join public.submission_files f on f.id=x.file_id
  join public.submissions s on s.id=x.submission_id where a.slug=p_slug and s.status='published' and f.verification_state='verified'
$$;

-- Revoke PostgreSQL's default EXECUTE from every application function, then
-- grant only the deliberate entry points. This never alters unrelated functions.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' or (n.nspname='public' and p.proname in ('assert_active_session','my_role','get_submission','submission_article_slug','save_draft','submit_submission','start_review','accept_and_publish','reject_submission','publish_admin_article','prepare_file','claim_cleanup','update_profile','mark_notification_read','add_admin_note','handle_contact_message','finalize_file','receive_contact','resolve_public_asset'))
  loop execute format('revoke all on function %s from public,anon,authenticated',f.signature); end loop;
end $$;
grant execute on function private.active_user(),private.is_admin(),private.can_read_submission(uuid),private.save_draft(uuid,integer,text,text,text,text,text[],boolean),private.transition(uuid,integer,text,text),private.prepare_file(uuid,integer,text,text,bigint),private.claim_cleanup(uuid),private.update_profile(text,text,text),private.mark_notification_read(uuid),private.add_admin_note(uuid,text),private.handle_contact_message(uuid,text) to authenticated;
-- A result helper must authorize too because invoker wrappers need EXECUTE.
create or replace function private.submission_result(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if current_setting('request.jwt.claims',true)::jsonb->>'role' is distinct from 'service_role' and not private.can_read_submission(p_id) then raise exception using errcode='42501',message='Submission is not available.'; end if;
  return (select to_jsonb(s)||jsonb_build_object('article_slug',(select a.slug from private.article_sources x join public.articles a on a.id=x.article_id where x.submission_id=s.id)) from public.submissions s where s.id=p_id);
end $$;
grant execute on function private.submission_result(uuid) to authenticated,service_role;
grant execute on function public.submission_article_slug(uuid) to authenticated;
grant execute on function public.assert_active_session(),public.my_role(),public.get_submission(uuid),public.save_draft(uuid,integer,text,text,text,text,text[],boolean),public.submit_submission(uuid,integer),public.start_review(uuid,integer),public.accept_and_publish(uuid,integer,text),public.reject_submission(uuid,integer,text),public.publish_admin_article(uuid,integer,text),public.prepare_file(uuid,integer,text,text,bigint),public.claim_cleanup(uuid),public.update_profile(text,text,text),public.mark_notification_read(uuid),public.add_admin_note(uuid,text),public.handle_contact_message(uuid,text) to authenticated;
grant execute on function private.finalize_file(uuid,text,bigint,text),private.receive_contact(text,text,text,text,text),public.finalize_file(uuid,text,bigint,text),public.receive_contact(text,text,text,text,text),public.resolve_public_asset(text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('manuscripts','manuscripts',false,20971520,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
('resources','resources',true,5242880,array['application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/x-tex','text/plain'])
on conflict(id) do nothing;
-- Restrictive policies preserve denial even if another bucket has broad permissive
-- policies. Only the service-only Edge resolver issues download/upload URLs.
create policy manuscripts_no_direct_select on storage.objects as restrictive for select to anon,authenticated using (bucket_id <> 'manuscripts');
create policy manuscripts_no_direct_insert on storage.objects as restrictive for insert to anon,authenticated with check (bucket_id <> 'manuscripts');
create policy manuscripts_no_direct_update on storage.objects as restrictive for update to anon,authenticated using (bucket_id <> 'manuscripts') with check (bucket_id <> 'manuscripts');
create policy manuscripts_no_direct_delete on storage.objects as restrictive for delete to anon,authenticated using (bucket_id <> 'manuscripts');
create policy resources_no_client_insert on storage.objects as restrictive for insert to anon,authenticated with check (bucket_id <> 'resources');
create policy resources_no_client_update on storage.objects as restrictive for update to anon,authenticated using (bucket_id <> 'resources') with check (bucket_id <> 'resources');
create policy resources_no_client_delete on storage.objects as restrictive for delete to anon,authenticated using (bucket_id <> 'resources');

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.submissions,public.notifications,public.articles,public.contact_messages;
  end if;
end $$;
