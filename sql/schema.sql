-- ============================================================
-- SahaYog — Supabase schema
-- Run this once in your Supabase project's SQL editor
-- (Project → SQL Editor → New query → paste → Run)
-- ============================================================

-- --------------------------------------------------------------
-- 1. Tables
-- --------------------------------------------------------------

create table if not exists cooperatives (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('household','worker','admin')),
  phone text,
  cooperative_id uuid references cooperatives(id),
  created_at timestamptz default now()
);

create table if not exists workers (
  profile_id uuid primary key references profiles(id) on delete cascade,
  cooperative_id uuid references cooperatives(id),
  skill_category text not null,
  verified boolean not null default false,
  available boolean not null default true,
  rating numeric(3,2) not null default 4.5,
  jobs_completed int not null default 0,
  created_at timestamptz default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references profiles(id),
  worker_id uuid not null references profiles(id),
  cooperative_id uuid references cooperatives(id),
  service_category text not null,
  address text not null,
  scheduled_time timestamptz not null,
  price numeric(10,2) not null,
  status text not null default 'pending'
    check (status in ('pending','accepted','completed','declined','disputed')),
  created_at timestamptz default now()
);

create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  raised_by uuid not null references profiles(id),
  description text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz default now()
);

-- --------------------------------------------------------------
-- 2. Auto-create a profile row whenever someone signs up
--    (reads the metadata passed to supabase.auth.signUp())
-- --------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role, phone, cooperative_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'New user'),
    coalesce(new.raw_user_meta_data->>'role', 'household'),
    new.raw_user_meta_data->>'phone',
    nullif(new.raw_user_meta_data->>'cooperative_id','')::uuid
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- --------------------------------------------------------------
-- 3. Seed one cooperative so worker/admin signup has something
--    to attach to on day one. Add more from the admin flow.
-- --------------------------------------------------------------

insert into cooperatives (name)
select 'Sahakari Seva Mandal'
where not exists (select 1 from cooperatives where name = 'Sahakari Seva Mandal');

-- --------------------------------------------------------------
-- 4. Row Level Security
--    Demo-level policies — permissive enough for a hackathon
--    prototype, scoped enough to show the shape of real rules.
--    Tighten before this becomes a production app.
-- --------------------------------------------------------------

alter table cooperatives enable row level security;
alter table profiles enable row level security;
alter table workers enable row level security;
alter table bookings enable row level security;
alter table disputes enable row level security;

-- cooperatives: anyone signed in can read (needed for signup dropdowns);
-- anyone signed in can create one (becoming its admin at signup).
create policy "coop read" on cooperatives for select using (auth.uid() is not null);
create policy "coop create" on cooperatives for insert with check (auth.uid() is not null);

-- profiles: everyone signed in can read basic profile info (names show up
-- on bookings, worker cards, dispute threads); a user can only edit their own.
create policy "profiles read" on profiles for select using (auth.uid() is not null);
create policy "profiles update own" on profiles for update using (auth.uid() = id);

-- workers: readable by anyone signed in (households need to browse them);
-- a worker can insert/update their own row; a cooperative admin can update
-- (verify) workers that belong to their own cooperative.
create policy "workers read" on workers for select using (auth.uid() is not null);
create policy "workers insert own" on workers for insert with check (auth.uid() = profile_id);
create policy "workers update own" on workers for update using (auth.uid() = profile_id);
create policy "workers update by coop admin" on workers for update using (
  exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.cooperative_id = workers.cooperative_id
  )
);

-- bookings: household creates them; household, the assigned worker, and the
-- cooperative's admin can all see them; worker can update status (accept/
-- complete/decline) on jobs assigned to them; admin can update within coop.
create policy "bookings read involved" on bookings for select using (
  auth.uid() = household_id
  or auth.uid() = worker_id
  or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.cooperative_id = bookings.cooperative_id)
);
create policy "bookings insert by household" on bookings for insert with check (auth.uid() = household_id);
create policy "bookings update by worker" on bookings for update using (auth.uid() = worker_id or auth.uid() = household_id);
create policy "bookings update by coop admin" on bookings for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.cooperative_id = bookings.cooperative_id)
);

-- disputes: readable/insertable by whoever is party to the underlying
-- booking, or the cooperative's admin; only the admin resolves them.
create policy "disputes read involved" on disputes for select using (
  exists (
    select 1 from bookings b where b.id = disputes.booking_id
    and (b.household_id = auth.uid() or b.worker_id = auth.uid()
         or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.cooperative_id = b.cooperative_id))
  )
);
create policy "disputes insert by party" on disputes for insert with check (auth.uid() = raised_by);
create policy "disputes update by coop admin" on disputes for update using (
  exists (
    select 1 from bookings b
    join profiles p on p.id = auth.uid()
    where b.id = disputes.booking_id and p.role = 'admin' and p.cooperative_id = b.cooperative_id
  )
);
