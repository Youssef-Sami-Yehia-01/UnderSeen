// Vercel serverless function. Stores visitors in Upstash Redis (free plan) when the
// "Upstash for Redis" integration is connected in the Vercel dashboard. If it is not
// connected, the function answers { saved: false } and the site keeps working.

type Req = { method?: string; body?: unknown };
type Res = { status: (n: number) => Res; json: (b: unknown) => void; setHeader: (k: string, v: string) => void };

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const enabled = Boolean(URL_ && TOKEN);

async function pipeline(cmds: (string | number)[][]) {
  const r = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error(`Upstash ${r.status}`);
  return (await r.json()) as { result: unknown }[];
}

const clean = (v: unknown, max = 24) =>
  String(v ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, max);
const num = (v: unknown, lo: number, hi: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!enabled) {
    if (req.method === 'GET') return res.status(200).json({ enabled: false, visitors: 0, completed: 0, recent: [], board: [] });
    return res.status(200).json({ saved: false });
  }
  try {
    if (req.method === 'POST') {
      const b = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Record<string, unknown>;
      const name = clean(b.name);
      if (!name) return res.status(400).json({ saved: false });
      const yacht = clean(b.yacht, 30);
      const at = Date.now();
      if (b.type === 'start') {
        await pipeline([
          ['INCR', 'us:visitors'],
          ['LPUSH', 'us:recent', JSON.stringify({ name, yacht, at })],
          ['LTRIM', 'us:recent', 0, 49],
        ]);
      } else if (b.type === 'finish') {
        const seconds = Math.round(num(b.seconds, 1, 3600));
        await pipeline([
          ['INCR', 'us:completed'],
          ['ZADD', 'us:board', seconds, `${name}#${yacht}`],
          ['LPUSH', 'us:done', JSON.stringify({ name, yacht, at, seconds, coverage: num(b.coverage, 0, 100), barnacles: num(b.barnacles, 0, 5000), score: num(b.score, 0, 100) })],
          ['LTRIM', 'us:done', 0, 199],
        ]);
      }
      return res.status(200).json({ saved: true });
    }
    const out = await pipeline([
      ['GET', 'us:visitors'],
      ['GET', 'us:completed'],
      ['LRANGE', 'us:recent', 0, 11],
      ['ZRANGE', 'us:board', 0, 9, 'WITHSCORES'],
    ]);
    const recent = ((out[2].result as string[]) || []).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
    const z = (out[3].result as string[]) || [];
    const board: { name: string; seconds: number }[] = [];
    for (let i = 0; i < z.length; i += 2) board.push({ name: z[i].split('#')[0], seconds: Number(z[i + 1]) });
    return res.status(200).json({
      enabled: true,
      visitors: Number(out[0].result || 0),
      completed: Number(out[1].result || 0),
      recent,
      board,
    });
  } catch {
    return res.status(200).json({ saved: false, enabled: true, visitors: 0, completed: 0, recent: [], board: [] });
  }
}
