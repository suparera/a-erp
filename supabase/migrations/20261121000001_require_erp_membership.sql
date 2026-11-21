create table public.aerp_memberships (
    user_id uuid primary key references auth.users (id) on delete cascade,
    role text not null default 'user' check (role in ('user', 'admin'))
);

alter table public.aerp_memberships enable row level security;
revoke all on public.aerp_memberships from public, anon, authenticated;
grant select on public.aerp_memberships to authenticated;

create policy "Members can read their own membership with an active session"
on public.aerp_memberships
for select to authenticated
using (
    user_id = (select auth.uid())
    and (select public.aerp_has_active_session())
);
