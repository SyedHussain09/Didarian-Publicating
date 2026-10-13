-- Preserve existing identities/publications. Authorization stays in user_roles,
-- never in user-editable OAuth metadata. Public functions delegate to checked,
-- narrowly granted helpers in the unexposed private schema.
alter table public.profiles add column full_name text not null default '';
alter table public.profiles add column username text;
alter table public.profiles add column profile_complete boolean not null default false;
update public.profiles set full_name=btrim(first_name||' '||last_name),profile_complete=true;
alter table public.profiles add constraint profiles_full_name_length check(char_length(full_name)<=160);
alter table public.profiles add constraint profiles_username_format check(username is null or username ~ '^[a-z][a-z0-9_]{2,29}$');
create unique index profiles_username_unique on public.profiles(username) where username is not null;
alter table public.profiles drop constraint profiles_last_name_check;
alter table public.profiles add constraint profiles_last_name_check check(char_length(last_name)<=80);

alter table public.submissions add column contributors jsonb not null default '[]'::jsonb check(jsonb_typeof(contributors)='array' and jsonb_array_length(contributors)<=20);
alter table public.submissions drop constraint submissions_author_names_check;
alter table public.submissions add constraint submissions_author_names_check check(char_length(author_names)<=4000);
alter table public.articles add column contributors jsonb not null default '[]'::jsonb check(jsonb_typeof(contributors)='array');
alter table public.articles add column deleted_at timestamptz;
alter table public.articles drop constraint articles_author_names_check;
alter table public.articles add constraint articles_author_names_check check(char_length(author_names) between 2 and 4000);
drop policy articles_public on public.articles;
create policy articles_public on public.articles for select to anon,authenticated using(deleted_at is null);
create index articles_visible_published_idx on public.articles(published_at desc,id) where deleted_at is null;

create table public.article_comments(
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  username text not null,
  body text not null check(char_length(btrim(body)) between 1 and 4000),
  version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index article_comments_page_idx on public.article_comments(article_id,created_at desc,id);
create index article_comments_reviewer_idx on public.article_comments(reviewer_id,created_at desc);
create table public.article_likes(
  article_id uuid not null references public.articles(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),
  primary key(article_id,reviewer_id)
);
create index article_likes_reviewer_idx on public.article_likes(reviewer_id,created_at desc);
create table public.article_saves(
  article_id uuid not null references public.articles(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),created_at timestamptz not null default now(),
  primary key(article_id,reviewer_id)
);
create index article_saves_reviewer_idx on public.article_saves(reviewer_id,created_at desc);
create table private.moderation_log(
  id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),
  article_id uuid not null references public.articles(id),action text not null,
  reason text not null check(char_length(reason) between 3 and 500),created_at timestamptz not null default now()
);
create index moderation_log_article_idx on private.moderation_log(article_id,created_at desc);
create index moderation_log_actor_idx on private.moderation_log(actor_id);
alter table public.article_comments enable row level security;
alter table public.article_likes enable row level security;
alter table public.article_saves enable row level security;
alter table private.moderation_log enable row level security;
create policy comments_visible_articles on public.article_comments for select to anon,authenticated using(exists(select 1 from public.articles a where a.id=article_id));
create policy likes_self on public.article_likes for select to authenticated using(reviewer_id=(select auth.uid()));
create policy saves_self on public.article_saves for select to authenticated using(reviewer_id=(select auth.uid()));
revoke all on public.article_comments,public.article_likes,public.article_saves from public,anon,authenticated;
grant select on public.article_comments to anon,authenticated;
grant select on public.article_likes,public.article_saves to authenticated;
grant all on public.article_comments,public.article_likes,public.article_saves to service_role;
revoke all on private.moderation_log from public,anon,authenticated;
grant all on private.moderation_log to service_role;

alter table public.notifications alter column event_id drop not null;
alter table public.notifications add column article_id uuid references public.articles(id);
alter table public.notifications add column comment_id uuid references public.article_comments(id) on delete cascade;
alter table public.notifications add column actor_id uuid references public.profiles(id);
alter table public.notifications add column kind text not null default 'workflow';
create unique index notifications_reaction_unique on public.notifications(article_id,actor_id,kind) where kind in ('like','save');
create index notifications_comment_idx on public.notifications(comment_id) where comment_id is not null;
create index notifications_article_idx on public.notifications(article_id) where article_id is not null;
create index notifications_actor_idx on public.notifications(actor_id) where actor_id is not null;

