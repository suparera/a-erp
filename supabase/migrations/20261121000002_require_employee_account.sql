-- The hosted roster already exists. A new project can import the employee CSV
-- into this table before provisioning accounts.
create table if not exists public.employees (
    employee_id integer primary key,
    employee_code text not null unique,
    first_name text not null,
    last_name text not null,
    email text not null unique,
    department_id integer not null,
    job_title text not null,
    manager_id integer references public.employees (employee_id),
    hire_date text not null,
    termination_date text,
    monthly_salary real not null,
    is_active integer not null
);

create unique index employees_normalized_email_key
    on public.employees (lower(btrim(email)));

revoke insert, update, delete, truncate, trigger
    on public.employees from public, anon, authenticated;

create table public.aerp_employee_accounts (
    user_id uuid primary key references auth.users (id) on delete cascade,
    employee_id integer not null unique references public.employees (employee_id)
);

alter table public.aerp_employee_accounts enable row level security;
revoke all on public.aerp_employee_accounts from public, anon, authenticated;

create function public.aerp_eligible_employee(email_address text)
returns integer
language sql
stable
set search_path = ''
as $$
    select employee_id
    from public.employees
    where lower(btrim(email)) = nullif(lower(btrim(email_address)), '')
      and is_active = 1
      and (
          termination_date is null
          or termination_date::date > (now() at time zone 'Asia/Bangkok')::date
      );
$$;

revoke all on function public.aerp_eligible_employee(text) from public, anon, authenticated;

-- Keep the employee binding when the same employee's email changes.
create function public.aerp_bind_employee_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    matched_employee_id integer;
begin
    if tg_op = 'UPDATE' and new.email is not distinct from old.email then
        return new;
    end if;

    matched_employee_id := public.aerp_eligible_employee(new.email);
    if matched_employee_id is null then
        raise exception 'Account email must match an eligible ERP employee'
            using errcode = '23514';
    end if;

    insert into public.aerp_employee_accounts (user_id, employee_id)
    values (new.id, matched_employee_id)
    on conflict (user_id) do nothing;

    if not exists (
        select 1 from public.aerp_employee_accounts
        where user_id = new.id and employee_id = matched_employee_id
    ) then
        raise exception 'Account email must belong to the linked ERP employee'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

revoke all on function public.aerp_bind_employee_account() from public, anon, authenticated;

create trigger aerp_bind_employee_account
    after insert or update of email on auth.users
    for each row execute function public.aerp_bind_employee_account();

insert into public.aerp_employee_accounts (user_id, employee_id)
select u.id, e.employee_id
from auth.users u
join public.employees e on e.employee_id = public.aerp_eligible_employee(u.email)
where u.email_confirmed_at is not null;

create function public.aerp_has_eligible_employee()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.aerp_employee_accounts a
        join auth.users u on u.id = a.user_id
        where a.user_id = (select auth.uid())
          and u.email_confirmed_at is not null
          and a.employee_id = public.aerp_eligible_employee(u.email)
    );
$$;

revoke all on function public.aerp_has_eligible_employee() from public, anon, authenticated;
grant execute on function public.aerp_has_eligible_employee() to authenticated;

alter policy "Members can read their own membership with an active session"
on public.aerp_memberships
using (
    user_id = (select auth.uid())
    and (select public.aerp_has_active_session())
    and (select public.aerp_has_eligible_employee())
);
