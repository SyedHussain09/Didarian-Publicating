-- Run only against a designated development database. Every fixture and temporary
-- failure trigger is enclosed in this transaction and rolled back.
-- These are real Postgres RLS/RPC tests, not substitutes for Storage/Auth E2E.
begin;
create temporary table test_users(label text primary key,id uuid,session_id uuid);
create temporary table test_items(label text primary key,id uuid,file_id uuid,path text,version integer);
create temporary table test_results(name text,status text);
grant all on test_users,test_items,test_results to anon,authenticated,service_role;
create function pg_temp.assert_true(ok boolean,test_name text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %',test_name; end if; insert into pg_temp.test_results values(test_name,'passed'); end $$;
create function pg_temp.expect_error(statement text,error_code text,test_name text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlstate <> error_code then raise exception 'Wrong error for %: % %',test_name,sqlstate,sqlerrm; end if;
    insert into pg_temp.test_results values(test_name,'passed'); return;
  end;
  raise exception 'Expected error for %',test_name;
end $$;
insert into test_users select label,gen_random_uuid(),gen_random_uuid() from unnest(array['author_a','author_b','admin']) label;
insert into auth.users(id,email,raw_user_meta_data) select id,'transaction-'||id||'@example.test',jsonb_build_object('first_name','Transaction','last_name',label,'role','admin') from test_users;
insert into auth.sessions(id,user_id,created_at,updated_at) select session_id,id,now(),now() from test_users;
update public.user_roles set role='admin' where user_id=(select id from test_users where label='admin');

set local role authenticated;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'session_id',session_id,'role','authenticated')::text from test_users where label='author_a'),true);
select pg_temp.assert_true(public.my_role()='author','User metadata role=admin is ignored');
select pg_temp.expect_error('update public.user_roles set role=''admin''','42501','Role table rejects client updates');
insert into test_items(label,id,version) select 'publish',(result->>'id')::uuid,(result->>'version')::integer from (select public.save_draft(null,null,'Transactional test manuscript','An abstract with more than thirty characters for the transactional test.','Transaction Author','Science','{}',true) result) q;
select pg_temp.expect_error(format('select public.submit_submission(%L,1)',(select id from test_items where label='publish')),'22023','Cannot submit a draft without a verified asset');
select pg_temp.expect_error('update public.submissions set status=''published''','42501','Direct protected status updates denied');
select pg_temp.expect_error(format('select public.accept_and_publish(%L,1)',(select id from test_items where label='publish')),'42501','Author cannot invoke acceptance wrapper');
select pg_temp.expect_error(format('select public.reject_submission(%L,1,''No rights'')',(select id from test_items where label='publish')),'42501','Author cannot invoke rejection wrapper');
select pg_temp.expect_error(format('select private.transition(%L,1,''admin_publish'','''')',(select id from test_items where label='publish')),'42501','Private helper also rejects unauthorized admin action');
update test_items set file_id=(result->>'id')::uuid,path=result->>'storage_path' from (select public.prepare_file((select id from test_items where label='publish'),1,'paper.pdf','application/pdf',100) result) q where label='publish';
select pg_temp.expect_error(format('select public.finalize_file(%L,%L,100,''application/pdf'')',(select file_id from test_items where label='publish'),repeat('a',64)),'42501','Author cannot set server verification state');

select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'session_id',session_id,'role','authenticated')::text from test_users where label='author_b'),true);
select pg_temp.assert_true((select count(*)=0 from public.submissions),'Author B cannot see Author A draft');
select pg_temp.assert_true((select count(*)=0 from public.submission_files),'Author B cannot enumerate Author A files');
select pg_temp.expect_error(format('select public.get_submission(%L)',(select id from test_items where label='publish')),'42501','Guessed submission RPC ID denied');
select pg_temp.expect_error(format('select private.submission_result(%L)',(select id from test_items where label='publish')),'42501','Private result helper cannot leak another author submission');
select pg_temp.expect_error(format('select public.save_draft(%L,1,''Stolen'',''Abstract'',''Names'',''Category'',''{}'',true)',(select id from test_items where label='publish')),'42501','Author B cannot edit Author A draft');

select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'session_id',session_id,'role','authenticated')::text from test_users where label='admin'),true);
select pg_temp.assert_true((select count(*)=0 from public.submissions where id=(select id from test_items where label='publish')),'Admin cannot see an author draft');
reset role;
insert into storage.objects(bucket_id,name,metadata) select 'manuscripts',path,'{"size":100,"mimetype":"application/pdf"}' from test_items;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.finalize_file((select file_id from test_items where label='publish'),repeat('a',64),100,'application/pdf');
set local role authenticated;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'session_id',session_id,'role','authenticated')::text from test_users where label='author_a'),true);
select pg_temp.assert_true((public.submit_submission((select id from test_items where label='publish'),2)->>'status')='submitted','Verified draft submits');
select pg_temp.assert_true((public.submit_submission((select id from test_items where label='publish'),2)->>'version')='3','Repeated submission is idempotent');
select pg_temp.expect_error(format('select public.prepare_file(%L,3,''replacement.pdf'',''application/pdf'',100)',(select id from test_items where label='publish')),'PT409','Submitted asset cannot be replaced');
select pg_temp.assert_true((select count(*)=0 from storage.objects where bucket_id='manuscripts'),'Direct Storage enumeration is denied');
select pg_temp.expect_error(format('insert into storage.objects(bucket_id,name) values(''manuscripts'',%L)',(select path||'.other' from test_items where label='publish')),'42501','Direct Storage insertion is denied');

select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'session_id',session_id,'role','authenticated')::text from test_users where label='admin'),true);
select pg_temp.assert_true((select count(*)=1 from public.submissions where id=(select id from test_items where label='publish')),'Submitted manuscript appears in admin queue');
select pg_temp.assert_true((select count(*)=1 from public.profiles where id=(select id from test_users where label='author_a')),'Admin can read the submitted authors profile');
select public.add_admin_note((select id from test_items where label='publish'),'Private administrative discussion');
select pg_temp.assert_true((public.start_review((select id from test_items where label='publish'),3)->>'status')='under_review','Administrator starts review');
select pg_temp.assert_true((public.accept_and_publish((select id from test_items where label='publish'),4,'Approved')->>'status')='published','Acceptance commits publication');
select public.accept_and_publish((select id from test_items where label='publish'),4,'Repeated click');
select pg_temp.assert_true((select count(*)=1 from public.articles where title='Transactional test manuscript'),'Repeated acceptance creates one article');
select pg_temp.assert_true((select count(*)=1 from public.submission_events where kind='accepted' and submission_id=(select id from test_items where label='publish')),'Repeated acceptance creates one accepted event');
select pg_temp.assert_true((select count(*)=1 from public.submission_events where kind='published' and submission_id=(select id from test_items where label='publish')),'Repeated acceptance creates one publication event');
select pg_temp.expect_error(format('select public.reject_submission(%L,4,''Competing rejection'')',(select id from test_items where label='publish')),'PT409','Losing competing decision returns conflict');

select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'session_id',session_id,'role','authenticated')::text from test_users where label='author_a'),true);
select pg_temp.assert_true((select count(*)=0 from public.admin_notes),'Private administrative notes hidden from author');
select pg_temp.assert_true(public.submission_article_slug((select id from test_items where label='publish')) is not null,'Author can resolve the public article after refresh');
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'session_id',session_id,'role','authenticated')::text from test_users where label='author_b'),true);
select pg_temp.assert_true((select count(*)=0 from public.submission_events),'Other author cannot see decision history');
select pg_temp.assert_true((select count(*)=0 from public.notifications),'Other author cannot see notifications');
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.assert_true((select count(*)=1 from public.articles where title='Transactional test manuscript'),'Anonymous visitor can read publication');
select pg_temp.expect_error('select * from public.submissions','42501','Anonymous private submissions denied');
select pg_temp.expect_error('select * from public.contact_messages','42501','Anonymous contact reads denied');
select pg_temp.expect_error('select * from private.article_sources','42501','Anonymous private source association denied');
select pg_temp.expect_error('select public.resolve_public_asset(''guess'')','42501','Raw path resolver is service-only');

-- Force an insertion failure inside publication and prove the whole transaction
-- rolls back the state, article, history and notification writes together.
reset role;
create function pg_temp.fail_test_publication() returns trigger language plpgsql as $$ begin if exists(select 1 from public.submissions where id=new.submission_id and title='Forced rollback manuscript') then raise exception using errcode='23514',message='Deliberate late publication failure'; end if; return new; end $$;
-- Notification insertion is the LAST write: article, private source association,
-- submission status and both decision events have already been written.
create trigger transaction_test_fail before insert on public.notifications for each row execute function pg_temp.fail_test_publication();
insert into public.submissions(owner_id,title,abstract,author_names,category,publication_consent) values((select id from test_users where label='admin'),'Forced rollback manuscript','An abstract with thirty or more characters for failure injection.','Named Article Author','Science',true);
insert into test_items(label,id,version) select 'rollback',id,1 from public.submissions where title='Forced rollback manuscript';
insert into public.submission_files(submission_id,storage_path,original_name,media_type,byte_size,version,verification_state,sha256,verified_at) select id,'rollback/'||id||'.pdf','rollback.pdf','application/pdf',100,1,'verified',repeat('b',64),now() from test_items where label='rollback';
update public.submissions s set current_file_id=f.id from public.submission_files f where f.submission_id=s.id and s.title='Forced rollback manuscript';
insert into storage.objects(bucket_id,name) select 'manuscripts',f.storage_path from public.submission_files f join test_items i on i.id=f.submission_id where i.label='rollback';
set local role authenticated;
select set_config('request.jwt.claims',(select jsonb_build_object('sub',id,'session_id',session_id,'role','authenticated')::text from test_users where label='admin'),true);
select pg_temp.expect_error(format('select public.publish_admin_article(%L,1)',(select id from test_items where label='rollback')),'23514','Injected publication failure is returned');
select pg_temp.assert_true((select status='draft' from public.submissions where id=(select id from test_items where label='rollback')),'Failed publication leaves draft status');
select pg_temp.assert_true((select count(*)=0 from public.submission_events where submission_id=(select id from test_items where label='rollback')),'Failed publication leaves no decision events');
select pg_temp.assert_true((select count(*)=0 from public.articles where title='Forced rollback manuscript'),'Failed publication leaves no public article');
select pg_temp.assert_true((select count(*)=0 from public.notifications where submission_id=(select id from test_items where label='rollback')),'Late failure leaves no publication notification');
reset role;
select pg_temp.assert_true((select count(*)=0 from private.article_sources where submission_id=(select id from test_items where label='rollback')),'Late failure rolls back the protected source association');
update public.user_roles set role='author' where user_id=(select id from test_users where label='admin');
set local role authenticated;
select pg_temp.expect_error(format('select public.publish_admin_article(%L,1)',(select id from test_items where label='rollback')),'42501','Removed admin privilege takes effect without JWT refresh');
reset role;
delete from auth.sessions where user_id=(select id from test_users where label='admin');
set local role authenticated;
select pg_temp.expect_error('select public.assert_active_session()','42501','Revoked session cannot run sensitive commands');
reset role;
select jsonb_build_object('total',(select count(*) from test_results),'checks',(select jsonb_agg(to_jsonb(r)) from test_results r)) as test_report;
rollback;
