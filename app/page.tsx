"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase, hasEnv } from "@/lib/supabase";
import type { Kid, Action, Tx } from "@/lib/types";

const ACCENTS = ["var(--eva)", "var(--serge)"];
const fmt = (n: number) => new Intl.NumberFormat("ro-MD").format(Math.round(n));

export default function Page() {
  const [kids, setKids] = useState<Kid[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [rate, setRate] = useState(0.2);
  const [txByKid, setTxByKid] = useState<Record<string, Tx[]>>({});
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);

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
    if (!hasEnv) {
      setLoading(false);
      return;
    }
    (async () => {
      await supabase.rpc("apply_interest"); // догнать пропущенные понедельники
      await reload();
      setLoading(false);
    })();
  }, [reload]);

  const earn = async (kidId: string, a: Action) => {
    setFlashId(kidId);
    setTimeout(() => setFlashId(null), 500);
    await supabase.rpc("earn", { p_kid: kidId, p_label: a.label, p_amount: a.amount });
    await reload();
  };
  const toSavings = async (kidId: string, amt: number) => {
    if (!amt || amt <= 0) return;
    await supabase.rpc("to_savings", { p_kid: kidId, p_amount: amt });
    await reload();
  };
  const fromSavings = async (kidId: string, amt: number) => {
    if (!amt || amt <= 0) return;
    await supabase.rpc("from_savings", { p_kid: kidId, p_amount: amt });
    await reload();
  };
  const payout = async (kidId: string) => {
    await supabase.rpc("payout", { p_kid: kidId });
    await reload();
  };

  if (!hasEnv) return <Setup />;
  if (loading) return <div className="center"><p className="sub">Загрузка…</p></div>;

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1 className="display h1">Копилка</h1>
          <p className="sub">учёт леев · {Math.round(rate * 100)}% в неделю в росте</p>
        </div>
        <button className="pill gearbtn card" onClick={() => setSettingsOpen(true)}>⚙︎ настройки</button>
      </div>

      {kids.map((k, i) => (
        <KidCard
          key={k.id}
          kid={k}
          accent={ACCENTS[i % ACCENTS.length]}
          actions={actions}
          rate={rate}
          txs={txByKid[k.id] || []}
          flash={flashId === k.id}
          onEarn={(a) => earn(k.id, a)}
          onSave={(amt) => toSavings(k.id, amt)}
          onUnsave={(amt) => fromSavings(k.id, amt)}
          onPayout={() => payout(k.id)}
        />
      ))}

      <p className="footer">Данные в Supabase · только плюсы — ничего не отнимается.</p>

      {settingsOpen && (
        <Settings
          kids={kids}
          actions={actions}
          rate={rate}
          reload={reload}
          close={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function KidCard({
  kid, accent, actions, rate, txs, flash, onEarn, onSave, onUnsave, onPayout,
}: {
  kid: Kid; accent: string; actions: Action[]; rate: number; txs: Tx[]; flash: boolean;
  onEarn: (a: Action) => void; onSave: (n: number) => void; onUnsave: (n: number) => void; onPayout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amt, setAmt] = useState("");
  const total = kid.available + kid.savings;
  const projected = Math.floor(kid.savings * rate);

  const icon = (t: Tx["type"]) =>
    t === "interest" ? "💛 " : t === "payout" ? "💵 " : t === "save" ? "🔒 " : t === "unsave" ? "🔓 " : "⭐️ ";
  const amtColor = (t: Tx["type"]) =>
    t === "payout" ? "#9a9690" : t === "save" || t === "unsave" ? "var(--gold)" : "var(--green)";

  return (
    <section className={`card kid ${flash ? "flash" : ""}`}>
      <div className="kidhead" style={{ background: accent }}>
        <span className="display kidname">{kid.name}</span>
        <span className="num kidtotal">{fmt(total)} lei</span>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="statlabel">Доступно</div>
          <div className="num statval" style={{ color: "var(--green)" }}>{fmt(kid.available)}<span className="unit">lei</span></div>
        </div>
        <div className="stat">
          <div className="statlabel">В росте</div>
          <div className="num statval" style={{ color: "var(--gold)" }}>{fmt(kid.savings)}<span className="unit">lei</span></div>
          {kid.savings > 0 && <div className="proj">пн: +{fmt(projected)} lei</div>}
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
          {open ? "▾ скрыть" : "▸ деньги и история"}
        </button>

        {open && (
          <>
            <div className="moneyrow">
              <input
                className="num amt" type="number" inputMode="numeric" placeholder="сумма"
                value={amt} onChange={(e) => setAmt(e.target.value)}
              />
              <button className="pill mbtn" style={{ background: "var(--gold)", color: "#fff" }}
                onClick={() => { onSave(Number(amt) || 0); setAmt(""); }}>В рост →</button>
              <button className="pill mbtn" style={{ background: "var(--gold-soft)", color: "var(--gold)" }}
                onClick={() => { onUnsave(Number(amt) || 0); setAmt(""); }}>← Снять</button>
            </div>
            <button className="pill payoutbtn" onClick={onPayout}>Выдать доступное на руки</button>

            <div className="log">
              {txs.length === 0 && <p className="empty">Пока пусто.</p>}
              {txs.slice(0, 40).map((e) => (
                <div className="logrow" key={e.id}>
                  <span className="logname">{icon(e.type)}{e.label}</span>
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
  kids, actions, rate, reload, close,
}: {
  kids: Kid[]; actions: Action[]; rate: number; reload: () => Promise<void>; close: () => void;
}) {
  const commit = async (fn: () => PromiseLike<unknown>) => { await fn(); await reload(); };

  const updateRate = (pct: number) =>
    commit(() => supabase.from("settings").update({ rate: pct / 100 }).eq("id", 1));
  const renameKid = (id: string, name: string) =>
    commit(() => supabase.from("kids").update({ name }).eq("id", id));
  const correct = (id: string, field: "available" | "savings", val: number) =>
    commit(() => supabase.from("kids").update({ [field]: val }).eq("id", id));
  const updateAction = (id: string, patch: Partial<Action>) =>
    commit(() => supabase.from("actions").update(patch).eq("id", id));
  const addAction = () =>
    commit(() => supabase.from("actions").insert({ label: "Новое дело", amount: 20, sort: actions.length }));
  const delAction = (id: string) =>
    commit(() => supabase.from("actions").delete().eq("id", id));

  const reset = async () => {
    if (!confirm("Обнулить все балансы и стереть историю? Дети и список дел останутся.")) return;
    await supabase.from("transactions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await Promise.all(kids.map((k) =>
      supabase.from("kids").update({ available: 0, savings: 0, savings_anchor: null }).eq("id", k.id)));
    await reload();
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalhead">
          <h2 className="display modaltitle">Настройки</h2>
          <button className="x" onClick={close}>✕</button>
        </div>

        <label className="flabel">Процент роста в неделю</label>
        <div className="frow">
          <input className="num field" style={{ width: 100 }} type="number" defaultValue={Math.round(rate * 100)}
            onBlur={(e) => updateRate(Number(e.target.value) || 0)} />
          <span className="small">% — применяется к сумме «в росте» каждый понедельник</span>
        </div>

        <label className="flabel">Имена</label>
        {kids.map((k) => (
          <div className="frow" key={k.id}>
            <input className="field" defaultValue={k.name} onBlur={(e) => renameKid(k.id, e.target.value)} />
          </div>
        ))}

        <label className="flabel">За что начисляем</label>
        {actions.map((a) => (
          <div className="frow" key={a.id}>
            <input className="field" defaultValue={a.label} onBlur={(e) => updateAction(a.id, { label: e.target.value })} />
            <input className="num field" style={{ width: 80, textAlign: "center" }} type="number" defaultValue={a.amount}
              onBlur={(e) => updateAction(a.id, { amount: Number(e.target.value) || 0 })} />
            <button className="delbtn" onClick={() => delAction(a.id)}>✕</button>
          </div>
        ))}
        <button className="addbtn" onClick={addAction}>+ добавить дело</button>

        <label className="flabel">Исправить вручную</label>
        {kids.map((k) => (
          <div className="frow" key={k.id}>
            <span style={{ width: 64, fontWeight: 800, fontSize: 14, opacity: 0.7 }}>{k.name}</span>
            <span className="small">дост.</span>
            <input className="num field" style={{ textAlign: "center" }} type="number" defaultValue={k.available}
              onBlur={(e) => correct(k.id, "available", Number(e.target.value) || 0)} />
            <span className="small">рост</span>
            <input className="num field" style={{ textAlign: "center" }} type="number" defaultValue={k.savings}
              onBlur={(e) => correct(k.id, "savings", Number(e.target.value) || 0)} />
          </div>
        ))}

        <button className="savebtn" onClick={close}>Готово</button>
        <button className="resetbtn" onClick={reset}>Обнулить балансы и историю</button>
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
