-- Application conflicts must not use serialization_failure: PostgREST retries it.
create or replace function private.save_draft(p_id uuid,p_expected_version integer,p_title text,p_abstract text,p_author_names text,p_category text,p_keywords text[],p_publication_consent boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.active_user(); item public.submissions;
begin
  if p_id is null then
    insert into public.submissions(owner_id,title,abstract,author_names,category,keywords,publication_consent)
    values(actor,btrim(p_title),btrim(p_abstract),btrim(p_author_names),btrim(p_category),p_keywords,p_publication_consent) returning * into item;
  else
    select * into item from public.submissions where id=p_id for update;
    if not found or item.owner_id <> actor then raise exception using errcode='42501',message='Draft is not available.'; end if;
    if item.status <> 'draft' or item.version is distinct from p_expected_version then raise exception using errcode='PT409',message='Submission changed. Reload before saving.'; end if;
    update public.submissions set title=btrim(p_title),abstract=btrim(p_abstract),author_names=btrim(p_author_names),category=btrim(p_category),keywords=p_keywords,publication_consent=p_publication_consent,version=version+1,updated_at=now() where id=p_id returning * into item;
  end if;
  return private.submission_result(item.id);
end $$;

create or replace function private.transition(p_id uuid,p_expected_version integer,p_action text,p_feedback text default '') returns jsonb language plpgsql security definer set search_path = '' as $$
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
  if item.version is distinct from p_expected_version then raise exception using errcode='PT409',message='Submission changed. Reload to see its current decision.'; end if;
  if (p_action='submit' and item.status <> 'draft') or (p_action='review' and item.status <> 'submitted') or
     (p_action in ('publish','reject') and item.status not in ('submitted','under_review')) or (p_action='admin_publish' and item.status <> 'draft') then
    raise exception using errcode='PT409',message='This action is no longer available for the current status.';
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

create or replace function private.prepare_file(p_submission_id uuid,p_expected_version integer,p_original_name text,p_media_type text,p_byte_size bigint) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.active_user(); item public.submissions; asset public.submission_files; extension text; file_id uuid := gen_random_uuid();
begin
  select * into item from public.submissions where id=p_submission_id for update;
  if not found or item.owner_id <> actor then raise exception using errcode='42501',message='Draft is not available.'; end if;
  if item.status <> 'draft' or item.version is distinct from p_expected_version then raise exception using errcode='PT409',message='Draft changed. Reload before uploading.'; end if;
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

create or replace function private.finalize_file(p_file_id uuid,p_sha256 text,p_byte_size bigint,p_media_type text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare asset public.submission_files; item public.submissions;
begin
  select * into asset from public.submission_files where id=p_file_id;
  if not found then raise exception using errcode='P0002',message='File not found.'; end if;
  select * into item from public.submissions where id=asset.submission_id for update;
  select * into asset from public.submission_files where id=p_file_id for update;
  if asset.verification_state='verified' then return private.submission_result(item.id); end if;
  if item.status <> 'draft' or asset.verification_state <> 'pending' then raise exception using errcode='PT409',message='This file cannot be attached now. Reload the submission.'; end if;
  if asset.byte_size <> p_byte_size or asset.media_type <> p_media_type or not exists(select 1 from storage.objects o where o.bucket_id='manuscripts' and o.name=asset.storage_path) then raise exception using errcode='22023',message='Uploaded file does not match its reservation.'; end if;
  update public.submission_files set verification_state='verified',sha256=p_sha256,verified_at=now() where id=p_file_id;
  update public.submissions set current_file_id=p_file_id,version=version+1,updated_at=now() where id=item.id;
  return private.submission_result(item.id);
end $$;
