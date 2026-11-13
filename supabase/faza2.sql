-- ============================================================================
--  POKER PLATFORM — FAZA 2 : TEXAS HOLD'EM GAME ENGINE
--  Ekzekutoje NJË HERË te Supabase -> SQL Editor (pasi ke ekzekutuar schema.sql).
--
--  E gjithë loja luhet në server (brenda databazës):
--   * kartat përzihen me gjenerator kriptografik (gen_random_bytes)
--   * kartat private ruhen në tabela që browser-i NUK mund t'i lexojë
--   * çdo veprim kontrollohet: radha, shuma, minimum raise, bilanci
--   * fituesi, side pots dhe rake llogariten vetëm këtu
--
--  Kartat janë numra 0..51 :  rank = numri / 4  (0 = "2" ... 12 = "A")
--                             suit = numri % 4  (0 ♠, 1 ♥, 2 ♦, 3 ♣)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. KOLONAT DHE TABELAT E REJA
-- ----------------------------------------------------------------------------

alter table public.poker_tables
  add column hand_no       bigint not null default 0,
  add column stage         text not null default 'idle'
                           check (stage in ('idle', 'preflop', 'flop', 'turn', 'river', 'showdown')),
  add column dealer_seat   int,
  add column sb_seat       int,
  add column bb_seat       int,
  add column board         int[] not null default '{}',     -- kartat e përbashkëta (vetëm të hapurat)
  add column pot           bigint not null default 0,
  add column current_bet   bigint not null default 0,       -- basti më i lartë në këtë raund
  add column min_raise     bigint not null default 0,       -- madhësia minimale e raise-it
  add column turn_seat     int,
  add column turn_deadline timestamptz,
  add column saw_flop      boolean not null default false,  -- për "No Flop, No Drop"
  add column action_seq    bigint not null default 0,       -- mbrojtje nga veprimet e dyfishta
  add column next_hand_at  timestamptz,
  add column last_result   jsonb;

alter table public.table_seats
  add column in_hand     boolean not null default false,
  add column bet_round   bigint not null default 0,          -- e vënë në këtë raund
  add column bet_total   bigint not null default 0,          -- e vënë në gjithë dorën
  add column folded      boolean not null default false,
  add column all_in      boolean not null default false,
  add column acted       boolean not null default false,
  add column last_action text,
  add column shown_cards int[],                              -- hapen vetëm në showdown
  add column hand_score  bigint,
  add column hand_name   text,
  add column won         bigint not null default 0,
  add column sitting_out boolean not null default false,
  add column sit_out_at  timestamptz,
  add column leaving     boolean not null default false;