create function private.complete_profile(p_role text,p_full_name text,p_affiliation text,p_username text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.active_user(); profile public.profiles; current_role text; handle text:=lower(btrim(coalesce(p_username,'')));
begin
  select * into profile from public.profiles where id=actor for update;
  select role::text into current_role from public.user_roles where user_id=actor;
  if p_role is null or p_role not in ('author','reviewer') then raise exception using errcode='22023',message='Choose Admin Author or Reviewer.'; end if;
  if profile.profile_complete and current_role<>p_role then raise exception using errcode='42501',message='Your account type is already set. Contact the administrator to change it.'; end if;
  if p_full_name is null or char_length(btrim(p_full_name)) not between 2 and 160 or p_affiliation is null or char_length(btrim(p_affiliation))>200 then raise exception using errcode='22023',message='Enter a valid name and institution.'; end if;
  if p_role='author' and char_length(btrim(p_affiliation))<2 then raise exception using errcode='22023',message='Institute / Organization Name is required.'; end if;
  if p_role='reviewer' and handle !~ '^[a-z][a-z0-9_]{2,29}$' then raise exception using errcode='22023',message='Use 3–30 characters for your username: letters, numbers and underscores, starting with a letter.'; end if;
  if profile.username is not null and profile.username<>handle then raise exception using errcode='22023',message='Your public username cannot be changed.'; end if;
  if not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null and email is not null) then raise exception using errcode='42501',message='Sign in with a verified email account first.'; end if;
  update public.profiles set full_name=btrim(p_full_name),first_name=left(split_part(btrim(p_full_name),' ',1),80),
    last_name=left(btrim(substr(btrim(p_full_name),length(split_part(btrim(p_full_name),' ',1))+1)),80),
    affiliation=btrim(p_affiliation),username=case when p_role='reviewer' then handle else null end,profile_complete=true,updated_at=now()
    where id=actor returning * into profile;
  if not profile.profile_complete then raise exception 'Profile could not be saved.'; end if;
  update public.user_roles set role=p_role::public.app_role where user_id=actor;
  return to_jsonb(profile);
exception when unique_violation then raise exception using errcode='PT409',message='That username is already taken. Choose another one.';
end $$;

create function private.check_submission_owner() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.user_roles r join public.profiles p on p.id=r.user_id where r.user_id=new.owner_id and r.role in ('author','admin') and p.profile_complete) then
    raise exception using errcode='42501',message='Complete an Admin Author profile before creating a manuscript.';
  end if;
  return new;
end $$;
create trigger submission_account_check before insert on public.submissions for each row execute function private.check_submission_owner();

