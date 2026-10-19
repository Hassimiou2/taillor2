insert into public.profiles (id, full_name)
select
  users.id,
  coalesce(nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''), '')
from auth.users as users
on conflict (id) do nothing;

insert into public.workshops (owner_id, name)
select
  users.id,
  coalesce(nullif(trim(users.raw_user_meta_data ->> 'workshop_name'), ''), 'Mon atelier')
from auth.users as users
on conflict (owner_id) do nothing;

insert into public.subscriptions (workshop_id, plan)
select workshops.id, 'free'
from public.workshops as workshops
on conflict (workshop_id) do nothing;
