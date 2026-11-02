// Talks to /api/session. Saving only happens when the free Upstash store is connected
// on Vercel; without it every call quietly returns { saved: false }.
export interface SessionStart { name: string; yacht: string; lengthFt: number; fouling: string }
export interface SessionFinish extends SessionStart { seconds: number; coverage: number; barnacles: number; findings: number; score: number }

export interface Stats {
  enabled: boolean;
  visitors: number;
  completed: number;
  recent: { name: string; yacht: string; at: number; seconds?: number }[];
  board: { name: string; seconds: number }[];
}

async function post(body: unknown) {
  try {
    const r = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) return { saved: false };
    return (await r.json()) as { saved: boolean };
  } catch {
    return { saved: false };
  }
}

export const saveStart = (s: SessionStart) => post({ type: 'start', ...s });
export const saveFinish = (s: SessionFinish) => post({ type: 'finish', ...s });

export async function getStats(): Promise<Stats | null> {
  try {
    const r = await fetch('/api/session', { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()) as Stats;
  } catch {
    return null;
  }
}
