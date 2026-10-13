-- Separate transaction: PostgreSQL must commit new enum values before use.
alter type public.app_role add value if not exists 'reviewer';
