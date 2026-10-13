-- Transactional integration coverage: synthetic accounts/objects only.
-- Nothing is committed, emailed, uploaded, or published outside this transaction.
begin;
do $test$
#variable_conflict use_variable
declare
  a uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); r2 uuid:=gen_random_uuid(); ad uuid:=gen_random_uuid(); pending uuid:=gen_random_uuid();
  sa uuid:=gen_random_uuid(); sr uuid:=gen_random_uuid(); sr2 uuid:=gen_random_uuid(); sad uuid:=gen_random_uuid(); sp uuid:=gen_random_uuid();
  draft jsonb; file jsonb; article_id uuid; article_slug text; comment_id uuid; other_comment uuid; result jsonb; before_count bigint;
  handle text:='qa_'||replace(gen_random_uuid()::text,'-','');
begin
  handle:=left(handle,29);
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (a,a||'@example.test',now(),'{"name":"QA Author","role":"admin"}'),
    (r,r||'@example.test',now(),'{"name":"QA Reviewer"}'),
    (r2,r2||'@example.test',now(),'{"name":"QA Other Reviewer"}'),
    (ad,ad||'@example.test',now(),'{"name":"QA Admin"}'),
    (pending,pending||'@example.test',now(),'{"name":"QA Pending"}');
  insert into auth.sessions(id,user_id,created_at,updated_at) values(sa,a,now(),now()),(sr,r,now(),now()),(sr2,r2,now(),now()),(sad,ad,now(),now()),(sp,pending,now(),now());
  update public.user_roles set role='admin' where user_id=ad;
  update public.profiles set profile_complete=true where id=ad;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pending,'session_id',sp,'role','authenticated')::text,true);
  begin perform public.save_draft(null,null,'Pending account paper','An abstract long enough for this example.','QA Author','Science','{}',true); raise exception 'Unfinished signup obtained author access'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'session_id',sa,'role','authenticated')::text,true);
  if public.my_role()<>'author' then raise exception 'Metadata escalated role'; end if;
  begin perform public.complete_profile('admin','QA Author','QA Institute',null); raise exception 'Self-service admin escalation allowed'; exception when invalid_parameter_value then null; end;
  begin perform public.complete_profile('author','QA Author','',null); raise exception 'Author institution was optional'; exception when invalid_parameter_value then null; end;
  perform public.complete_profile('author','QA Author','QA Institute',null);
  draft:=public.save_draft_with_contributors(null,null,'Transactional community QA paper','A research abstract with more than thirty characters for this temporary test.','Computer Science','{}',true,
    jsonb_build_array(jsonb_build_object('name','QA Author','institution','QA Institute','email','author@example.test'),jsonb_build_object('name','QA Coauthor','institution','QA University','email','coauthor@example.test')));
  if jsonb_array_length(draft->'contributors')<>2 then raise exception 'Coauthors were not saved'; end if;
  begin perform public.save_draft_with_contributors(null,null,'Duplicate contributors','An abstract long enough for this example.','Science','{}',true,
    '[{"name":"One Author","institution":"One Institute","email":"same@example.test"},{"name":"Two Author","institution":"Two Institute","email":"SAME@example.test"}]'); raise exception 'Duplicate contributor emails accepted'; exception when invalid_parameter_value then null; end;
  file:=public.prepare_file((draft->>'id')::uuid,1,'community-qa.pdf','application/pdf',100);
  execute 'reset role';
  insert into storage.objects(bucket_id,name,metadata) values('manuscripts',file->>'storage_path','{"size":100,"mimetype":"application/pdf"}');
  execute 'set local role service_role';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.finalize_file((file->>'id')::uuid,repeat('a',64),100,'application/pdf');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'session_id',sa,'role','authenticated')::text,true);
  perform public.submit_submission((draft->>'id')::uuid,2);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ad,'session_id',sad,'role','authenticated')::text,true);
  result:=public.accept_and_publish((draft->>'id')::uuid,3,'Temporary transactional test');
  article_slug:=result->>'article_slug';
  select id into article_id from public.articles where slug=article_slug;
  if article_id is null then raise exception 'Publication workflow failed'; end if;
  if (select jsonb_array_length(contributors)<>2 or contributors::text like '%email%' or contributors::text like '%example.test%' from public.articles where id=article_id) then raise exception 'Public contributor data leaks email or lost affiliations'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',r,'session_id',sr,'role','authenticated')::text,true);
  perform public.complete_profile('reviewer','QA Reviewer','',upper(handle));
  if public.my_role()<>'reviewer' then raise exception 'Reviewer role was not persisted'; end if;
  begin perform public.complete_profile('author','Changed Identity','Institution',null); raise exception 'Account role switching allowed'; exception when insufficient_privilege then null; end;
  begin perform public.save_draft(null,null,'Reviewer paper','An abstract long enough for this example.','Reviewer','Science','{}',true); raise exception 'Reviewer created a manuscript'; exception when insufficient_privilege then null; end;
  begin update public.user_roles set role='admin' where user_id=r; raise exception 'Direct role update allowed'; exception when insufficient_privilege then null; end;
  if exists(select 1 from public.submissions where id=(draft->>'id')::uuid) then raise exception 'Reviewer can read private manuscript'; end if;
  result:=public.write_article_activity(article_id,'comment',null,'A useful research question.',null,null);
  comment_id:=(result->>'comment_id')::uuid;
  perform public.write_article_activity(article_id,'like',null,null,true,null);
  perform public.write_article_activity(article_id,'like',null,null,true,null);
  perform public.write_article_activity(article_id,'save',null,null,true,null);
  result:=public.article_activity(article_id,0);
  if (result->>'like_count')::integer<>1 or (result->>'comment_count')::integer<>1 or not(result->>'saved')::boolean then raise exception 'Reaction state/counts failed'; end if;
  if (public.my_reading_list('saved',0)->>'count')::integer<>1 then raise exception 'Saved list failed'; end if;
  if exists(select 1 from public.notifications) then raise exception 'Reviewer can read another account notifications'; end if;
  perform public.write_article_activity(article_id,'edit_comment',comment_id,'Updated research question.',null,1);
  begin perform public.write_article_activity(article_id,'edit_comment',comment_id,'Stale edit',null,1); raise exception 'Stale comment edit allowed'; exception when sqlstate 'PT409' then null; end;
  begin insert into public.article_comments(article_id,reviewer_id,username,body) values(article_id,r,'spoofed','Spoofed message'); raise exception 'Direct spoofed comment allowed'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',r2,'session_id',sr2,'role','authenticated')::text,true);
  begin perform public.complete_profile('reviewer','QA Other','',upper(handle)); raise exception 'Duplicate username accepted'; exception when sqlstate 'PT409' then null; end;
  perform public.complete_profile('reviewer','QA Other','',left(handle,27)||'b');
  begin perform public.write_article_activity(article_id,'delete_comment',comment_id,null,null,2); raise exception 'Other reviewer deleted comment'; exception when insufficient_privilege then null; end;
  begin perform public.write_article_activity(article_id,'edit_comment',comment_id,'Stolen comment',null,2); raise exception 'Other reviewer edited comment'; exception when insufficient_privilege then null; end;
  if (public.my_reading_list('saved',0)->>'count')::integer<>0 then raise exception 'Another reviewer can see saved list'; end if;
  result:=public.write_article_activity(article_id,'comment',null,'Second reviewer comment.',null,null); other_comment:=(result->>'comment_id')::uuid;
  begin perform public.moderate_article(article_id,true,'Not authorized'); raise exception 'Reviewer removed article'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'session_id',sa,'role','authenticated')::text,true);
  select count(*) into before_count from public.notifications n where n.recipient_id=a and n.article_id=article_id and kind in ('like','save','comment');
  if before_count<>4 then raise exception 'Website notifications are missing or duplicated: %',before_count; end if;
  begin perform public.write_article_activity(article_id,'like',null,null,true,null); raise exception 'Author obtained reviewer activity rights'; exception when insufficient_privilege then null; end;
  execute 'set local role anon';
  perform set_config('request.jwt.claims','{"role":"anon"}',true);
  if not exists(select 1 from public.articles where id=article_id) then raise exception 'Anonymous article reading failed'; end if;
  if (public.article_activity(article_id,0)->>'comment_count')::integer<>2 then raise exception 'Public discussion reading failed'; end if;
  begin perform public.write_article_activity(article_id,'comment',null,'Anonymous spam',null,null); raise exception 'Anonymous mutation accepted'; exception when insufficient_privilege then null; end;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ad,'session_id',sad,'role','authenticated')::text,true);
  begin perform public.write_article_activity(article_id,'edit_comment',other_comment,'Admin impersonation',null,1); raise exception 'Admin can impersonate a reviewer edit'; exception when insufficient_privilege then null; end;
  perform public.write_article_activity(article_id,'delete_comment',other_comment,null,null,1);
  perform public.moderate_article(article_id,true,'Removed for transactional verification');
  execute 'set local role anon'; perform set_config('request.jwt.claims','{"role":"anon"}',true);
  if exists(select 1 from public.articles where id=article_id) or exists(select 1 from public.article_comments c where c.id=comment_id) then raise exception 'Removed article/discussion still public'; end if;
  begin perform public.article_activity(article_id,0); raise exception 'Removed article aggregate visible'; exception when no_data_found then null; end;
  execute 'set local role service_role'; perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  if public.resolve_public_asset(article_slug) is not null then raise exception 'Removed article downloads still resolvable'; end if;
  execute 'set local role authenticated'; perform set_config('request.jwt.claims',jsonb_build_object('sub',r,'session_id',sr,'role','authenticated')::text,true);
  perform public.write_article_activity(article_id,'save',null,null,false,null);
  perform public.write_article_activity(article_id,'like',null,null,false,null);
  perform public.write_article_activity(article_id,'delete_comment',comment_id,null,null,2);
  if (public.my_reading_list('saved',0)->>'count')::integer<>0 or (public.my_reading_list('liked',0)->>'count')::integer<>0 or (public.my_reading_list('comments',0)->>'count')::integer<>0 then raise exception 'Reviewer could not remove own activity'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',ad,'session_id',sad,'role','authenticated')::text,true);
  perform public.moderate_article(article_id,false,'Restored after verification');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',r,'session_id',sr,'role','authenticated')::text,true);
  for before_count in 1..4 loop
    result:=public.write_article_activity(article_id,'comment',null,'Quota verification comment.',null,null);
    perform public.write_article_activity(article_id,'delete_comment',(result->>'comment_id')::uuid,null,null,1);
  end loop;
  begin perform public.write_article_activity(article_id,'comment',null,'Should exceed quota despite deletion.',null,null); raise exception 'Delete/repost bypassed comment quota'; exception when sqlstate 'PT429' then null; end;
  execute 'reset role'; delete from auth.sessions where id=sr;
  execute 'set local role authenticated'; perform set_config('request.jwt.claims',jsonb_build_object('sub',r,'session_id',sr,'role','authenticated')::text,true);
  begin perform public.write_article_activity(article_id,'like',null,null,true,null); raise exception 'Revoked session can mutate'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('ggc.test_result','All community workflow, privacy, ownership, username, moderation and revoked-session checks passed.',true);
end $test$;
select current_setting('ggc.test_result') as result;
rollback;
