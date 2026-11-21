-- PostgREST verifies the caller's JWT before establishing this request context.
-- Check Supabase's session row as well so a revoked session cannot reuse its JWT.
create or replace function public.aerp_has_active_session()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from auth.sessions as session
        where session.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
          and session.user_id = auth.uid()
          and (session.not_after is null or session.not_after > now())
          and coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'false'
    );
$$;

revoke all on function public.aerp_has_active_session() from public, anon, authenticated;
grant execute on function public.aerp_has_active_session() to authenticated;
