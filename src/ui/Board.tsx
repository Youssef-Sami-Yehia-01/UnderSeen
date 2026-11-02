import { useEffect, useState } from 'react';
import { getStats, type Stats } from '../lib/api';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Live visitor board for a screen at the event: /?view=board */
export default function Board() {
  const [s, setS] = useState<Stats | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => { const r = await getStats(); if (alive) { setS(r); setLoaded(true); } };
    void load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const enabled = s?.enabled;
  return (
    <div className="page">
      <div className="board">
        <div className="board-head">
          <img src="/logo-navy.png" alt="UNDERSEEN" style={{ height: 54 }} />
          <span style={{ color: 'var(--ink-3)', fontSize: 14 }}>Live · updates every 5 seconds</span>
        </div>
        {loaded && !enabled && (
          <div className="glass" style={{ padding: 22, lineHeight: 1.5 }}>
            <b style={{ fontSize: 18 }}>Visitor saving is off.</b>
            <p style={{ margin: '6px 0 0', color: 'var(--ink-2)' }}>The simulator works without it. To count visitors and show a leaderboard, add the free <b>Upstash for Redis</b> store to this project in Vercel (Storage → Create → Upstash), then redeploy.</p>
          </div>
        )}
        <div className="board-kpis">
          <div className="kpi glass"><small>People who dived</small><b>{s?.visitors ?? 0}</b></div>
          <div className="kpi glass"><small>Hulls cleaned and scanned</small><b>{s?.completed ?? 0}</b></div>
          <div className="kpi glass"><small>Fastest clean</small><b>{s?.board?.[0] ? fmt(s.board[0].seconds) : '–'}</b></div>
        </div>
        <div className="board-cols">
          <div className="board-list glass">
            <h3>Fastest cleaners</h3>
            {(s?.board ?? []).map((b, i) => <div className="board-row" key={b.name + i}><span className="rank">{i + 1}</span>{b.name}<span className="v">{fmt(b.seconds)}</span></div>)}
            {!s?.board?.length && <p style={{ color: 'var(--ink-3)', margin: 0 }}>No finished dives yet.</p>}
          </div>
          <div className="board-list glass">
            <h3>Just dived</h3>
            {(s?.recent ?? []).map((r, i) => <div className="board-row" key={r.name + r.at + i}>{r.name}<span className="v">MY {r.yacht}</span></div>)}
            {!s?.recent?.length && <p style={{ color: 'var(--ink-3)', margin: 0 }}>Waiting for the first visitor.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
