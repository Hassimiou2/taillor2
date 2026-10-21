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
  plan_limit := case selected_plan when 'free' then 10 when 'pro' then 50 else null end;
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
