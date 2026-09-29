-- Qualify the outer profile ID: a bare id inside the subquery bound to submissions.id.
alter policy profiles_self_or_relevant_admin on public.profiles using (
  id = (select auth.uid()) or ((select private.is_admin()) and exists(
    select 1 from public.submissions s where s.owner_id = profiles.id and s.status <> 'draft'
  ))
);
