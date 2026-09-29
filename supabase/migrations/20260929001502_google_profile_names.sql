-- Google metadata provides display names only; it never chooses application roles.
create or replace function private.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  display_name text := regexp_replace(
    coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),
             nullif(btrim(new.raw_user_meta_data->>'name'),''),''), '\s+', ' ', 'g');
  given_name text := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'first_name'),''),
    nullif(btrim(new.raw_user_meta_data->>'given_name'),''),
    nullif(split_part(display_name,' ',1),''), 'Author');
  family_name text := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'last_name'),''),
    nullif(btrim(new.raw_user_meta_data->>'family_name'),''),
    nullif(btrim(substr(display_name,length(split_part(display_name,' ',1))+1)),''), 'Account');
begin
  insert into public.profiles(id,first_name,last_name,affiliation)
  values(new.id,left(given_name,80),left(family_name,80),
    coalesce(left(btrim(new.raw_user_meta_data->>'affiliation'),200),''));
  insert into public.user_roles(user_id,role) values(new.id,'author');
  return new;
end
$function$;
