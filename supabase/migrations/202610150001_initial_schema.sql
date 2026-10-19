create extension if not exists pgcrypto;

create type public.subscription_plan as enum ('free', 'pro', 'premium');
create type public.order_status as enum ('new', 'in_progress', 'fitting', 'completed', 'delivered', 'cancelled');
create type public.payment_method as enum ('cash', 'mobile_money', 'bank_transfer', 'other');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workshops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null default 'Mon atelier',
  phone text,
  address text,
  currency text not null default 'XOF' check (currency = 'XOF'),
  plan public.subscription_plan not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  phone text not null check (length(trim(phone)) > 0),
  address text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workshop_id)
);

create index clients_workshop_name_idx on public.clients (workshop_id, lower(full_name));
create index clients_workshop_phone_idx on public.clients (workshop_id, phone);

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  client_id uuid not null,
  measured_on date not null default current_date,
  unit text not null default 'cm' check (unit = 'cm'),
  bust numeric(7,2) check (bust is null or bust > 0),
  waist numeric(7,2) check (waist is null or waist > 0),
  hips numeric(7,2) check (hips is null or hips > 0),
  shoulders numeric(7,2) check (shoulders is null or shoulders > 0),
  sleeve_length numeric(7,2) check (sleeve_length is null or sleeve_length > 0),
  garment_length numeric(7,2) check (garment_length is null or garment_length > 0),
  neck numeric(7,2) check (neck is null or neck > 0),
  arm numeric(7,2) check (arm is null or arm > 0),
  trouser_length numeric(7,2) check (trouser_length is null or trouser_length > 0),
  thigh numeric(7,2) check (thigh is null or thigh > 0),
  inseam numeric(7,2) check (inseam is null or inseam > 0),
  custom_measurements jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (client_id, workshop_id) references public.clients(id, workshop_id) on delete restrict,
  unique (id, workshop_id)
);

alter table public.measurements
  add constraint measurements_custom_object
  check (jsonb_typeof(custom_measurements) = 'object');

create table public.garment_models (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text not null default 'Autre',
  description text,
  indicative_price numeric(12,2) check (indicative_price is null or indicative_price >= 0),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workshop_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  client_id uuid not null,
  reference bigint generated always as identity,
  status public.order_status not null default 'new',
  order_date date not null default current_date,
  fitting_date date,
  due_date date,
  description text,
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (client_id, workshop_id) references public.clients(id, workshop_id) on delete restrict,
  check (due_date is null or due_date >= order_date),
  check (fitting_date is null or fitting_date >= order_date),
  unique (id, workshop_id)
);

create index orders_workshop_date_idx on public.orders (workshop_id, order_date desc);
create index orders_workshop_due_idx on public.orders (workshop_id, due_date) where archived_at is null;

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  order_id uuid not null,
  model_id uuid,
  garment_name text not null check (length(trim(garment_name)) > 0),
  description text,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  created_at timestamptz not null default now(),
  foreign key (order_id, workshop_id) references public.orders(id, workshop_id) on delete cascade,
  foreign key (model_id, workshop_id) references public.garment_models(id, workshop_id) on delete restrict,
  unique (id, workshop_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  order_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  method public.payment_method not null default 'cash',
  reference text,
  notes text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (order_id, workshop_id) references public.orders(id, workshop_id) on delete restrict,
  unique (id, workshop_id)
);

create index payments_workshop_paid_idx on public.payments (workshop_id, paid_at desc);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null unique references public.workshops(id) on delete cascade,
  plan public.subscription_plan not null default 'free',
  status text not null default 'active' check (status in ('active', 'pending', 'expired', 'cancelled')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  provider text,
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  actor_id uuid not null default auth.uid() references auth.users(id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null check (action in ('created', 'updated', 'archived')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_workshop_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id from public.workshops w where w.owner_id = (select auth.uid()) limit 1
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workshop_id uuid;
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  insert into public.workshops (owner_id, name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'workshop_name'), ''), 'Mon atelier'))
  returning id into new_workshop_id;
  insert into public.subscriptions (workshop_id, plan) values (new_workshop_id, 'free');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.update_my_workshop_settings(
  p_full_name text,
  p_workshop_name text,
  p_phone text,
  p_address text
)
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
  if length(trim(coalesce(p_full_name, ''))) = 0 or length(trim(coalesce(p_workshop_name, ''))) = 0 then
    raise exception 'Le nom et le nom de l’atelier sont obligatoires.';
  end if;
  workshop := public.current_workshop_id();
  if workshop is null then
    raise exception 'Aucun atelier n’est associé à ce compte.';
  end if;
  update public.profiles
    set full_name = trim(p_full_name)
    where id = (select auth.uid());
  update public.workshops
    set name = trim(p_workshop_name),
        phone = nullif(trim(coalesce(p_phone, '')), ''),
        address = nullif(trim(coalesce(p_address, '')), '')
    where id = workshop and owner_id = (select auth.uid());
