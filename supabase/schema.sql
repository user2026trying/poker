-- ============================================================================
--  POKER PLATFORM — FAZA 1 : DATABAZA
--  Ekzekutoje të gjithë këtë skedar NJË HERË te Supabase -> SQL Editor.
--
--  Parimi i sigurisë: lojtarët mund vetëm të LEXOJNË të dhënat që u lejohen.
--  Çdo ndryshim (Coins, ulje në tavolinë, krijim llogarie) bëhet vetëm nga
--  funksionet më poshtë, të cilat ekzekutohen në server dhe kontrollojnë çdo gjë.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- 1. TABELAT
-- ----------------------------------------------------------------------------

-- Llogaritë (lojtarët dhe Head Office). Password-i ruhet i enkriptuar nga Supabase Auth.
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  role         text not null default 'player' check (role in ('player', 'head_office')),
  coins        bigint not null default 0 check (coins >= 0),   -- bilanci nuk bëhet kurrë negativ
  is_active    boolean not null default true,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

-- Tavolinat e Poker-it.
create table public.poker_tables (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  max_seats    int not null check (max_seats in (2, 6, 9)),
  small_blind  bigint not null check (small_blind > 0),
  big_blind    bigint not null check (big_blind >= small_blind),
  buy_in       bigint not null check (buy_in > 0),
  rake_percent numeric(5, 2) not null default 1 check (rake_percent >= 0 and rake_percent <= 10),
  rake_cap     bigint not null check (rake_cap >= 0),           -- rake maksimal për një dorë
  status       text not null default 'waiting' check (status in ('waiting', 'playing')),
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

-- Vendet e zëna. Një lojtar mund të jetë ulur vetëm në NJË tavolinë njëkohësisht.
create table public.table_seats (
  table_id  uuid not null references public.poker_tables (id) on delete cascade,
  seat_no   int not null check (seat_no >= 1),
  player_id uuid not null unique references public.profiles (id) on delete cascade,
  username  text not null,
  stack     bigint not null check (stack >= 0),
  joined_at timestamptz not null default now(),
  primary key (table_id, seat_no)
);

-- Historiku i çdo ndryshimi të bilancit.
create table public.coin_transactions (
  id            bigint generated always as identity primary key,
  player_id     uuid not null references public.profiles (id) on delete cascade,
  amount        bigint not null,            -- pozitiv = shtim, negativ = zbritje
  balance_after bigint not null,
  kind          text not null check (kind in ('initial', 'admin_add', 'admin_remove', 'buy_in', 'cash_out')),
  table_id      uuid references public.poker_tables (id) on delete set null,
  created_by    uuid,
  note          text,
  created_at    timestamptz not null default now()
);
create index coin_transactions_player_idx on public.coin_transactions (player_id, created_at desc);

-- Bilanci i platformës (Coins nga Rake). Ka vetëm një rresht.
create table public.platform_account (
  id           int primary key default 1 check (id = 1),
  rake_balance bigint not null default 0 check (rake_balance >= 0)
);
insert into public.platform_account (id) values (1);

-- ----------------------------------------------------------------------------
-- 2. FUNKSIONE NDIHMËSE TË BRENDSHME (nuk mund të thirren nga browser-i)
-- ----------------------------------------------------------------------------

create function public.is_head_office() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'head_office' and is_active
  );
$$;

create function public._require_head_office() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_head_office() then
    raise exception 'Nuk ke leje për këtë veprim.';
  end if;
end;
$$;

-- Krijon përdoruesin te Supabase Auth (password-i ruhet si bcrypt hash).
create function public._create_auth_user(p_username text, p_password text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id    uuid := gen_random_uuid();
  v_user  text := lower(trim(p_username));
  v_email text;
begin
  if v_user !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username duhet të ketë 3-20 karaktere (shkronja, numra ose _).';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Password duhet të ketë të paktën 6 karaktere.';
  end if;
  if exists (select 1 from public.profiles where username = v_user) then
    raise exception 'Ky username ekziston tashmë.';
  end if;
  v_email := v_user || '@poker.local';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_id, v_id::text, 'email',
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    now(), now(), now()
  );

  return v_id;
end;
$$;

