create table public.billing_sessions (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  plan public.subscription_plan not null check (plan in ('pro', 'premium')),
  amount integer not null check (
    (plan = 'pro' and amount = 3000) or
    (plan = 'premium' and amount = 6000)
  ),
  currency text not null default 'XOF' check (currency = 'XOF'),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  provider_checkout_id uuid unique,
  checkout_url text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index billing_sessions_workshop_created_idx
  on public.billing_sessions (workshop_id, created_at desc);
create unique index billing_sessions_one_pending_per_workshop_idx
  on public.billing_sessions (workshop_id)
  where status = 'pending';

alter table public.billing_sessions enable row level security;

create policy "billing_sessions_select_own"
  on public.billing_sessions for select to authenticated
  using (workshop_id = (select public.current_workshop_id()));

create or replace function public.protect_workshop_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.plan is distinct from old.plan
    and coalesce(auth.role(), '') <> 'service_role'
    and current_setting('tailorpro.plan_change', true) is distinct from 'on' then
    raise exception 'La formule doit être modifiée par un processus autorisé.';
  end if;
  return new;
end;
$$;

create or replace function public.activate_saspay_subscription(p_billing_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  billing_row public.billing_sessions%rowtype;
  now_at timestamptz := now();
begin
  select * into billing_row
    from public.billing_sessions
    where id = p_billing_session_id
    for update;

  if not found then
    raise exception 'Session de paiement introuvable.';
  end if;

  if billing_row.status = 'paid' then
    return 'paid';
  end if;

  if billing_row.status <> 'pending' then
    return billing_row.status;
  end if;

  insert into public.subscriptions (
    workshop_id, plan, status, starts_at, ends_at, provider, provider_reference, updated_at
  ) values (
    billing_row.workshop_id, billing_row.plan, 'active', now_at,
    now_at + interval '1 month', 'saspay', billing_row.provider_checkout_id::text, now_at
  )
  on conflict (workshop_id) do update
    set plan = excluded.plan,
        status = excluded.status,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        provider = excluded.provider,
        provider_reference = excluded.provider_reference,
        updated_at = excluded.updated_at;

  perform set_config('tailorpro.plan_change', 'on', true);
  update public.workshops
    set plan = billing_row.plan, updated_at = now_at
    where id = billing_row.workshop_id;

  update public.billing_sessions
    set status = 'paid', paid_at = now_at
    where id = billing_row.id;

  return 'paid';
end;
$$;

revoke all on function public.activate_saspay_subscription(uuid) from public, anon, authenticated;
grant execute on function public.activate_saspay_subscription(uuid) to service_role;

create or replace function public.expire_my_subscription()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  workshop uuid;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;

  workshop := public.current_workshop_id();

  update public.subscriptions
    set plan = 'free',
        status = 'expired',
        updated_at = now()
    where workshop_id = workshop
      and plan <> 'free'
      and status = 'active'
      and ends_at is not null
      and ends_at <= now();

  perform set_config('tailorpro.plan_change', 'on', true);
  update public.workshops w
    set plan = 'free', updated_at = now()
    where w.id = workshop
      and w.plan <> 'free'
      and exists (
        select 1 from public.subscriptions s
        where s.workshop_id = w.id
          and s.plan = 'free'
          and s.status = 'expired'
      );
end;
$$;

revoke all on function public.expire_my_subscription() from public, anon;
grant execute on function public.expire_my_subscription() to authenticated;
