-- =====================================================================
--  Копилка — схема Supabase (Postgres)
--  Запусти этот файл целиком в Supabase → SQL Editor → New query → Run.
--  Безопасный режим: вся запись — через SECURITY DEFINER функции,
--  таблицы доступны только роли authenticated (только SELECT).
-- =====================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------- Настройки (одна строка) ----------------------------------
create table if not exists settings (
  id   int primary key default 1,
  rate numeric not null default 0.20,       -- рост в неделю (0.20 = 20%)
  constraint settings_single check (id = 1),
  constraint settings_rate_bounds check (rate >= 0 and rate <= 1)
);
insert into settings (id, rate) values (1, 0.20) on conflict (id) do nothing;

-- ---------- Дети ------------------------------------------------------
create table if not exists kids (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  sort            int  not null default 0,
  available       int  not null default 0,
  interest_anchor date,
  created_at      timestamptz not null default now(),
  constraint kids_name_len   check (char_length(name) between 1 and 40),
  constraint kids_amount_nn  check (available >= 0),
  constraint kids_amount_cap check (available <= 10000000)
);

-- Миграция со старой модели (две корзины) на одну.
-- savings сворачиваем в available, anchor переименовываем.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='kids' and column_name='savings_anchor')
     and not exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='kids' and column_name='interest_anchor') then
    alter table kids rename column savings_anchor to interest_anchor;
  end if;
end $$;

do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='kids' and column_name='savings') then
    update kids set available = available + savings;
    alter table kids drop column savings;
  end if;
end $$;

-- ---------- За что начисляем ----------------------------------------
create table if not exists actions (
  id     uuid primary key default gen_random_uuid(),
  label  text not null,
  amount int  not null default 20,
  sort   int  not null default 0,
  constraint actions_label_len check (char_length(label) between 1 and 80),
  constraint actions_amount_bounds check (amount between 0 and 10000)
);

-- ---------- Журнал операций -----------------------------------------
--  Старые типы 'save'/'unsave' остаются разрешёнными ради истории,
--  новые операции их не создают.
create table if not exists transactions (
  id         uuid primary key default gen_random_uuid(),
  kid_id     uuid not null references kids(id) on delete cascade,
  type       text not null check (type in ('earn','save','unsave','payout','interest')),
  label      text not null,
  amount     int  not null check (amount >= 0),
  created_at timestamptz not null default now()
);
create index if not exists transactions_kid_idx on transactions(kid_id, created_at desc);

-- ---------- Стартовые данные (только если пусто) --------------------
insert into kids (name, sort)
select v.name, v.sort from (values ('Ева',0),('Серёжа',1)) as v(name,sort)
where not exists (select 1 from kids);

insert into actions (label, amount, sort)
select v.label, v.amount, v.sort from (values
  ('Утро вовремя', 20, 0),
  ('Порядок: комната + ванная', 20, 1),
  ('Дело дня (задания / помощь)', 20, 2),
  ('Прогулка с собакой', 20, 3),
  ('Бонус-день', 20, 4)
) as v(label, amount, sort)
where not exists (select 1 from actions);

-- =====================================================================
--  Жёсткие лимиты на одну операцию (только в одном месте)
-- =====================================================================
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'cap_amount') then
    create function cap_amount(p int, p_max int) returns int
      language sql immutable as $f$ select greatest(0, least(p, p_max)) $f$;
  end if;
end $$;

-- =====================================================================
--  Операции — атомарные функции
--  Все SECURITY DEFINER, search_path зафиксирован, owner-only грант ниже.
-- =====================================================================

-- Старые функции корзины «в рост» больше не нужны.
drop function if exists to_savings(uuid, int);
drop function if exists from_savings(uuid, int);

-- Прежняя сигнатура без даты заменена.
drop function if exists earn(uuid, text, int);

