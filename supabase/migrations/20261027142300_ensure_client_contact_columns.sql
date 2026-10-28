alter table public.clients
  add column if not exists email text,
  add column if not exists gender text;

alter table public.clients
  drop constraint if exists clients_gender_check;

alter table public.clients
  add constraint clients_gender_check
  check (gender is null or gender in ('woman', 'man', 'boy', 'girl', 'other', 'unspecified'));

notify pgrst, 'reload schema';