create function private.save_draft_with_contributors(p_id uuid,p_expected_version integer,p_title text,p_abstract text,p_category text,p_keywords text[],p_publication_consent boolean,p_contributors jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.active_user(); person jsonb; cleaned jsonb:='[]'; names text; result jsonb; item_id uuid; n integer;
begin
  if not exists(select 1 from public.user_roles r join public.profiles p on p.id=r.user_id where r.user_id=actor and r.role in ('author','admin') and p.profile_complete) then raise exception using errcode='42501',message='Admin Author access is required.'; end if;
  if p_contributors is null or jsonb_typeof(p_contributors)<>'array' then raise exception using errcode='22023',message='Add the manuscript authors.'; end if;
  n:=jsonb_array_length(p_contributors);
  if n not between 1 and 20 then raise exception using errcode='22023',message='Add between 1 and 20 manuscript authors.'; end if;
  for person in select value from jsonb_array_elements(p_contributors) loop
    if jsonb_typeof(person)<>'object' or person->>'name' is null or char_length(btrim(person->>'name')) not between 2 and 160 or
      person->>'institution' is null or char_length(btrim(person->>'institution')) not between 2 and 200 or
      person->>'email' is null or char_length(person->>'email')>254 or btrim(person->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception using errcode='22023',message='Each author needs a name, institution and valid email address.';
    end if;
    if exists(select 1 from jsonb_array_elements(cleaned) c where c->>'email'=lower(btrim(person->>'email'))) then raise exception using errcode='22023',message='Use a different email address for each author.'; end if;
    cleaned:=cleaned||jsonb_build_array(jsonb_build_object('name',btrim(person->>'name'),'institution',btrim(person->>'institution'),'email',lower(btrim(person->>'email'))));
  end loop;
  select string_agg(value->>'name',', ' order by ordinal) into names from jsonb_array_elements(cleaned) with ordinality p(value,ordinal);
  result:=private.save_draft(p_id,p_expected_version,p_title,p_abstract,names,p_category,p_keywords,p_publication_consent);
  item_id:=(result->>'id')::uuid;
  update public.submissions set contributors=cleaned where id=item_id;
  return private.submission_result(item_id);
end $$;

create function private.copy_public_contributors() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.articles set contributors=coalesce((select jsonb_agg(jsonb_build_object('name',c.value->>'name','institution',c.value->>'institution') order by c.ordinal)
    from public.submissions s cross join lateral jsonb_array_elements(s.contributors) with ordinality c(value,ordinal) where s.id=new.submission_id),'[]'::jsonb) where id=new.article_id;
  return new;
end $$;
create trigger publication_contributors after insert on private.article_sources for each row execute function private.copy_public_contributors();

create function private.article_activity(p_article_id uuid,p_page integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
  if p_page is null or p_page<0 or p_page>100000 then raise exception using errcode='22023',message='Invalid comments page.'; end if;
  if not exists(select 1 from public.articles where id=p_article_id and deleted_at is null) then raise exception using errcode='P0002',message='This article is not available.'; end if;
  select jsonb_build_object('like_count',(select count(*) from public.article_likes where article_id=p_article_id),
    'comment_count',(select count(*) from public.article_comments where article_id=p_article_id),
    'liked',exists(select 1 from public.article_likes where article_id=p_article_id and reviewer_id=actor),
    'saved',exists(select 1 from public.article_saves where article_id=p_article_id and reviewer_id=actor),
    'comments',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc,c.id) from (select * from public.article_comments where article_id=p_article_id order by created_at desc,id limit 5 offset p_page*5) c),'[]'::jsonb)) into result;
  return result;
end $$;