-- Kartat private. Asnjë browser nuk ka leje leximi; jepen vetëm përmes table_state().
create table public.hole_cards (
  table_id  uuid not null references public.poker_tables (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  cards     int[] not null,
  primary key (table_id, player_id)
);

-- Pjesa e mbetur e paketës së kartave për dorën aktuale.
create table public.hand_private (
  table_id uuid primary key references public.poker_tables (id) on delete cascade,
  deck     int[] not null
);

-- Regjistri i çdo dore të përfunduar (pot, rake, fituesit).
create table public.hand_history (
  id       bigint generated always as identity primary key,
  table_id uuid not null references public.poker_tables (id) on delete cascade,
  hand_no  bigint not null,
  board    int[] not null,
  pot      bigint not null,
  rake     bigint not null,
  result   jsonb not null,
  ended_at timestamptz not null default now(),
  unique (table_id, hand_no)                                 -- një dorë regjistrohet vetëm një herë
);

alter table public.hole_cards   enable row level security;
alter table public.hand_private enable row level security;
alter table public.hand_history enable row level security;
revoke all on public.hole_cards, public.hand_private, public.hand_history from anon, authenticated;
grant select on public.hand_history to authenticated;
create policy "historiku vetem head office" on public.hand_history
  for select to authenticated using (public.is_head_office());

-- ----------------------------------------------------------------------------
-- 2. VLERËSIMI I DORËS (7 karta -> një numër; numri më i madh fiton)
-- ----------------------------------------------------------------------------

create function public._enc(p_cat int, p_v int[]) returns bigint
language plpgsql immutable set search_path = '' as $$
declare
  v bigint := p_cat;
begin
  for i in 1..5 loop
    v := v * 13 + coalesce(p_v[i], 0);
  end loop;
  return v;
end;
$$;

-- Karta më e lartë e një Straight nga maska e rank-eve, ose -1. (A-2-3-4-5 kthen 3 = "5")
create function public._straight_top(p_mask int) returns int
language plpgsql immutable set search_path = '' as $$
begin
  for top in reverse 12..4 loop
    if (p_mask >> (top - 4)) & 31 = 31 then
      return top;
    end if;
  end loop;
  if p_mask & 4111 = 4111 then   -- A + 2,3,4,5
    return 3;
  end if;
  return -1;
end;
$$;

create function public._hand_score(p int[]) returns bigint
language plpgsql immutable set search_path = '' as $$
declare
  rc int[] := array_fill(0, array[13]);
  sc int[] := array_fill(0, array[4]);
  sm int[] := array_fill(0, array[4]);
  rmask int := 0;
  c int; r int; s int; top int;
  quads int[] := '{}'; trips int[] := '{}'; pairs int[] := '{}'; singles int[] := '{}'; fl int[] := '{}';
begin
  foreach c in array p loop
    r := c / 4; s := c % 4;
    rc[r + 1] := rc[r + 1] + 1;
    sc[s + 1] := sc[s + 1] + 1;
    sm[s + 1] := sm[s + 1] | (1 << r);
    rmask := rmask | (1 << r);
  end loop;

  for s in 1..4 loop
    if sc[s] >= 5 then
      top := public._straight_top(sm[s]);
      if top >= 0 then
        return public._enc(8, array[top]);                         -- Straight Flush / Royal Flush
      end if;
      for r in reverse 12..0 loop
        if (sm[s] >> r) & 1 = 1 and coalesce(array_length(fl, 1), 0) < 5 then
          fl := fl || r;
        end if;
      end loop;
    end if;
  end loop;

  for r in reverse 12..0 loop
    if rc[r + 1] = 4 then quads := quads || r;
    elsif rc[r + 1] = 3 then trips := trips || r;
    elsif rc[r + 1] = 2 then pairs := pairs || r;
    elsif rc[r + 1] = 1 then singles := singles || r;
    end if;
  end loop;

  if array_length(quads, 1) >= 1 then                              -- Four of a Kind
    return public._enc(7, array[quads[1],
      greatest(coalesce(trips[1], -1), coalesce(pairs[1], -1), coalesce(singles[1], -1))]);
  end if;
  if array_length(trips, 1) >= 2 or (array_length(trips, 1) = 1 and array_length(pairs, 1) >= 1) then
    return public._enc(6, array[trips[1], greatest(coalesce(trips[2], -1), coalesce(pairs[1], -1))]);  -- Full House
  end if;
  if array_length(fl, 1) = 5 then
    return public._enc(5, fl);                                     -- Flush
  end if;
  top := public._straight_top(rmask);
  if top >= 0 then
    return public._enc(4, array[top]);                             -- Straight
  end if;
  if array_length(trips, 1) = 1 then
    return public._enc(3, array[trips[1], singles[1], singles[2]]);  -- Three of a Kind
  end if;
  if array_length(pairs, 1) >= 2 then                              -- Two Pair
    return public._enc(2, array[pairs[1], pairs[2],
      greatest(coalesce(pairs[3], -1), coalesce(singles[1], -1))]);
  end if;
  if array_length(pairs, 1) = 1 then
    return public._enc(1, array[pairs[1], singles[1], singles[2], singles[3]]);  -- One Pair
  end if;
  return public._enc(0, singles[1:5]);                             -- High Card
end;
$$;

create function public._hand_name(p_score bigint) returns text
language sql immutable set search_path = '' as $$
  select case p_score / 371293
    when 8 then case when (p_score % 371293) / 28561 = 12 then 'Royal Flush' else 'Straight Flush' end
    when 7 then 'Four of a Kind'
    when 6 then 'Full House'
    when 5 then 'Flush'
    when 4 then 'Straight'
    when 3 then 'Three of a Kind'
    when 2 then 'Two Pair'
    when 1 then 'One Pair'
    else 'High Card'
  end;
$$;

-- ----------------------------------------------------------------------------
-- 3. MOTORI I LOJËS (funksione të brendshme)
-- ----------------------------------------------------------------------------

-- Largimi nga tavolina. Zëvendëson versionin e Fazës 1: tani di të trajtojë edhe dorën aktive.
create or replace function public._cash_out(p_player uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_table uuid;
  t       public.poker_tables;
  s       public.table_seats;
begin
  select table_id into v_table from public.table_seats where player_id = p_player;
  if v_table is null then
    return 0;
  end if;
  select * into t from public.poker_tables where id = v_table for update;
  select * into s from public.table_seats where player_id = p_player and table_id = v_table;
  if not found or s.leaving then
    return 0;
  end if;

  if s.in_hand and t.stage in ('preflop', 'flop', 'turn', 'river') then
    -- Dora vazhdon: Coins që ka vënë në pot mbeten aty; vendi lirohet kur mbaron dora.
    if s.all_in and not s.folded then
      update public.table_seats set leaving = true where player_id = p_player;  -- fitimi paguhet në fund
      return 0;
    end if;
    update public.table_seats
       set leaving = true, folded = true, stack = 0, acted = true,
           last_action = case when folded then last_action else 'Fold' end
     where player_id = p_player;
    if s.stack > 0 then
      perform public._change_coins(p_player, s.stack, 'cash_out', v_table);
    end if;
    if not s.folded then
      if t.turn_seat = s.seat_no then
        perform public._progress(v_table, s.seat_no, false);
      else
        perform public._progress(v_table, t.turn_seat, true);
      end if;
    end if;
    return s.stack;
  end if;

  delete from public.table_seats where player_id = p_player;
  if s.stack > 0 then
    perform public._change_coins(p_player, s.stack, 'cash_out', v_table);
  end if;
  return s.stack;
end;
$$;

-- Largon lojtarët që kanë mbetur "larg tavolinës" më shumë se 5 minuta.
create function public._expire_sitouts(p_table uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in
    select player_id from public.table_seats
     where table_id = p_table and sitting_out and sit_out_at < now() - interval '5 minutes'
  loop
    perform public._cash_out(r.player_id);
  end loop;
end;
$$;

-- Pastron tavolinën pas një dore.
create function public._cleanup(p_table uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  update public.poker_tables
     set stage = 'idle', status = 'waiting', board = '{}', pot = 0, current_bet = 0, min_raise = 0,
         turn_seat = null, turn_deadline = null, next_hand_at = null, last_result = null,
         sb_seat = null, bb_seat = null, action_seq = action_seq + 1
   where id = p_table;
  delete from public.hole_cards where table_id = p_table;
  delete from public.hand_private where table_id = p_table;

  for r in select * from public.table_seats where table_id = p_table and (leaving or stack = 0) loop
    delete from public.table_seats where table_id = p_table and seat_no = r.seat_no;
    if r.stack > 0 then
      perform public._change_coins(r.player_id, r.stack, 'cash_out', p_table);
    end if;
  end loop;

  update public.table_seats
     set in_hand = false, bet_round = 0, bet_total = 0, folded = false, all_in = false, acted = false,
         last_action = null, shown_cards = null, hand_score = null, hand_name = null, won = 0
   where table_id = p_table;

  perform public._expire_sitouts(p_table);
end;
$$;

-- Mbyll dorën: kthen bastin e papaguar, llogarit rake, side pots dhe fituesit.
create function public._finish_hand(p_table uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.poker_tables;
  v_top_seat int; v_top1 bigint; v_top2 bigint;
  v_total bigint; v_rake bigint := 0; v_taken bigint := 0;
  v_alive int; v_show boolean;
  v_levels bigint[]; v_lvl bigint; v_last bigint; v_prev bigint := 0;
  v_pot bigint; v_pot_rake bigint; v_net bigint;
  v_best bigint; v_winners int[]; v_n int; v_share bigint;
begin
  select * into t from public.poker_tables where id = p_table;
  if t.stage not in ('preflop', 'flop', 'turn', 'river') then
    return;                                    -- dora është mbyllur tashmë: asgjë nuk paguhet dy herë
  end if;

  -- 1) Basti që askush nuk e pagoi i kthehet lojtarit (nuk është pjesë e pot-it real).
  select seat_no, bet_total into v_top_seat, v_top1 from public.table_seats
   where table_id = p_table and in_hand order by bet_total desc, seat_no limit 1;
  select coalesce(max(bet_total), 0) into v_top2 from public.table_seats
   where table_id = p_table and in_hand and seat_no <> v_top_seat;
  if v_top1 > v_top2 then
    update public.table_seats set stack = stack + (v_top1 - v_top2), bet_total = v_top2
     where table_id = p_table and seat_no = v_top_seat;
  end if;

  select coalesce(sum(bet_total), 0), count(*) filter (where not folded) into v_total, v_alive
    from public.table_seats where table_id = p_table and in_hand;
  v_show := v_alive >= 2;

  -- 2) Rake: NO FLOP, NO DROP. Llogaritet një herë mbi pot-in real, me kufirin e tavolinës.
  if t.saw_flop then
    v_rake := least(floor(v_total * t.rake_percent / 100)::bigint, t.rake_cap);
  end if;

  -- 3) Showdown: hapen kartat e lojtarëve që nuk kanë bërë Fold.
  if v_show then
    update public.table_seats s
       set shown_cards = h.cards, hand_score = public._hand_score(h.cards || t.board)
      from public.hole_cards h
     where h.table_id = p_table and h.player_id = s.player_id
       and s.table_id = p_table and s.in_hand and not s.folded;
    update public.table_seats set hand_name = public._hand_name(hand_score)
     where table_id = p_table and hand_score is not null;
  end if;

  -- 4) Main pot + side pots. Çdo nivel bastesh krijon një pot më vete.
  select array_agg(distinct bet_total order by bet_total) into v_levels from public.table_seats
   where table_id = p_table and in_hand and not folded and bet_total > 0;
  v_last := v_levels[array_length(v_levels, 1)];

  foreach v_lvl in array coalesce(v_levels, '{}') loop
    select coalesce(sum((case when v_lvl = v_last then bet_total else least(bet_total, v_lvl) end)
                        - least(bet_total, v_prev)), 0)
      into v_pot from public.table_seats where table_id = p_table and in_hand;

    -- Rake ndahet në proporcion mes pot-eve; shuma totale nuk e kalon kurrë v_rake.
    if v_lvl = v_last then
      v_pot_rake := v_rake - v_taken;
    else
      v_pot_rake := floor(v_rake::numeric * v_pot / v_total)::bigint;
    end if;
    v_pot_rake := least(v_pot_rake, v_pot);
    v_taken := v_taken + v_pot_rake;
    v_net := v_pot - v_pot_rake;

    if v_show then
      select max(hand_score) into v_best from public.table_seats
       where table_id = p_table and in_hand and not folded and bet_total >= v_lvl;
      select array_agg(seat_no order by (seat_no > t.dealer_seat) desc, seat_no) into v_winners
        from public.table_seats
       where table_id = p_table and in_hand and not folded and bet_total >= v_lvl and hand_score = v_best;
    else
      select array_agg(seat_no) into v_winners from public.table_seats
       where table_id = p_table and in_hand and not folded;
    end if;

    -- Split pot: ndarje e barabartë; Coins teke i merr lojtari i parë majtas Dealer-it.
    v_n := coalesce(array_length(v_winners, 1), 0);
    for i in 1..v_n loop
      v_share := v_net / v_n + (case when i <= v_net % v_n then 1 else 0 end);
      update public.table_seats set stack = stack + v_share, won = won + v_share
       where table_id = p_table and seat_no = v_winners[i];
    end loop;
    v_prev := v_lvl;
  end loop;

  -- 5) Regjistrimi: bilanci i platformës + historiku i dorës (vetëm një herë për dorë).
  update public.platform_account set rake_balance = rake_balance + v_taken where id = 1;

  insert into public.hand_history (table_id, hand_no, board, pot, rake, result)
  select p_table, t.hand_no, t.board, v_total, v_taken,
         jsonb_agg(jsonb_build_object(
           'seat', seat_no, 'username', username, 'bet', bet_total, 'won', won,
           'folded', folded, 'cards', shown_cards, 'hand', hand_name) order by seat_no)
    from public.table_seats where table_id = p_table and in_hand;

  update public.table_seats set bet_round = 0 where table_id = p_table;
  update public.poker_tables
     set stage = 'showdown', turn_seat = null, turn_deadline = null, current_bet = 0, pot = v_total,
         next_hand_at = now() + (case when v_show then interval '7 seconds' else interval '3 seconds' end),
         last_result = jsonb_build_object('pot', v_total, 'rake', v_taken, 'showdown', v_show),
         action_seq = action_seq + 1
   where id = p_table;