end;
$$;

revoke all on function public.update_my_workshop_settings(text, text, text, text) from public;
grant execute on function public.update_my_workshop_settings(text, text, text, text) to authenticated;

create or replace function public.protect_workshop_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.plan is distinct from old.plan and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'La formule doit être modifiée par un processus autorisé.';
  end if;
  return new;
end;
$$;

create trigger workshops_plan_guard before update on public.workshops
for each row execute function public.protect_workshop_plan();

create or replace function public.enforce_order_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_plan public.subscription_plan;
  monthly_count integer;
  plan_limit integer;
begin
  perform 1 from public.workshops where id = new.workshop_id for update;
  select plan into selected_plan from public.workshops where id = new.workshop_id;
  plan_limit := case selected_plan when 'free' then 5 when 'pro' then 50 else null end;
  if plan_limit is not null then
    select count(*)::integer into monthly_count
      from public.orders
      where workshop_id = new.workshop_id
        and created_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')
        and created_at < ((date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC');
    if monthly_count >= plan_limit then
      raise exception 'QUOTA_REACHED:%', plan_limit using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_quota_guard before insert on public.orders
for each row execute function public.enforce_order_quota();

create or replace function public.create_order_with_items(
  p_client_id uuid,
  p_order_date date,
  p_due_date date,
  p_fitting_date date,
  p_description text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  workshop uuid;
  new_order_id uuid;
  item jsonb;
  item_quantity integer;
  item_price numeric(12,2);
begin
  if auth.uid() is null then
    raise exception 'Connexion requise.';
  end if;
  workshop := public.current_workshop_id();
  if workshop is null then
    raise exception 'Aucun atelier n’est associé à ce compte.';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and workshop_id = workshop and archived_at is null) then
    raise exception 'Le client sélectionné est introuvable.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Ajoutez au moins un article à la commande.';
  end if;
  if p_due_date is not null and p_order_date is not null and p_due_date < p_order_date then
    raise exception 'La livraison ne peut pas précéder la commande.';
  end if;
  insert into public.orders (workshop_id, client_id, order_date, due_date, fitting_date, description)
  values (workshop, p_client_id, coalesce(p_order_date, current_date), p_due_date, p_fitting_date, p_description)
  returning id into new_order_id;

  for item in select value from jsonb_array_elements(p_items)
  loop
    item_quantity := (item ->> 'quantity')::integer;
    item_price := (item ->> 'unit_price')::numeric(12,2);
    if item_quantity < 1 or item_price < 0 or length(trim(coalesce(item ->> 'garment_name', ''))) = 0 then
      raise exception 'Un article contient des informations invalides.';
    end if;
    insert into public.order_items (workshop_id, order_id, model_id, garment_name, description, quantity, unit_price)
    values (
      workshop,
      new_order_id,
      nullif(item ->> 'model_id', '')::uuid,
      trim(item ->> 'garment_name'),
      nullif(item ->> 'description', ''),
      item_quantity,
      item_price
    );
  end loop;
  return new_order_id;
end;
$$;

revoke all on function public.create_order_with_items(uuid, date, date, date, text, jsonb) from public;
grant execute on function public.create_order_with_items(uuid, date, date, date, text, jsonb) to authenticated;

create or replace function public.recalculate_order_total()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_order_id uuid;
  target_workshop_id uuid;
  next_total numeric(12,2);
  paid_total numeric(12,2);
begin
  target_order_id := coalesce(new.order_id, old.order_id);
  target_workshop_id := coalesce(new.workshop_id, old.workshop_id);
  select coalesce(sum(quantity * unit_price), 0)::numeric(12,2)
    into next_total from public.order_items
    where order_id = target_order_id and workshop_id = target_workshop_id;
  select coalesce(sum(amount), 0)::numeric(12,2)
    into paid_total from public.payments
    where order_id = target_order_id and workshop_id = target_workshop_id;
  if next_total < paid_total then
    raise exception 'Le nouveau montant total est inférieur aux paiements déjà enregistrés.';
  end if;
  perform set_config('tailorpro.recalculating_total', 'on', true);
  update public.orders
    set total_amount = next_total, updated_at = now()
    where id = target_order_id and workshop_id = target_workshop_id;
  perform set_config('tailorpro.recalculating_total', 'off', true);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger order_items_total after insert or update or delete on public.order_items
for each row execute function public.recalculate_order_total();

create or replace function public.protect_order_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.total_amount is distinct from old.total_amount
    and coalesce(auth.role(), '') <> 'service_role'
    and coalesce(current_setting('tailorpro.recalculating_total', true), 'off') <> 'on' then
    raise exception 'Le montant total est calculé à partir des articles.';
  end if;
  return new;
end;
$$;

create trigger orders_total_guard before update on public.orders
for each row execute function public.protect_order_total();

create or replace function public.validate_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_total numeric(12,2);
  already_paid numeric(12,2);
begin
  perform 1 from public.orders
    where id = new.order_id and workshop_id = new.workshop_id for update;
  select total_amount into order_total from public.orders
    where id = new.order_id and workshop_id = new.workshop_id;
  if order_total is null then
    raise exception 'Commande introuvable.';
  end if;
  select coalesce(sum(amount), 0) into already_paid from public.payments
    where order_id = new.order_id and workshop_id = new.workshop_id;
  if new.amount <= 0 or already_paid + new.amount > order_total then
    raise exception 'Le paiement doit être positif et ne peut pas dépasser le solde restant.';
  end if;
  return new;
end;
$$;

create trigger payments_validate before insert on public.payments
for each row execute function public.validate_payment();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger workshops_updated_at before update on public.workshops for each row execute function public.set_updated_at();
create trigger clients_updated_at before update on public.clients for each row execute function public.set_updated_at();
create trigger garment_models_updated_at before update on public.garment_models for each row execute function public.set_updated_at();
create trigger orders_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger subscriptions_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.workshops enable row level security;
alter table public.clients enable row level security;
alter table public.measurements enable row level security;
alter table public.garment_models enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_events enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "workshops_select_own" on public.workshops for select to authenticated using (owner_id = (select auth.uid()));
create policy "workshops_update_own" on public.workshops for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy "clients_select_own" on public.clients for select to authenticated using (workshop_id = (select public.current_workshop_id()));
create policy "clients_insert_own" on public.clients for insert to authenticated with check (workshop_id = (select public.current_workshop_id()));
create policy "clients_update_own" on public.clients for update to authenticated using (workshop_id = (select public.current_workshop_id())) with check (workshop_id = (select public.current_workshop_id()));
create policy "clients_delete_own" on public.clients for delete to authenticated using (workshop_id = (select public.current_workshop_id()) and archived_at is not null);

create policy "measurements_select_own" on public.measurements for select to authenticated using (workshop_id = (select public.current_workshop_id()));
create policy "measurements_insert_own" on public.measurements for insert to authenticated with check (workshop_id = (select public.current_workshop_id()));
create policy "measurements_update_own" on public.measurements for update to authenticated using (workshop_id = (select public.current_workshop_id())) with check (workshop_id = (select public.current_workshop_id()));
create policy "measurements_delete_own" on public.measurements for delete to authenticated using (workshop_id = (select public.current_workshop_id()));

create policy "models_select_own" on public.garment_models for select to authenticated using (workshop_id = (select public.current_workshop_id()));
create policy "models_insert_own" on public.garment_models for insert to authenticated with check (workshop_id = (select public.current_workshop_id()));
create policy "models_update_own" on public.garment_models for update to authenticated using (workshop_id = (select public.current_workshop_id())) with check (workshop_id = (select public.current_workshop_id()));
create policy "models_delete_own" on public.garment_models for delete to authenticated using (workshop_id = (select public.current_workshop_id()) and archived_at is not null);

create policy "orders_select_own" on public.orders for select to authenticated using (workshop_id = (select public.current_workshop_id()));
create policy "orders_update_own" on public.orders for update to authenticated using (workshop_id = (select public.current_workshop_id())) with check (workshop_id = (select public.current_workshop_id()));
create policy "orders_delete_own" on public.orders for delete to authenticated using (workshop_id = (select public.current_workshop_id()) and archived_at is not null);

create policy "items_select_own" on public.order_items for select to authenticated using (workshop_id = (select public.current_workshop_id()));
create policy "items_insert_own" on public.order_items for insert to authenticated with check (workshop_id = (select public.current_workshop_id()));
create policy "items_update_own" on public.order_items for update to authenticated using (workshop_id = (select public.current_workshop_id())) with check (workshop_id = (select public.current_workshop_id()));
create policy "items_delete_own" on public.order_items for delete to authenticated using (workshop_id = (select public.current_workshop_id()));

create policy "payments_select_own" on public.payments for select to authenticated using (workshop_id = (select public.current_workshop_id()));
create policy "payments_insert_own" on public.payments for insert to authenticated with check (workshop_id = (select public.current_workshop_id()) and created_by = (select auth.uid()));

create policy "subscriptions_select_own" on public.subscriptions for select to authenticated using (workshop_id = (select public.current_workshop_id()));
create policy "audit_select_own" on public.audit_events for select to authenticated using (workshop_id = (select public.current_workshop_id()));
create policy "audit_insert_own" on public.audit_events for insert to authenticated with check (workshop_id = (select public.current_workshop_id()) and actor_id = (select auth.uid()));
