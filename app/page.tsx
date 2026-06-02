"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, hasEnv } from "@/lib/supabase";
import type { Kid, Action, Tx } from "@/lib/types";
import Login from "./login";

const ACCENTS = ["var(--eva)", "var(--serge)"];
const fmt = (n: number) => new Intl.NumberFormat("ro-MD").format(Math.round(n));
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(iso));

const MAX_EARN = 10000;

const todayISO = () => {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
};
// `<input type="date">` returns YYYY-MM-DD in local time. Convert to a
// timestamp: today → null (server uses now()); past dates → local noon ISO
// so it lands unambiguously on that day regardless of TZ/DST.
const whenFromPicker = (picked: string): string | null => {
  if (!picked || picked === todayISO()) return null;
  return new Date(`${picked}T12:00:00`).toISOString();
};

export default function Page() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [kids, setKids] = useState<Kid[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [rate, setRate] = useState(0.2);
  const [txByKid, setTxByKid] = useState<Record<string, Tx[]>>({});
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [recordDate, setRecordDate] = useState<string>(todayISO());

  useEffect(() => {
    if (!hasEnv) {
      setAuthReady(true);
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const reload = useCallback(async () => {
    const [k, a, s, t] = await Promise.all([
      supabase.from("kids").select("*").order("sort"),
      supabase.from("actions").select("*").order("sort"),
      supabase.from("settings").select("rate").eq("id", 1).single(),
      supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(300),
    ]);
    if (k.data) setKids(k.data as Kid[]);
    if (a.data) setActions(a.data as Action[]);
    if (s.data) setRate(Number((s.data as { rate: number }).rate));
    if (t.data) {
      const grouped: Record<string, Tx[]> = {};
      (t.data as Tx[]).forEach((tx) => {
        (grouped[tx.kid_id] ||= []).push(tx);
      });
      setTxByKid(grouped);
    }
  }, []);

  useEffect(() => {
    if (!hasEnv || !session) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      await supabase.rpc("apply_interest");
      await reload();
      setLoading(false);
    })();
  }, [reload, session]);

  // Всего заработано = earn + interest по всей истории, на ребёнка.
  // 300 транзакций — лимит окна; для семейного использования этого достаточно.
  const earnedByKid = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [kidId, txs] of Object.entries(txByKid)) {
      let sum = 0;
      for (const tx of txs) if (tx.type === "earn" || tx.type === "interest") sum += tx.amount;
      out[kidId] = sum;
    }
    return out;
  }, [txByKid]);

  if (!hasEnv) return <Setup />;
  if (!authReady) return <div className="center"><p className="sub">Загрузка…</p></div>;
  if (!session) return <Login />;
  if (loading) return <div className="center"><p className="sub">Загрузка…</p></div>;

  const earn = async (kidId: string, a: Action) => {
    setFlashId(kidId);
    setTimeout(() => setFlashId(null), 500);
    const amount = Math.max(0, Math.min(MAX_EARN, Math.floor(a.amount)));
    if (amount <= 0) return;
    await supabase.rpc("earn", {
      p_kid: kidId, p_label: a.label, p_amount: amount,
      p_when: whenFromPicker(recordDate),
    });
    await reload();
  };
  const payout = async (kidId: string, raw: number, comment: string) => {
    const amt = Math.max(0, Math.min(10_000_000, Math.floor(raw || 0)));
    if (amt <= 0) return;
    await supabase.rpc("payout", {
      p_kid: kidId, p_amount: amt,
      p_label: comment.trim().slice(0, 80) || null,
      p_when: whenFromPicker(recordDate),
    });
    await reload();
  };

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1 className="display h1">Копилка</h1>
          <p className="sub">учёт леев · {Math.round(rate * 100)}% в неделю на счёт</p>
        </div>
        <button className="pill gearbtn card" onClick={() => setSettingsOpen(true)}>⚙︎ настройки</button>
      </div>

      <div className="card datebar">
        <span className="small">Пишу за:</span>
        <input
          className="field"
          type="date"
          value={recordDate}
          max={todayISO()}
          onChange={(e) => setRecordDate(e.target.value || todayISO())}
          style={{ width: 150 }}
        />
        {recordDate !== todayISO() && (
          <button className="pill" onClick={() => setRecordDate(todayISO())}>сегодня</button>
        )}
      </div>

      {kids.map((k, i) => (
        <KidCard
          key={k.id}
          kid={k}
          accent={ACCENTS[i % ACCENTS.length]}
          actions={actions}
          rate={rate}
          txs={txByKid[k.id] || []}
          earned={earnedByKid[k.id] || 0}
          flash={flashId === k.id}
          onEarn={(a) => earn(k.id, a)}
          onPayout={(amt, comment) => payout(k.id, amt, comment)}
        />
      ))}

      <p className="footer">Данные в Supabase · проценты на счёт каждую неделю.</p>

      {settingsOpen && (
        <Settings
          kids={kids}
          actions={actions}
          rate={rate}
          reload={reload}
          close={() => setSettingsOpen(false)}
          onReset={() => setConfirmReset(true)}
        />
      )}

      {confirmReset && (
        <ConfirmModal
          title="Обнулить балансы и историю?"
          body="Дети и список дел останутся. Транзакции и текущие суммы будут стёрты безвозвратно."
          confirmLabel="Да, обнулить"
          onCancel={() => setConfirmReset(false)}
          onConfirm={async () => {
            await supabase.rpc("reset_all");
            setConfirmReset(false);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function KidCard({
  kid, accent, actions, rate, txs, earned, flash, onEarn, onPayout,
}: {
  kid: Kid; accent: string; actions: Action[]; rate: number; txs: Tx[]; earned: number; flash: boolean;
  onEarn: (a: Action) => void; onPayout: (amount: number, comment: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [payAmt, setPayAmt] = useState("");
  const [payNote, setPayNote] = useState("");
  const projected = Math.floor(kid.available * rate);

  const icon = (t: Tx["type"]) =>
    t === "interest" ? "💛 " : t === "payout" ? "💵 " : t === "save" ? "🔒 " : t === "unsave" ? "🔓 " : "⭐️ ";
  const amtColor = (t: Tx["type"]) =>
    t === "payout" ? "#9a9690" : t === "save" || t === "unsave" ? "var(--gold)" : "var(--green)";

  return (
    <section className={`card kid ${flash ? "flash" : ""}`}>
      <div className="kidhead" style={{ background: accent }}>
        <span className="display kidname">{kid.name}</span>
        <span className="num kidtotal">{fmt(kid.available)} lei</span>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="statlabel">На счету</div>
          <div className="num statval" style={{ color: "var(--green)" }}>{fmt(kid.available)}<span className="unit">lei</span></div>
          {kid.available > 0 && <div className="proj">пн: +{fmt(projected)} lei</div>}
        </div>
        <div className="stat">
          <div className="statlabel">Заработано</div>
          <div className="num statval" style={{ color: "var(--gold)" }}>{fmt(earned)}<span className="unit">lei</span></div>
        </div>
      </div>

      <div className="earns">
        {actions.map((a) => (
          <button key={a.id} className="pill earnbtn" onClick={() => onEarn(a)}>
            {a.label} <span className="num">+{a.amount}</span>
          </button>
        ))}
      </div>

      <div className="drawer">
        <button className="toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "▾ скрыть" : "▸ выдать и история"}
        </button>

        {open && (
          <>
            <div className="moneyrow">
              <input
                className="num amt" type="number" inputMode="numeric" placeholder="сумма"
                min={0} max={kid.available} step={1}
                value={payAmt} onChange={(e) => setPayAmt(e.target.value)}
              />
              <button className="pill mbtn" style={{ background: "var(--green)", color: "#fff" }}
                onClick={() => { onPayout(Number(payAmt) || 0, payNote); setPayAmt(""); setPayNote(""); }}>
                Выдать
              </button>
              <button className="pill mbtn" style={{ background: "var(--green-soft, #e8f5e9)", color: "var(--green)" }}
                onClick={() => { onPayout(kid.available, payNote); setPayAmt(""); setPayNote(""); }}>
                всё
              </button>
            </div>
            <input
              className="field" type="text" placeholder="за что (необязательно)" maxLength={80}
              value={payNote} onChange={(e) => setPayNote(e.target.value)}
              style={{ width: "100%", marginTop: 8 }}
            />

            <div className="log">
              {txs.length === 0 && <p className="empty">Пока пусто.</p>}
              {txs.slice(0, 40).map((e) => (
                <div className="logrow" key={e.id}>
                  <span className="logname">
                    <span className="small" style={{ opacity: 0.55, marginRight: 6 }}>{fmtDate(e.created_at)}</span>
                    {icon(e.type)}{e.label}
                  </span>
                  <span className="num logamt" style={{ color: amtColor(e.type) }}>
                    {e.type === "payout" ? "−" : "+"}{fmt(e.amount)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Settings({
  kids, actions, rate, reload, close, onReset,
}: {
  kids: Kid[]; actions: Action[]; rate: number; reload: () => Promise<void>; close: () => void; onReset: () => void;
}) {
  const commit = async (fn: () => PromiseLike<unknown>) => { await fn(); await reload(); };

  const updateRate = (pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    return commit(() => supabase.rpc("set_rate", { p_rate: clamped / 100 }));
  };
  const renameKid = (id: string, name: string) => {
    const n = name.trim().slice(0, 40);
    if (!n) return Promise.resolve();
    return commit(() => supabase.rpc("rename_kid", { p_kid: id, p_name: n }));
  };
  const correct = (id: string, available: number) =>
    commit(() => supabase.rpc("correct_kid", {
      p_kid: id,
      p_available: Math.max(0, Math.floor(available || 0)),
    }));
  const updateAction = (id: string, label: string, amount: number) =>
    commit(() => supabase.rpc("update_action", {
      p_id: id,
      p_label: label.trim().slice(0, 80) || "Дело",
      p_amount: Math.max(0, Math.min(MAX_EARN, Math.floor(amount || 0))),
    }));
  const addAction = () =>
    commit(() => supabase.rpc("add_action", {
      p_label: "Новое дело", p_amount: 20, p_sort: actions.length,
    }));
  const delAction = (id: string) =>
    commit(() => supabase.rpc("delete_action", { p_id: id }));

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalhead">
          <h2 className="display modaltitle">Настройки</h2>
          <button className="x" onClick={close}>✕</button>
        </div>

        <label className="flabel">Процент роста в неделю</label>
        <div className="frow">
          <input className="num field" style={{ width: 100 }} type="number" min={0} max={100} step={1}
            defaultValue={Math.round(rate * 100)}
            onBlur={(e) => updateRate(Number(e.target.value) || 0)} />
          <span className="small">% — применяется к сумме на счёте каждый понедельник</span>
        </div>

        <label className="flabel">Имена</label>
        {kids.map((k) => (
          <div className="frow" key={k.id}>
            <input className="field" maxLength={40} defaultValue={k.name}
              onBlur={(e) => renameKid(k.id, e.target.value)} />
          </div>
        ))}

        <label className="flabel">За что начисляем</label>
        {actions.map((a) => (
          <ActionRow key={a.id} action={a} onSave={updateAction} onDelete={() => delAction(a.id)} />
        ))}
        <button className="addbtn" onClick={addAction}>+ добавить дело</button>

        <label className="flabel">Исправить вручную</label>
        {kids.map((k) => (
          <CorrectRow key={k.id} kid={k} onSave={correct} />
        ))}

        <button className="savebtn" onClick={close}>Готово</button>
        <button className="resetbtn" onClick={onReset}>Обнулить балансы и историю</button>
        <button className="resetbtn" style={{ background: "transparent", color: "#9a9690" }} onClick={signOut}>
          Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}

function ActionRow({
  action, onSave, onDelete,
}: { action: Action; onSave: (id: string, label: string, amount: number) => void; onDelete: () => void }) {
  const [label, setLabel] = useState(action.label);
  const [amount, setAmount] = useState(action.amount);
  return (
    <div className="frow">
      <input className="field" maxLength={80} value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => onSave(action.id, label, amount)} />
      <input className="num field" style={{ width: 80, textAlign: "center" }} type="number" min={0} max={MAX_EARN}
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value) || 0)}
        onBlur={() => onSave(action.id, label, amount)} />
      <button className="delbtn" onClick={onDelete}>✕</button>
    </div>
  );
}

function CorrectRow({
  kid, onSave,
}: { kid: Kid; onSave: (id: string, available: number) => void }) {
  const [available, setAvailable] = useState(kid.available);
  return (
    <div className="frow">
      <span style={{ width: 64, fontWeight: 800, fontSize: 14, opacity: 0.7 }}>{kid.name}</span>
      <span className="small">на счету</span>
      <input className="num field" style={{ textAlign: "center" }} type="number" min={0}
        value={available}
        onChange={(e) => setAvailable(Number(e.target.value) || 0)}
        onBlur={() => onSave(kid.id, available)} />
    </div>
  );
}

function ConfirmModal({
  title, body, confirmLabel, onConfirm, onCancel,
}: { title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
        <h2 className="display modaltitle" style={{ marginBottom: 8 }}>{title}</h2>
        <p className="sub" style={{ marginBottom: 16 }}>{body}</p>
        <button className="resetbtn" onClick={onConfirm}>{confirmLabel}</button>
        <button className="savebtn" onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}

function Setup() {
  return (
    <div className="center">
      <div className="setup">
        <h2>Почти готово</h2>
        <p>Не заданы переменные окружения Supabase. Создай файл <code>.env.local</code> (см. <code>.env.example</code>) и впиши:</p>
        <p><code>NEXT_PUBLIC_SUPABASE_URL</code><br /><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></p>
        <p>Значения — в Supabase → Project Settings → API. Затем перезапусти <code>npm run dev</code>. Подробнее — в README.</p>
      </div>
    </div>
  );
}
