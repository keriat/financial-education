-- =====================================================================
--  Копилка — схема Supabase (Postgres)
--  Запусти этот файл целиком в Supabase → SQL Editor → New query → Run.
-- =====================================================================

create extension if not exists pgcrypto;   -- для gen_random_uuid()

-- ---------- Настройки (одна строка) ----------------------------------
create table if not exists settings (
  id   int primary key default 1,
  rate numeric not null default 0.20,       -- рост в неделю (0.20 = 20%)
  constraint settings_single check (id = 1)
);
insert into settings (id, rate) values (1, 0.20) on conflict (id) do nothing;

-- ---------- Дети ------------------------------------------------------
create table if not exists kids (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  sort           int  not null default 0,
  available      int  not null default 0,   -- доступно (леи)
  savings        int  not null default 0,   -- «в росте» (леи)
  savings_anchor date,                       -- понедельник последнего начисления
  created_at     timestamptz not null default now()
);

-- ---------- За что начисляем (конфиг) --------------------------------
create table if not exists actions (
  id     uuid primary key default gen_random_uuid(),
  label  text not null,
  amount int  not null default 20,
  sort   int  not null default 0
);

-- ---------- Журнал операций (история) --------------------------------
create table if not exists transactions (
  id         uuid primary key default gen_random_uuid(),
  kid_id     uuid not null references kids(id) on delete cascade,
  type       text not null check (type in ('earn','save','unsave','payout','interest')),
  label      text not null,
  amount     int  not null,
  created_at timestamptz not null default now()
);
create index if not exists transactions_kid_idx on transactions(kid_id, created_at desc);

-- ---------- Стартовые данные (только если пусто) ---------------------
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
--  Операции — атомарные функции (только плюсы, ничего не отнимается)
-- =====================================================================

create or replace function earn(p_kid uuid, p_label text, p_amount int)
returns void language plpgsql security definer set search_path = public as $$
begin
  update kids set available = available + p_amount where id = p_kid;
  insert into transactions(kid_id, type, label, amount)
  values (p_kid, 'earn', p_label, p_amount);
end $$;

create or replace function to_savings(p_kid uuid, p_amount int)
returns void language plpgsql security definer set search_path = public as $$
declare amt int;
begin
  select least(p_amount, available) into amt from kids where id = p_kid;
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
  select least(p_amount, savings) into amt from kids where id = p_kid;
  if amt is null or amt <= 0 then return; end if;
  update kids set savings = savings - amt, available = available + amt where id = p_kid;
  insert into transactions(kid_id, type, label, amount)
  values (p_kid, 'unsave', 'Снято в доступные', amt);
end $$;

create or replace function payout(p_kid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare amt int;
begin
  select available into amt from kids where id = p_kid;
  if amt is null or amt <= 0 then return; end if;
  update kids set available = 0 where id = p_kid;
  insert into transactions(kid_id, type, label, amount)
  values (p_kid, 'payout', 'Выдано на руки', amt);
end $$;

-- Начисление процентов: догоняет все пропущенные понедельники, идемпотентно.
-- Можно звать сколько угодно раз — лишнего не начислит (привязка к savings_anchor).
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

-- =====================================================================
--  Авто-начисление по понедельникам (необязательно).
--  Включи расширение: Dashboard → Database → Extensions → pg_cron.
--  Потом раскомментируй строку ниже и выполни её.
--  (Приложение и так зовёт apply_interest() при каждом открытии — это
--   страховка, так что cron не обязателен.)
-- =====================================================================
-- select cron.schedule('weekly-lei-interest', '0 6 * * 1', $$ select apply_interest(); $$);

-- =====================================================================
--  Доступ (RLS).
--  Ниже — ОТКРЫТЫЕ политики для роли anon: годится для приватного
--  деплоя по нерасшариваемой ссылке. Для продакшена добавь Supabase Auth
--  и поменяй `to anon` → `to authenticated`. См. README, раздел «Безопасность».
-- =====================================================================
alter table settings     enable row level security;
alter table kids         enable row level security;
alter table actions      enable row level security;
alter table transactions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['settings','kids','actions','transactions'] loop
    execute format('drop policy if exists "anon_all_%1$s" on %1$s;', t);
    execute format('create policy "anon_all_%1$s" on %1$s for all to anon using (true) with check (true);', t);
  end loop;
end $$;

grant usage on schema public to anon;
grant select, insert, update, delete on all tables in schema public to anon;
grant execute on all functions in schema public to anon;
