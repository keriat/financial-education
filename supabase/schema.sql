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
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  sort           int  not null default 0,
  available      int  not null default 0,
  savings        int  not null default 0,
  savings_anchor date,
  created_at     timestamptz not null default now(),
  constraint kids_name_len   check (char_length(name) between 1 and 40),
  constraint kids_amounts_nn check (available >= 0 and savings >= 0),
  constraint kids_amounts_cap check (available <= 10000000 and savings <= 10000000)
);

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
--  Операции — атомарные функции (только плюсы, ничего не отнимается)
--  Все SECURITY DEFINER, search_path зафиксирован, owner-only грант ниже.
-- =====================================================================

create or replace function earn(p_kid uuid, p_label text, p_amount int)
returns void language plpgsql security definer set search_path = public as $$
declare amt int;
begin
  if p_kid is null then return; end if;
  amt := cap_amount(coalesce(p_amount, 0), 10000);
  if amt <= 0 then return; end if;
  update kids set available = available + amt where id = p_kid;
  insert into transactions(kid_id, type, label, amount)
  values (p_kid, 'earn', left(coalesce(p_label, ''), 80), amt);
end $$;

create or replace function to_savings(p_kid uuid, p_amount int)
returns void language plpgsql security definer set search_path = public as $$
declare amt int;
begin
  if p_kid is null then return; end if;
  select least(cap_amount(coalesce(p_amount, 0), 1000000), available) into amt
    from kids where id = p_kid;
  if amt is null or amt <= 0 then return; end if;
  update kids
     set available = available - amt,
         savings   = savings + amt,
         savings_anchor = coalesce(savings_anchor, (date_trunc('week', now()))::date)
   where id = p_kid;
  insert into transactions(kid_id, type, label, amount)
  values (p_kid, 'save', 'В рост', amt);
end $$;

create or replace function from_savings(p_kid uuid, p_amount int)
returns void language plpgsql security definer set search_path = public as $$
declare amt int;
begin
  if p_kid is null then return; end if;
  select least(cap_amount(coalesce(p_amount, 0), 1000000), savings) into amt
    from kids where id = p_kid;
  if amt is null or amt <= 0 then return; end if;
  update kids
     set savings = savings - amt,
         available = available + amt,
         savings_anchor = case when savings - amt = 0 then null else savings_anchor end
   where id = p_kid;
  insert into transactions(kid_id, type, label, amount)
  values (p_kid, 'unsave', 'Снято в доступные', amt);
end $$;

create or replace function payout(p_kid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare amt int;
begin
  if p_kid is null then return; end if;
  select available into amt from kids where id = p_kid;
  if amt is null or amt <= 0 then return; end if;
  update kids set available = 0 where id = p_kid;
  insert into transactions(kid_id, type, label, amount)
  values (p_kid, 'payout', 'Выдано на руки', amt);
end $$;

-- Идемпотентное начисление процентов за пропущенные недели.
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
  for k in select id, savings, savings_anchor from kids
           where savings > 0 and savings_anchor is not null loop
    weeks := ((cur_monday - k.savings_anchor) / 7);
    if weeks > 0 then
      s := k.savings;
      for i in 1..weeks loop
        interest := floor(s * r);
        s := s + interest;
        insert into transactions(kid_id, type, label, amount)
        values (k.id, 'interest', 'Проценты за неделю', interest);
      end loop;
      update kids set savings = s, savings_anchor = cur_monday where id = k.id;
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
create or replace function correct_kid(p_kid uuid, p_available int, p_savings int)
returns void language plpgsql security definer set search_path = public as $$
declare a int; s int;
begin
  if p_kid is null then return; end if;
  a := cap_amount(coalesce(p_available, 0), 10000000);
  s := cap_amount(coalesce(p_savings,   0), 10000000);
  update kids
     set available = a,
         savings   = s,
         savings_anchor = case
           when s = 0 then null
           when savings_anchor is null then (date_trunc('week', now()))::date
           else savings_anchor end
   where id = p_kid;
end $$;

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
  update kids set available = 0, savings = 0, savings_anchor = null;
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

-- Authenticated: только SELECT на таблицах + EXECUTE на функциях.
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
revoke insert, update, delete on all tables in schema public from authenticated;

-- EXECUTE только на «белый список» функций
revoke all on all functions in schema public from authenticated;
grant execute on function
  earn(uuid, text, int),
  to_savings(uuid, int),
  from_savings(uuid, int),
  payout(uuid),
  apply_interest(),
  set_rate(numeric),
  rename_kid(uuid, text),
  correct_kid(uuid, int, int),
  add_action(text, int, int),
  update_action(uuid, text, int),
  delete_action(uuid),
  reset_all()
to authenticated;