-- I VETMI vend ku ndryshon bilanci i një lojtari. Kyç rreshtin, kontrollon, regjistron.
create function public._change_coins(
  p_player uuid, p_amount bigint, p_kind text, p_table uuid default null, p_note text default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_balance bigint;
begin
  select coins into v_balance from public.profiles where id = p_player for update;
  if not found then
    raise exception 'Lojtari nuk u gjet.';
  end if;
  if v_balance + p_amount < 0 then
    raise exception 'Bilanci i pamjaftueshëm (bilanci aktual: % Coins).', v_balance;
  end if;
  update public.profiles set coins = v_balance + p_amount where id = p_player;
  insert into public.coin_transactions (player_id, amount, balance_after, kind, table_id, created_by, note)
  values (p_player, p_amount, v_balance + p_amount, p_kind, p_table, auth.uid(), nullif(trim(p_note), ''));
  return v_balance + p_amount;
end;
$$;

-- Largon lojtarin nga tavolina dhe i kthen Stack-un në bilanc.
create function public._cash_out(p_player uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_seat public.table_seats;
begin
  perform 1 from public.profiles where id = p_player for update;
  delete from public.table_seats where player_id = p_player returning * into v_seat;
  if not found then
    return 0;
  end if;
  if v_seat.stack > 0 then
    perform public._change_coins(p_player, v_seat.stack, 'cash_out', v_seat.table_id);
  end if;
  return v_seat.stack;
end;
$$;

-- Krijimi i llogarisë Head Office. Thirret VETËM nga SQL Editor (shih udhëzimet).
create function public.create_head_office(p_username text, p_password text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  v_id := public._create_auth_user(p_username, p_password);
  insert into public.profiles (id, username, role) values (v_id, lower(trim(p_username)), 'head_office');
  return 'Head Office u krijua: ' || lower(trim(p_username));
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. FUNKSIONET E HEAD OFFICE
-- ----------------------------------------------------------------------------

create function public.admin_create_player(p_username text, p_password text, p_coins bigint default 0)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public._require_head_office();
  if p_coins is null or p_coins < 0 then
    raise exception 'Coins fillestare nuk mund të jenë negative.';
  end if;
  v_id := public._create_auth_user(p_username, p_password);
  insert into public.profiles (id, username, role) values (v_id, lower(trim(p_username)), 'player');
  if p_coins > 0 then
    perform public._change_coins(v_id, p_coins, 'initial');
  end if;
  return v_id;
end;
$$;

-- p_amount pozitiv = shton Coins, negativ = heq Coins.
create function public.admin_adjust_coins(p_player_id uuid, p_amount bigint, p_note text default null)
returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_head_office();
  if p_amount is null or p_amount = 0 then
    raise exception 'Shuma duhet të jetë më e madhe se 0.';
  end if;
  if not exists (select 1 from public.profiles where id = p_player_id and role = 'player') then
    raise exception 'Lojtari nuk u gjet.';
  end if;
  return public._change_coins(
    p_player_id, p_amount,
    case when p_amount > 0 then 'admin_add' else 'admin_remove' end,
    null, p_note
  );
end;
$$;

create function public.admin_set_active(p_player_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_head_office();
  update public.profiles set is_active = p_active where id = p_player_id and role = 'player';
  if not found then
    raise exception 'Lojtari nuk u gjet.';
  end if;
  if p_active then
    update auth.users set banned_until = null where id = p_player_id;
  else
    perform public._cash_out(p_player_id);                       -- Stack-u kthehet në bilanc
    update auth.users set banned_until = now() + interval '100 years' where id = p_player_id;
    delete from auth.sessions where user_id = p_player_id;       -- del menjëherë nga llogaria
  end if;
end;
$$;

create function public.admin_reset_password(p_player_id uuid, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_head_office();
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Password duhet të ketë të paktën 6 karaktere.';
  end if;
  if not exists (select 1 from public.profiles where id = p_player_id and role = 'player') then
    raise exception 'Lojtari nuk u gjet.';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_player_id;
  delete from auth.sessions where user_id = p_player_id;
end;
$$;

create function public.admin_update_rake(p_table_id uuid, p_percent numeric, p_cap bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._require_head_office();
  if p_percent is null or p_percent < 0 or p_percent > 10 then
    raise exception 'Rake duhet të jetë nga 0%% deri në 10%%.';
  end if;
  if p_cap is null or p_cap < 0 then
    raise exception 'Maximum Rake nuk mund të jetë negativ.';
  end if;
  update public.poker_tables set rake_percent = p_percent, rake_cap = p_cap where id = p_table_id;
  if not found then
    raise exception 'Tavolina nuk u gjet.';
  end if;
end;
$$;

create function public.admin_dashboard() returns json
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._require_head_office();
  return json_build_object(
    'total_players',  (select count(*) from public.profiles where role = 'player'),
    'online_players', (select count(*) from public.profiles
                        where role = 'player' and last_seen_at > now() - interval '90 seconds'),
    'total_coins',    (select coalesce(sum(coins), 0) from public.profiles where role = 'player')
                    + (select coalesce(sum(stack), 0) from public.table_seats),
    'total_rake',     (select rake_balance from public.platform_account where id = 1)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. FUNKSIONET E LOJTARIT
-- ----------------------------------------------------------------------------

-- Ulja në tavolinë: paguhet Buy-in nga bilanci dhe bëhet Stack. Gjithçka në një transaksion.
create function public.join_table(p_table_id uuid, p_seat int default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles;
  v_table   public.poker_tables;
  v_seat    int;
begin
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found or not v_profile.is_active or v_profile.role <> 'player' then
    raise exception 'Llogaria nuk lejohet të luajë.';
  end if;

  -- Kyçja e tavolinës: dy lojtarë nuk mund të marrin të njëjtin vend në të njëjtën kohë.
  select * into v_table from public.poker_tables where id = p_table_id for update;
  if not found then
    raise exception 'Tavolina nuk u gjet.';
  end if;
  if exists (select 1 from public.table_seats where player_id = v_uid) then
    raise exception 'Je tashmë i ulur në një tavolinë.';
  end if;
  if (select count(*) from public.table_seats where table_id = p_table_id) >= v_table.max_seats then
    raise exception 'Tavolina është plot.';
  end if;

  if p_seat is null then
    select s into v_seat from generate_series(1, v_table.max_seats) s
     where not exists (select 1 from public.table_seats t where t.table_id = p_table_id and t.seat_no = s)
     order by s limit 1;
  else
    if p_seat < 1 or p_seat > v_table.max_seats then
      raise exception 'Vend i pavlefshëm.';
    end if;
    if exists (select 1 from public.table_seats where table_id = p_table_id and seat_no = p_seat) then
      raise exception 'Ky vend është i zënë.';
    end if;
    v_seat := p_seat;
  end if;

  if v_profile.coins < v_table.buy_in then
    raise exception 'Nuk ke Coins të mjaftueshme. Buy-in: % Coins.', v_table.buy_in;
  end if;

  perform public._change_coins(v_uid, -v_table.buy_in, 'buy_in', p_table_id);
  insert into public.table_seats (table_id, seat_no, player_id, username, stack)
  values (p_table_id, v_seat, v_uid, v_profile.username, v_table.buy_in);
  return v_seat;
end;
$$;

-- Largimi nga tavolina: Stack-u i mbetur kthehet në bilanc. Kthen shumën e kthyer.
create function public.leave_table() returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Duhet të jesh i kyçur.';
  end if;
  return public._cash_out(auth.uid());
end;
$$;

-- "Jam online" — thirret automatikisht çdo 30 sekonda nga aplikacioni.
create function public.heartbeat() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_seen_at = now() where id = auth.uid() and is_active;
$$;

-- ----------------------------------------------------------------------------
-- 5. SIGURIA : Row Level Security + lejet
-- ----------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.poker_tables      enable row level security;
alter table public.table_seats       enable row level security;
alter table public.coin_transactions enable row level security;
alter table public.platform_account  enable row level security;

-- Askush nuk mund të shkruajë direkt në tabela; vetëm lexim, dhe vetëm sipas rregullave më poshtë.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles, public.poker_tables, public.table_seats,
                public.coin_transactions, public.platform_account to authenticated;

create policy "profili im ose head office" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or public.is_head_office());

create policy "tavolinat i shohin te gjithe" on public.poker_tables
  for select to authenticated using (true);

create policy "vendet i shohin te gjithe" on public.table_seats
  for select to authenticated using (true);

create policy "transaksionet e mia ose head office" on public.coin_transactions
  for select to authenticated using (player_id = (select auth.uid()) or public.is_head_office());

create policy "bilanci i platformes vetem head office" on public.platform_account
  for select to authenticated using (public.is_head_office());

-- Funksionet: fillimisht hiqen të gjitha lejet, pastaj lejohen vetëm ato publike.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_head_office(),
  public.admin_create_player(text, text, bigint),
  public.admin_adjust_coins(uuid, bigint, text),
  public.admin_set_active(uuid, boolean),
  public.admin_reset_password(uuid, text),
  public.admin_update_rake(uuid, numeric, bigint),
  public.admin_dashboard(),
  public.join_table(uuid, int),
  public.leave_table(),
  public.heartbeat()
to authenticated;

-- ----------------------------------------------------------------------------
-- 6. REALTIME : ndryshimet dërgohen live te browser-i
-- ----------------------------------------------------------------------------

alter publication supabase_realtime add table public.profiles, public.poker_tables, public.table_seats;

-- ----------------------------------------------------------------------------
-- 7. TAVOLINAT FILLESTARE  (Rake 1%, Maximum Rake = 3 x Big Blind)
-- ----------------------------------------------------------------------------

insert into public.poker_tables (name, max_seats, small_blind, big_blind, buy_in, rake_cap, sort_order) values
  ('Duel I',      2,   5,   10,  1000,  30, 1),
  ('Duel II',     2,  25,   50,  5000, 150, 2),
  ('Duel III',    2, 100,  200, 20000, 600, 3),
  ('Rapid I',     6,   5,   10,  1000,  30, 1),
  ('Rapid II',    6,  25,   50,  5000, 150, 2),
  ('Rapid III',   6, 100,  200, 20000, 600, 3),
  ('Classic I',   9,   5,   10,  1000,  30, 1),
  ('Classic II',  9,  25,   50,  5000, 150, 2),
  ('Classic III', 9, 100,  200, 20000, 600, 3);