create or replace function earn(p_kid uuid, p_label text, p_amount int, p_when timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare amt int; ts timestamptz;
begin
  if p_kid is null then return; end if;
  amt := cap_amount(coalesce(p_amount, 0), 10000);
  if amt <= 0 then return; end if;
  ts := coalesce(p_when, now());
  if ts > now() then ts := now(); end if;
  if ts < now() - interval '180 days' then ts := now() - interval '180 days'; end if;
  update kids
     set available = available + amt,
         interest_anchor = coalesce(interest_anchor, (date_trunc('week', now()))::date)
   where id = p_kid;
  insert into transactions(kid_id, type, label, amount, created_at)
  values (p_kid, 'earn', left(coalesce(p_label, ''), 80), amt, ts);
end $$;

-- Прежние сигнатуры payout заменены: теперь с комментарием и датой.
drop function if exists payout(uuid);
drop function if exists payout(uuid, int);

create or replace function payout(p_kid uuid, p_amount int, p_label text default null, p_when timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare amt int; bal int; lbl text; ts timestamptz;
begin
  if p_kid is null then return; end if;
  select available into bal from kids where id = p_kid;
  if bal is null or bal <= 0 then return; end if;
  amt := least(cap_amount(coalesce(p_amount, 0), 10000000), bal);
  if amt <= 0 then return; end if;
  lbl := btrim(coalesce(p_label, ''));
  if char_length(lbl) = 0 then lbl := 'Выдано на руки'; end if;
  if char_length(lbl) > 80 then lbl := left(lbl, 80); end if;
  ts := coalesce(p_when, now());
  if ts > now() then ts := now(); end if;
  if ts < now() - interval '180 days' then ts := now() - interval '180 days'; end if;
  update kids
     set available = available - amt,
         interest_anchor = case when available - amt = 0 then null else interest_anchor end
   where id = p_kid;
  insert into transactions(kid_id, type, label, amount, created_at)
  values (p_kid, 'payout', lbl, amt, ts);
end $$;

-- Идемпотентное начисление процентов за пропущенные недели на available.
create or replace function apply_interest()
returns void language plpgsql security definer set search_path = public as $$
declare
  r          numeric;
  k          record;
  cur_monday date := (date_trunc('week', now()))::date;
  weeks      int;
  i          int;
  interest   int;
  s          int;
begin
  select rate into r from settings where id = 1;
  if r is null or r <= 0 then return; end if;
  for k in select id, available, interest_anchor from kids
           where available > 0 and interest_anchor is not null loop
    weeks := ((cur_monday - k.interest_anchor) / 7);
    if weeks > 0 then
      s := k.available;
      for i in 1..weeks loop
        interest := floor(s * r);
        s := s + interest;
        insert into transactions(kid_id, type, label, amount)
        values (k.id, 'interest', 'Проценты за неделю', interest);
      end loop;
      update kids set available = s, interest_anchor = cur_monday where id = k.id;
    end if;
  end loop;
end $$;

-- ---------- Конфиг: ставка, имена, дела ------------------------------

create or replace function set_rate(p_rate numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_rate is null or p_rate < 0 or p_rate > 1 then return; end if;
  update settings set rate = p_rate where id = 1;
end $$;

create or replace function rename_kid(p_kid uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if p_kid is null then return; end if;
  n := btrim(coalesce(p_name, ''));
  if char_length(n) = 0 or char_length(n) > 40 then return; end if;
  update kids set name = n where id = p_kid;
end $$;

-- Ручная коррекция баланса (для редких случаев). Не пишет в историю —
-- родитель знает, что делает. Сбрасывает anchor, если ушло в 0.
create or replace function correct_kid(p_kid uuid, p_available int)
returns void language plpgsql security definer set search_path = public as $$
declare a int;
begin
  if p_kid is null then return; end if;
  a := cap_amount(coalesce(p_available, 0), 10000000);
  update kids
     set available = a,
         interest_anchor = case
           when a = 0 then null
           when interest_anchor is null then (date_trunc('week', now()))::date
           else interest_anchor end
   where id = p_kid;
end $$;

-- Старая сигнатура с двумя корзинами больше не используется.
drop function if exists correct_kid(uuid, int, int);

create or replace function add_action(p_label text, p_amount int, p_sort int)
returns uuid language plpgsql security definer set search_path = public as $$
declare l text; a int; new_id uuid;
begin
  l := btrim(coalesce(p_label, 'Новое дело'));
  if char_length(l) = 0 then l := 'Новое дело'; end if;
  if char_length(l) > 80 then l := left(l, 80); end if;
  a := cap_amount(coalesce(p_amount, 20), 10000);
  insert into actions(label, amount, sort)
  values (l, a, coalesce(p_sort, 0))
  returning id into new_id;
  return new_id;
end $$;

create or replace function update_action(p_id uuid, p_label text, p_amount int)
returns void language plpgsql security definer set search_path = public as $$
declare l text; a int;
begin
  if p_id is null then return; end if;
  l := btrim(coalesce(p_label, ''));
  if char_length(l) = 0 then return; end if;
  if char_length(l) > 80 then l := left(l, 80); end if;
  a := cap_amount(coalesce(p_amount, 0), 10000);
  update actions set label = l, amount = a where id = p_id;
end $$;

create or replace function delete_action(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_id is null then return; end if;
  delete from actions where id = p_id;
end $$;

-- Полный сброс: чистит историю, обнуляет балансы. Только через RPC.
create or replace function reset_all()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from transactions;
  update kids set available = 0, interest_anchor = null;
end $$;

-- =====================================================================
--  Публичная ссылка для ребёнка: непредсказуемый токен + read-only RPC.
--  Токен хранится прямо в kids — родитель его читает (authenticated),
--  ребёнок передаёт в URL и получает данные через anon-функцию kid_view.
-- =====================================================================
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='kids' and column_name='view_token') then
    alter table kids add column view_token text;
    update kids set view_token = encode(gen_random_bytes(8), 'hex') where view_token is null;
    alter table kids alter column view_token set not null;
    alter table kids alter column view_token set default encode(gen_random_bytes(8), 'hex');
    create unique index kids_view_token_idx on kids(view_token);
  end if;
end $$;

-- Возвращает имя, баланс, ставку, всего заработано и историю по токену.
-- Сам идемпотентно догоняет проценты, чтобы экран ребёнка не отставал.
create or replace function kid_view(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k_id        uuid;
  k_name      text;
  k_available int;
  r           numeric;
  earned      int;
  txs         jsonb;
begin
  if p_token is null or char_length(p_token) < 8 or char_length(p_token) > 64 then
    return null;
  end if;
  select id into k_id from kids where view_token = p_token;
  if k_id is null then return null; end if;
  perform apply_interest();
  select name, available into k_name, k_available from kids where id = k_id;
  select rate into r from settings where id = 1;
  select coalesce(sum(amount), 0)::int into earned
    from transactions where kid_id = k_id and type in ('earn','interest');
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',         t.id,
    'type',       t.type,
    'label',      t.label,
    'amount',     t.amount,
    'created_at', t.created_at
  )), '[]'::jsonb) into txs
  from (
    select id, type, label, amount, created_at
    from transactions where kid_id = k_id
    order by created_at desc limit 40
  ) t;
  return jsonb_build_object(
    'name',         k_name,
    'available',    k_available,
    'rate',         r,
    'earned',       earned,
    'transactions', txs
  );
end $$;

-- Перевыдать ссылку: старая сразу перестаёт работать.
create or replace function rotate_view_token(p_kid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare new_token text;
begin
  if p_kid is null then return null; end if;
  new_token := encode(gen_random_bytes(8), 'hex');
  update kids set view_token = new_token where id = p_kid;
  return new_token;
end $$;

-- =====================================================================
--  Авто-начисление по понедельникам (необязательно).
--  Включи расширение: Database → Extensions → pg_cron, потом раскомментируй:
-- =====================================================================
-- select cron.schedule('weekly-lei-interest', '0 6 * * 1', $$ select apply_interest(); $$);

-- =====================================================================
--  RLS и права. Только authenticated читает таблицы.
--  Запись — исключительно через SECURITY DEFINER функции выше.
--  Роли anon права не выдаются вовсе.
-- =====================================================================
alter table settings     enable row level security;
alter table kids         enable row level security;
alter table actions      enable row level security;
alter table transactions enable row level security;

-- Снести старые открытые политики (если запускали предыдущий schema.sql)
do $$
declare t text; pol text;
begin
  foreach t in array array['settings','kids','actions','transactions'] loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on %I', pol, t);
    end loop;
  end loop;
end $$;

-- Только чтение, только для authenticated
create policy "auth_read_settings"     on settings     for select to authenticated using (true);
create policy "auth_read_kids"         on kids         for select to authenticated using (true);
create policy "auth_read_actions"      on actions      for select to authenticated using (true);
create policy "auth_read_transactions" on transactions for select to authenticated using (true);

-- Отозвать всё у anon (на случай прошлых грантов)
revoke all on schema public  from anon;
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Anon (без логина): только одна публичная функция — просмотр по токену.
-- Таблицы остаются недоступны, RLS не пускает SELECT для anon.
grant usage on schema public to anon;
grant execute on function kid_view(text) to anon;

-- Authenticated: только SELECT на таблицах + EXECUTE на функциях.
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete on all tables in schema public from authenticated;

-- EXECUTE только на «белый список» функций
revoke all on all functions in schema public from authenticated;
grant execute on function
  earn(uuid, text, int, timestamptz),
  payout(uuid, int, text, timestamptz),
  apply_interest(),
  set_rate(numeric),
  rename_kid(uuid, text),
  correct_kid(uuid, int),
  add_action(text, int, int),
  update_action(uuid, text, int),
  delete_action(uuid),
  reset_all(),
  rotate_view_token(uuid)
to authenticated;
