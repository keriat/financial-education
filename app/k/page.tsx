"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase, hasEnv } from "@/lib/supabase";

const fmt = (n: number) => new Intl.NumberFormat("ro-MD").format(Math.round(n));
const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(iso));

type ViewTx = {
  id: string;
  type: "earn" | "save" | "unsave" | "payout" | "interest";
  label: string;
  amount: number;
  created_at: string;
};
type ViewData = {
  name: string;
  available: number;
  rate: number;
  earned: number;
  transactions: ViewTx[];
};

function KidPublic() {
  const params = useSearchParams();
  const token = params.get("t");
  const [data, setData] = useState<ViewData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!hasEnv || !token) { setLoaded(true); return; }
    (async () => {
      const { data: res } = await supabase.rpc("kid_view", { p_token: token });
      if (res) setData(res as ViewData);
      setLoaded(true);
    })();
  }, [token]);

  if (!loaded) return <div className="center"><p className="sub">Загрузка…</p></div>;
  if (!data) return (
    <div className="center">
      <div className="setup">
        <h2>Ссылка не работает</h2>
        <p>Похоже, родитель сделал новую. Попроси прислать свежую ссылку.</p>
      </div>
    </div>
  );

  const projWeek  = Math.floor(data.available * data.rate);
  const projMonth = Math.floor(data.available * Math.pow(1 + data.rate, 4));

  const icon = (t: ViewTx["type"]) =>
    t === "interest" ? "💛 " : t === "payout" ? "💵 " : t === "save" ? "🔒 " : t === "unsave" ? "🔓 " : "⭐️ ";
  const amtColor = (t: ViewTx["type"]) =>
    t === "payout" ? "#9a9690" : t === "save" || t === "unsave" ? "var(--gold)" : "var(--green)";

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1 className="display h1">Копилка</h1>
          <p className="sub">только смотреть · {Math.round(data.rate * 100)}% в неделю</p>
        </div>
      </div>

      <section className="card kid">
        <div className="kidhead" style={{ background: "var(--eva)" }}>
          <span className="display kidname">{data.name}</span>
          <span className="num kidtotal">{fmt(data.available)} lei</span>
        </div>

        <div className="stats">
          <div className="stat">
            <div className="statlabel">На счету</div>
            <div className="num statval" style={{ color: "var(--green)" }}>
              {fmt(data.available)}<span className="unit">lei</span>
            </div>
            {data.available > 0 && <div className="proj">пн: +{fmt(projWeek)} lei</div>}
          </div>
          <div className="stat">
            <div className="statlabel">Заработано</div>
            <div className="num statval" style={{ color: "var(--gold)" }}>
              {fmt(data.earned)}<span className="unit">lei</span>
            </div>
          </div>
        </div>

        {data.available > 0 && (
          <div className="drawer" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="proj" style={{ fontSize: 14 }}>
              через 4 недели на счету будет ~{fmt(projMonth)} lei
            </div>
          </div>
        )}

        <div className="drawer" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="log" style={{ maxHeight: "none" }}>
            {data.transactions.length === 0 && <p className="empty">Пока пусто.</p>}
            {data.transactions.map((e) => (
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
        </div>
      </section>

      <p className="footer">Только просмотр · проценты на счёт каждый понедельник.</p>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="center"><p className="sub">Загрузка…</p></div>}>
      <KidPublic />
    </Suspense>
  );
}
