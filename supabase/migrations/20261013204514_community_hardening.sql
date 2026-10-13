-- Keep comment quotas independent of deletions so delete/repost cannot bypass them.
create table private.comment_quotas(
  reviewer_id uuid primary key references public.profiles(id) on delete cascade,
  window_start timestamptz not null, count integer not null check(count>0)
);
alter table private.comment_quotas enable row level security;
revoke all on private.comment_quotas from public,anon,authenticated;
grant all on private.comment_quotas to service_role;
create function private.enforce_comment_quota() returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.active_user(); quota integer; minute timestamptz:=date_trunc('minute',now());
begin
  if new.reviewer_id<>actor then raise exception using errcode='42501',message='Comment ownership does not match your account.'; end if;
  insert into private.comment_quotas(reviewer_id,window_start,count) values(actor,minute,1)
  on conflict(reviewer_id) do update set window_start=excluded.window_start,count=case when private.comment_quotas.window_start=excluded.window_start then private.comment_quotas.count+1 else 1 end returning count into quota;
  if quota>5 then raise exception using errcode='PT429',message='Please wait a minute before posting another comment.'; end if;
  return new;
end $$;
revoke all on function private.enforce_comment_quota() from public,anon,authenticated;
create trigger comment_rate_limit before insert on public.article_comments for each row execute function private.enforce_comment_quota();

create or replace function private.update_profile(p_first_name text,p_last_name text,p_affiliation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.active_user(); result public.profiles;
begin
  if exists(select 1 from public.user_roles where user_id=actor and role='author') and (p_affiliation is null or char_length(btrim(p_affiliation))<2) then raise exception using errcode='22023',message='Institute / Organization Name is required.'; end if;
  update public.profiles set first_name=btrim(p_first_name),last_name=btrim(p_last_name),full_name=btrim(p_first_name||' '||p_last_name),affiliation=btrim(p_affiliation),updated_at=now() where id=actor returning * into result;
  if not found then raise exception using errcode='P0002',message='Profile is missing. Contact support.'; end if;
  return to_jsonb(result);
end $$;
notify pgrst,'reload schema';