create function private.write_article_activity(p_article_id uuid,p_action text,p_comment_id uuid,p_body text,p_enabled boolean,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.active_user(); profile public.profiles; item public.articles; comment public.article_comments; source private.article_sources;
  recipient uuid; changed integer:=0; notice_kind text; notice_message text; new_comment uuid;
begin
  -- A per-account row lock serializes rate limits, duplicate clicks and reactions.
  select * into profile from public.profiles where id=actor for update;
  if not exists(select 1 from public.user_roles where user_id=actor and role='reviewer') then
    if p_action<>'delete_comment' or not private.is_admin() then raise exception using errcode='42501',message='Sign in as a Reviewer to comment, like or save.'; end if;
  elsif not profile.profile_complete or profile.username is null then raise exception using errcode='42501',message='Complete your Reviewer profile first.'; end if;
  select * into item from public.articles where id=p_article_id for share;
  if not found or (item.deleted_at is not null and p_action not in ('delete_comment','like','save')) then raise exception using errcode='P0002',message='This article is not available.'; end if;
  if item.deleted_at is not null and p_action in ('like','save') and p_enabled is distinct from false then raise exception using errcode='P0002',message='This article is not available.'; end if;
  if p_action in ('comment','edit_comment') and (p_body is null or char_length(btrim(p_body)) not between 1 and 4000) then raise exception using errcode='22023',message='Write a comment between 1 and 4000 characters.'; end if;
  if p_action='comment' then
    if (select count(*) from public.article_comments where reviewer_id=actor and created_at>now()-interval '1 minute')>=5 then raise exception using errcode='PT429',message='Please wait a minute before posting another comment.'; end if;
    insert into public.article_comments(article_id,reviewer_id,username,body) values(p_article_id,actor,profile.username,btrim(p_body)) returning id into new_comment;
    notice_kind:='comment'; notice_message:='@'||profile.username||' commented on “'||left(item.title,180)||'”.'; changed:=1;
  elsif p_action in ('edit_comment','delete_comment') then
    select * into comment from public.article_comments where id=p_comment_id and article_id=p_article_id for update;
    if not found then raise exception using errcode='P0002',message='This comment no longer exists.'; end if;
    if comment.reviewer_id<>actor and not(p_action='delete_comment' and private.is_admin()) then raise exception using errcode='42501',message='You can only change your own comments.'; end if;
    if comment.version is distinct from p_expected_version then raise exception using errcode='PT409',message='This comment changed. Refresh before trying again.'; end if;
    if p_action='edit_comment' then update public.article_comments set body=btrim(p_body),updated_at=now(),version=version+1 where id=p_comment_id;
    else
      if private.is_admin() then insert into private.moderation_log(actor_id,article_id,action,reason) values(actor,p_article_id,'delete_comment','Administrator removed a comment'); end if;
      delete from public.article_comments where id=p_comment_id;
    end if;
  elsif p_action in ('like','save') then
    if p_enabled is null then raise exception using errcode='22023',message='Choose an explicit reaction state.'; end if;
    if p_action='like' then
      if p_enabled then insert into public.article_likes(article_id,reviewer_id) values(p_article_id,actor) on conflict do nothing;
      else delete from public.article_likes where article_id=p_article_id and reviewer_id=actor; end if;
    else
      if p_enabled then insert into public.article_saves(article_id,reviewer_id) values(p_article_id,actor) on conflict do nothing;
      else delete from public.article_saves where article_id=p_article_id and reviewer_id=actor; end if;
    end if;
    get diagnostics changed=row_count;
    if p_enabled then
      notice_kind:=p_action;
      notice_message:=case when p_action='like' then '@'||profile.username||' liked “'||left(item.title,180)||'”.' else 'A reviewer saved “'||left(item.title,180)||'” to their reading list.' end;
    end if;
  else raise exception using errcode='22023',message='Unknown article action.'; end if;
  if changed>0 and notice_kind is not null then
    select * into source from private.article_sources where article_id=p_article_id;
    select owner_id into recipient from public.submissions where id=source.submission_id;
    if recipient is not null and recipient<>actor then
      insert into public.notifications(recipient_id,submission_id,article_id,comment_id,actor_id,kind,message)
      values(recipient,source.submission_id,p_article_id,new_comment,actor,notice_kind,notice_message) on conflict do nothing;
    end if;
  end if;
  return jsonb_build_object('ok',true,'comment_id',new_comment);
end $$;

create function private.my_reading_list(p_kind text,p_page integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=private.active_user(); result jsonb;
begin
  if not exists(select 1 from public.user_roles where user_id=actor and role='reviewer') then raise exception using errcode='42501',message='Reviewer access is required.'; end if;
  if p_kind is null or p_kind not in ('saved','liked','comments') or p_page is null or p_page<0 or p_page>100000 then raise exception using errcode='22023',message='Invalid reading-list request.'; end if;
  with items as (
    select a.id,a.slug,a.title,a.category,a.author_names,a.deleted_at,r.created_at,null::uuid as comment_id,null::text as body,null::integer as version from public.article_saves r join public.articles a on a.id=r.article_id where r.reviewer_id=actor and p_kind='saved'
    union all select a.id,a.slug,a.title,a.category,a.author_names,a.deleted_at,r.created_at,null::uuid,null::text,null::integer from public.article_likes r join public.articles a on a.id=r.article_id where r.reviewer_id=actor and p_kind='liked'
    union all select a.id,a.slug,a.title,a.category,a.author_names,a.deleted_at,r.created_at,r.id,r.body,r.version from public.article_comments r join public.articles a on a.id=r.article_id where r.reviewer_id=actor and p_kind='comments'
  ) select jsonb_build_object('count',(select count(*) from items),'rows',coalesce((select jsonb_agg(to_jsonb(page) order by page.created_at desc,page.id) from (select * from items order by created_at desc,id limit 5 offset p_page*5) page),'[]'::jsonb)) into result;
  return result;
end $$;

create function private.moderate_article(p_article_id uuid,p_removed boolean,p_reason text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_admin(); item public.articles; source private.article_sources; recipient uuid;
begin
  if p_removed is null or p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then raise exception using errcode='22023',message='Provide a moderation reason between 3 and 500 characters.'; end if;
  select * into item from public.articles where id=p_article_id for update;
  if not found then raise exception using errcode='P0002',message='Article not found.'; end if;
  if (item.deleted_at is not null)=p_removed then return; end if;
  update public.articles set deleted_at=case when p_removed then now() else null end where id=p_article_id;
  insert into private.moderation_log(actor_id,article_id,action,reason) values(actor,p_article_id,case when p_removed then 'remove_article' else 'restore_article' end,btrim(p_reason));
  select * into source from private.article_sources where article_id=p_article_id;
  select owner_id into recipient from public.submissions where id=source.submission_id;
  if recipient is not null then insert into public.notifications(recipient_id,submission_id,article_id,kind,message) values(recipient,source.submission_id,p_article_id,'moderation',
    case when p_removed then 'Your article was removed from the public library. ' else 'Your article was restored to the public library. ' end||btrim(p_reason)); end if;
end $$;
create function private.admin_publications(p_page integer,p_removed boolean) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_admin();
  if p_page is null or p_page<0 or p_page>100000 or p_removed is null then raise exception using errcode='22023',message='Invalid publications page.'; end if;
  select jsonb_build_object('count',(select count(*) from public.articles where (deleted_at is not null)=p_removed),
    'rows',coalesce((select jsonb_agg(to_jsonb(a) order by a.published_at desc,a.id) from (select id,slug,title,author_names,category,published_at,deleted_at from public.articles where (deleted_at is not null)=p_removed order by published_at desc,id limit 5 offset p_page*5) a),'[]'::jsonb)) into result;
  return result;
end $$;

-- The signed-download resolver also enforces removal because it runs as service_role.
create or replace function public.resolve_public_asset(p_slug text) returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('storage_path',f.storage_path,'original_name',f.original_name) from public.articles a
  join private.article_sources x on x.article_id=a.id join public.submission_files f on f.id=x.file_id
  where a.slug=p_slug and a.deleted_at is null and f.verification_state='verified'
$$;
create function public.complete_profile(p_role text,p_full_name text,p_affiliation text,p_username text default null) returns jsonb language sql security invoker set search_path='' as $$ select private.complete_profile(p_role,p_full_name,p_affiliation,p_username) $$;
create function public.save_draft_with_contributors(p_id uuid,p_expected_version integer,p_title text,p_abstract text,p_category text,p_keywords text[],p_publication_consent boolean,p_contributors jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.save_draft_with_contributors(p_id,p_expected_version,p_title,p_abstract,p_category,p_keywords,p_publication_consent,p_contributors) $$;
create function public.article_activity(p_article_id uuid,p_page integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select private.article_activity(p_article_id,p_page) $$;
create function public.write_article_activity(p_article_id uuid,p_action text,p_comment_id uuid default null,p_body text default null,p_enabled boolean default null,p_expected_version integer default null) returns jsonb language sql security invoker set search_path='' as $$ select private.write_article_activity(p_article_id,p_action,p_comment_id,p_body,p_enabled,p_expected_version) $$;
create function public.my_reading_list(p_kind text,p_page integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select private.my_reading_list(p_kind,p_page) $$;
create function public.moderate_article(p_article_id uuid,p_removed boolean,p_reason text) returns void language sql security invoker set search_path='' as $$ select private.moderate_article(p_article_id,p_removed,p_reason) $$;
create function public.admin_publications(p_page integer default 0,p_removed boolean default false) returns jsonb language sql stable security invoker set search_path='' as $$ select private.admin_publications(p_page,p_removed) $$;

do $$ declare f record; begin
  for f in select n.nspname,p.proname,p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.proname in ('complete_profile','check_submission_owner','save_draft_with_contributors','copy_public_contributors','article_activity','write_article_activity','my_reading_list','moderate_article','admin_publications') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if f.proname not in ('check_submission_owner','copy_public_contributors') then execute format('grant execute on function %s to authenticated',f.signature); end if;
    if f.proname='article_activity' then execute format('grant execute on function %s to anon',f.signature); end if;
  end loop;
end $$;
grant usage on schema private to anon;
-- Only the explicitly granted aggregate/read helper is callable by anon.
-- Community refresh uses bounded polling; no public replication of private saves.
notify pgrst,'reload schema';