end;
$$;

-- Pas çdo veprimi: gjen lojtarin e radhës, ose hap kartat e raundit tjetër, ose mbyll dorën.
create function public._progress(p_table uuid, p_from int, p_inclusive boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.poker_tables;
  v_alive int; v_able int; v_next int; v_out boolean;
  d int[]; k int;
begin
  loop
    update public.poker_tables
       set pot = (select coalesce(sum(bet_total), 0) from public.table_seats where table_id = p_table and in_hand),
           action_seq = action_seq + 1
     where id = p_table returning * into t;

    select count(*) filter (where not folded), count(*) filter (where not folded and not all_in)
      into v_alive, v_able from public.table_seats where table_id = p_table and in_hand;

    if v_alive <= 1 then                       -- të gjithë bënë Fold: fiton lojtari i mbetur
      perform public._finish_hand(p_table);
      return;
    end if;

    -- Lojtari i radhës: nuk ka bërë Fold, nuk është All-in, dhe ose duhet të paguajë një bast,
    -- ose nuk ka folur ende në këtë raund (kur ka të paktën 2 lojtarë që mund të bastojnë).
    v_next := null;
    select seat_no, sitting_out into v_next, v_out from public.table_seats
     where table_id = p_table and in_hand and not folded and not all_in
       and (bet_round < t.current_bet or (not acted and v_able >= 2))
     order by (case when p_inclusive then seat_no >= p_from else seat_no > p_from end) desc, seat_no
     limit 1;

    if v_next is not null then
      update public.poker_tables
         set turn_seat = v_next,
             turn_deadline = now() + (case when v_out then interval '2 seconds' else interval '25 seconds' end)
       where id = p_table;
      return;
    end if;

    if t.stage = 'river' then                  -- raundi i fundit mbaroi: Showdown
      perform public._finish_hand(p_table);
      return;
    end if;

    -- Raundi i basteve mbaroi: hapen kartat e radhës (Flop 3, Turn 1, River 1).
    select deck into d from public.hand_private where table_id = p_table for update;
    k := case when t.stage = 'preflop' then 3 else 1 end;
    update public.hand_private set deck = d[k + 1:] where table_id = p_table;
    update public.poker_tables
       set board = board || d[1:k],
           stage = case t.stage when 'preflop' then 'flop' when 'flop' then 'turn' else 'river' end,
           saw_flop = true, current_bet = 0, min_raise = big_blind, turn_seat = null, turn_deadline = null
     where id = p_table;
    update public.table_seats
       set bet_round = 0, acted = false,
           last_action = case when folded then 'Fold' when all_in then 'All-in' else null end
     where table_id = p_table and in_hand;

    p_from := t.dealer_seat;                   -- pas Flop-it flet i pari lojtari majtas Dealer-it
    p_inclusive := false;
  end loop;
end;
$$;

-- Fillon një dorë të re: Dealer, Blinds, përzierja dhe shpërndarja e kartave.
create function public._start_hand(p_table uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.poker_tables;
  n int; v_dealer int; v_sb int; v_bb int;
  deck int[]; i int := 1; r record;
begin
  perform public._cleanup(p_table);
  select * into t from public.poker_tables where id = p_table;

  update public.table_seats set in_hand = true
   where table_id = p_table and not sitting_out and stack > 0;
  get diagnostics n = row_count;
  if n < 2 then
    update public.table_seats set in_hand = false where table_id = p_table;
    return;
  end if;

  -- Dealer Button lëviz një vend majtas (sipas orës) në çdo dorë.
  select seat_no into v_dealer from public.table_seats where table_id = p_table and in_hand
   order by (seat_no > coalesce(t.dealer_seat, 0)) desc, seat_no limit 1;
  if n = 2 then
    v_sb := v_dealer;                          -- Heads Up: Dealer është Small Blind
  else
    select seat_no into v_sb from public.table_seats where table_id = p_table and in_hand
     order by (seat_no > v_dealer) desc, seat_no limit 1;
  end if;
  select seat_no into v_bb from public.table_seats where table_id = p_table and in_hand
   order by (seat_no > v_sb) desc, seat_no limit 1;

  update public.table_seats
     set bet_round = least(stack, t.small_blind), bet_total = least(stack, t.small_blind),
         all_in = stack <= t.small_blind, stack = stack - least(stack, t.small_blind), last_action = 'SB'
   where table_id = p_table and seat_no = v_sb;
  update public.table_seats
     set bet_round = least(stack, t.big_blind), bet_total = least(stack, t.big_blind),
         all_in = stack <= t.big_blind, stack = stack - least(stack, t.big_blind), last_action = 'BB'
   where table_id = p_table and seat_no = v_bb;

  -- Përzierja: çdo kartë merr një numër të rastësishëm kriptografik dhe renditen sipas tij.
  select array_agg(c order by k) into deck
    from (select c, extensions.gen_random_bytes(16) as k from generate_series(0, 51) c) x;

  for r in select player_id from public.table_seats where table_id = p_table and in_hand order by seat_no loop
    insert into public.hole_cards (table_id, player_id, cards) values (p_table, r.player_id, deck[i:i + 1]);
    i := i + 2;
  end loop;
  insert into public.hand_private (table_id, deck) values (p_table, deck[i:52]);

  update public.poker_tables
     set hand_no = hand_no + 1, stage = 'preflop', status = 'playing',
         dealer_seat = v_dealer, sb_seat = v_sb, bb_seat = v_bb,
         current_bet = t.big_blind, min_raise = t.big_blind, saw_flop = false
   where id = p_table;

  perform public._progress(p_table, v_bb, false);   -- i pari flet lojtari pas Big Blind
end;
$$;

-- Zbaton një veprim për lojtarin në vendin e dhënë (pasi është verifikuar radha).
create function public._apply_action(p_table uuid, p_seat int, p_action text, p_amount bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.poker_tables;
  s public.table_seats;
  v_call bigint; v_pay bigint; v_target bigint; v_allin boolean; v_full boolean;
  v_action text := p_action;
begin
  select * into t from public.poker_tables where id = p_table;
  select * into s from public.table_seats where table_id = p_table and seat_no = p_seat;
  v_call := t.current_bet - s.bet_round;

  if v_action = 'allin' then
    if s.bet_round + s.stack <= t.current_bet or s.acted then
      v_action := 'call';                      -- All-in që nuk e kalon bastin = Call
    else
      v_action := 'raise';
      p_amount := s.bet_round + s.stack;
    end if;
  end if;

  if v_action = 'fold' then
    update public.table_seats set folded = true, acted = true, last_action = 'Fold'
     where table_id = p_table and seat_no = p_seat;

  elsif v_action = 'check' then
    if v_call > 0 then
      raise exception 'Nuk mund të bësh Check: ka një bast për t''u paguar.';
    end if;
    update public.table_seats set acted = true, last_action = 'Check'
     where table_id = p_table and seat_no = p_seat;

  elsif v_action = 'call' then
    if v_call <= 0 then
      raise exception 'Nuk ka bast për të paguar.';
    end if;
    v_pay := least(v_call, s.stack);
    update public.table_seats
       set stack = stack - v_pay, bet_round = bet_round + v_pay, bet_total = bet_total + v_pay,
           all_in = (v_pay = s.stack), acted = true,
           last_action = case when v_pay = s.stack then 'All-in' else 'Call' end
     where table_id = p_table and seat_no = p_seat;

  elsif v_action = 'raise' then                -- Bet dhe Raise: p_amount = basti total në këtë raund
    v_target := p_amount;
    if v_target is null or v_target <= t.current_bet then
      raise exception 'Shuma duhet të jetë më e madhe se basti aktual.';
    end if;
    if s.acted then
      raise exception 'Nuk mund të bësh Raise tani: vetëm Call ose Fold.';
    end if;
    if v_target > s.bet_round + s.stack then
      raise exception 'Nuk ke Coins të mjaftueshme.';
    end if;
    v_allin := v_target = s.bet_round + s.stack;
    v_full := v_target - t.current_bet >= t.min_raise;
    if not v_full and not v_allin then
      raise exception 'Shuma minimale është % Coins.', t.current_bet + t.min_raise;
    end if;
    v_pay := v_target - s.bet_round;
    update public.table_seats
       set stack = stack - v_pay, bet_round = v_target, bet_total = bet_total + v_pay,
           all_in = v_allin, acted = true,
           last_action = case when v_allin then 'All-in' when t.current_bet = 0 then 'Bet' else 'Raise' end
     where table_id = p_table and seat_no = p_seat;
    if v_full then
      -- Raise i plotë: të gjithë lojtarët e tjerë duhet të flasin përsëri.
      update public.poker_tables set min_raise = v_target - t.current_bet, current_bet = v_target where id = p_table;
      update public.table_seats set acted = false
       where table_id = p_table and in_hand and not folded and not all_in and seat_no <> p_seat;
    else
      -- All-in më i vogël se minimum raise: të tjerët mund vetëm të paguajnë, jo të rrisin.
      update public.poker_tables set current_bet = v_target where id = p_table;
    end if;

  else
    raise exception 'Veprim i panjohur.';
  end if;

  perform public._progress(p_table, p_seat, false);
end;
$$;

-- "Ora" e tavolinës: timeout i lojtarit, fillimi i dorës së re. Tavolina duhet të jetë e kyçur.
create function public._tick(p_table uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.poker_tables;
  s public.table_seats;
begin
  select * into t from public.poker_tables where id = p_table;
  if t.stage in ('preflop', 'flop', 'turn', 'river') then
    if t.turn_deadline is not null and t.turn_deadline <= now() then
      -- Koha mbaroi: Check nëse lejohet, përndryshe Fold. Lojtari shënohet "larg tavolinës".
      select * into s from public.table_seats where table_id = p_table and seat_no = t.turn_seat;
      update public.table_seats set sitting_out = true, sit_out_at = coalesce(sit_out_at, now())
       where table_id = p_table and seat_no = t.turn_seat;
      perform public._apply_action(
        p_table, t.turn_seat, case when t.current_bet - s.bet_round <= 0 then 'check' else 'fold' end, null);
    end if;
  elsif t.stage = 'showdown' then
    if t.next_hand_at <= now() then
      perform public._start_hand(p_table);
    end if;
  else
    if (select count(*) from public.table_seats
         where table_id = p_table and not sitting_out and not leaving and stack > 0) >= 2 then
      perform public._start_hand(p_table);
    else
      perform public._expire_sitouts(p_table);
    end if;
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. FUNKSIONET QË THIRREN NGA APLIKACIONI
-- ----------------------------------------------------------------------------

-- Veprimi i lojtarit. p_seq duhet të jetë action_seq që lojtari sheh në ekran:
-- nëse gjendja ka ndryshuar ndërkohë (ose klikimi u dërgua dy herë), veprimi refuzohet.
create function public.player_action(p_table_id uuid, p_action text, p_amount bigint, p_seq bigint)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.poker_tables;
  v_seat int;
begin
  select * into t from public.poker_tables where id = p_table_id for update;
  if not found or t.stage not in ('preflop', 'flop', 'turn', 'river') then
    raise exception 'Nuk ka dorë aktive.';
  end if;
  if p_seq is distinct from t.action_seq then
    raise exception 'Gjendja e lojës ndryshoi. Provo përsëri.';
  end if;
  select seat_no into v_seat from public.table_seats
   where table_id = p_table_id and player_id = auth.uid() and in_hand and not leaving;
  if v_seat is null or v_seat is distinct from t.turn_seat then
    raise exception 'Nuk është radha jote.';
  end if;
  if p_action not in ('fold', 'check', 'call', 'raise', 'allin') then
    raise exception 'Veprim i panjohur.';
  end if;
  -- Lojtari po luan: nuk është më "larg tavolinës".
  update public.table_seats set sitting_out = false, sit_out_at = null
   where table_id = p_table_id and seat_no = v_seat;
  perform public._apply_action(p_table_id, v_seat, p_action, p_amount);
end;
$$;

-- Thirret nga çdo browser në tavolinë kur skadon koha. Serveri vendos vetë sipas orës së tij.
create function public.table_tick(p_table_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Duhet të jesh i kyçur.';
  end if;
  perform 1 from public.poker_tables where id = p_table_id for update;
  if found then
    perform public._tick(p_table_id);
  end if;
end;
$$;

-- Rezervë: thirret automatikisht nga serveri çdo 10 sekonda, edhe kur askush nuk është online.
create function public.tick_all() returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in
    select id from public.poker_tables p
     where stage <> 'idle' or exists (select 1 from public.table_seats s where s.table_id = p.id)
     for update skip locked
  loop
    perform public._tick(r.id);
  end loop;
end;
$$;

-- "Jam kthyer": lojtari që ishte larg rikthehet në lojë.
create function public.sit_in() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_table uuid;
begin
  select table_id into v_table from public.table_seats where player_id = auth.uid();
  if v_table is null then
    return;
  end if;
  perform 1 from public.poker_tables where id = v_table for update;
  update public.table_seats set sitting_out = false, sit_out_at = null
   where player_id = auth.uid() and not leaving;
  update public.poker_tables t set turn_deadline = now() + interval '25 seconds'
   where t.id = v_table and t.stage in ('preflop', 'flop', 'turn', 'river')
     and t.turn_seat = (select seat_no from public.table_seats where player_id = auth.uid());
  perform public._tick(v_table);
end;
$$;

-- Gjendja e tavolinës për ekranin: të dhënat publike + VETËM kartat e mia private.
create function public.table_state(p_table_id uuid) returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'now', now(),
    'table', (select to_jsonb(t) from public.poker_tables t where t.id = p_table_id),
    'seats', (select coalesce(jsonb_agg(to_jsonb(s) order by s.seat_no), '[]'::jsonb)
                from public.table_seats s where s.table_id = p_table_id),
    'my_cards', (select h.cards from public.hole_cards h
                  where h.table_id = p_table_id and h.player_id = auth.uid())
  )
  where auth.uid() is not null;
$$;

-- Ulja në tavolinë (zëvendëson versionin e Fazës 1): tani nis edhe dorën kur ka 2 lojtarë.
create or replace function public.join_table(p_table_id uuid, p_seat int default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_profile public.profiles;
  v_table   public.poker_tables;
  v_seat    int;
begin
  select * into v_table from public.poker_tables where id = p_table_id for update;
  if not found then
    raise exception 'Tavolina nuk u gjet.';
  end if;
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found or not v_profile.is_active or v_profile.role <> 'player' then
    raise exception 'Llogaria nuk lejohet të luajë.';
  end if;
  if exists (select 1 from public.table_seats where player_id = v_uid and leaving) then
    raise exception 'Prit sa të mbarojë dora nga e cila sapo u largove.';
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

  perform public._tick(p_table_id);            -- nëse tani janë 2 lojtarë, fillon dora
  return v_seat;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. LEJET
-- ----------------------------------------------------------------------------

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
  public.heartbeat(),
  public.player_action(uuid, text, bigint, bigint),
  public.table_tick(uuid),
  public.sit_in(),
  public.table_state(uuid)
to authenticated;

-- ----------------------------------------------------------------------------
-- 6. ORA AUTOMATIKE E SERVERIT (pg_cron) — rezervë për kur askush nuk është online
-- ----------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('poker-tick', '10 seconds', 'select public.tick_all()');
  perform cron.schedule('poker-cron-cleanup', '15 3 * * *',
                        'delete from cron.job_run_details where end_time < now() - interval ''1 day''');
exception when others then
  raise notice 'pg_cron nuk u aktivizua (%). Loja funksionon edhe pa të.', sqlerrm;
end;
$$;
