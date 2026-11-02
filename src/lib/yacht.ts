// Turns a visitor's name into their own yacht: hull, colours, berth and problems.
// The same name always gives the same yacht.

export type Severity = 'low' | 'medium' | 'high';
export type FindingKind = 'scrape' | 'blisters' | 'propeller' | 'rope' | 'paint' | 'intake';

export interface Quote {
  partner: string;
  method: string;
  when: string;
}

export interface Finding {
  id: string;
  kind: FindingKind;
  title: string;
  where: string;
  side: 'port' | 'starboard' | 'centre';
  severity: Severity;
  size: string;
  detail: string;
  action: string;
  /** position on the hull: u = 0 stern → 1 bow, t = -1 port waterline → 1 starboard waterline */
  u: number;
  t: number;
  quotes: Quote[];
}

export type Style = 'flybridge' | 'sport' | 'explorer';
export type Fouling = 'light' | 'medium' | 'heavy';

export interface Yacht {
  owner: string;
  seed: number;
  name: string;
  lengthFt: number;
  lengthM: number;
  beamM: number;
  style: Style;
  hullColor: string;
  hullColorName: string;
  stripeColor: string;
  antifoul: string;
  antifoulName: string;
  superColor: string;
  berth: string;
  pontoon: string;
  weeksSinceClean: number;
  fouling: Fouling;
  barnacleCount: number;
  anodePct: number;
  findings: Finding[];
  scanNo: number;
  previousScanNo: number;
}

export function hashString(s: string): number {
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) ^ (h1 >>> 0);
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, arr: readonly T[]): T => arr[Math.floor(r() * arr.length) % arr.length];
const range = (r: () => number, a: number, b: number) => a + (b - a) * r();

const BOAT_NAMES = [
  'Nour', 'Salma', 'Layla', 'Yara', 'Malak', 'Farida', 'Amira', 'Sama', 'Dalia', 'Tala',
  'Rawan', 'Marina Blu', 'Sea Breeze', 'Blue Horizon', 'Aurora', 'Serenity', 'Lina', 'Hana',
  'Coral Dawn', 'Zephyr', 'Sirocco', 'Azure', 'Moonstone', 'Wind Song', 'Nefertari',
] as const;

const HULLS = [
  { c: '#F2F3EF', n: 'Pearl white', stripe: '#1C2B44', sup: '#F4F5F2' },
  { c: '#1D2B42', n: 'Midnight navy', stripe: '#C9CED2', sup: '#F2F3EF' },
  { c: '#3A4048', n: 'Graphite', stripe: '#B9925A', sup: '#E9EBEA' },
  { c: '#ECE5D4', n: 'Ivory', stripe: '#24384F', sup: '#F4F1E8' },
  { c: '#C7CDD2', n: 'Silver grey', stripe: '#1A1D21', sup: '#F2F3EF' },
  { c: '#F2F3EF', n: 'Pearl white', stripe: '#8A2F2B', sup: '#F4F5F2' },
] as const;

const ANTIFOUL = [
  { c: '#1E3048', n: 'navy' },
  { c: '#1A1D21', n: 'black' },
  { c: '#6E2A25', n: 'red' },
  { c: '#24466E', n: 'blue' },
] as const;

const STYLES: Style[] = ['flybridge', 'sport', 'explorer'];

function quotesFor(kind: FindingKind): Quote[] {
  switch (kind) {
    case 'scrape':
      return [
        { partner: 'Partner A · hull repairs', method: 'Underwater epoxy repair, no lift-out', when: 'This week' },
        { partner: 'Partner B · boatyard', method: 'Fill and fair at your next lift-out', when: 'Next lift-out' },
      ];
    case 'blisters':
      return [
        { partner: 'Partner B · boatyard', method: 'Moisture test and blister repair on the hard', when: 'Next lift-out' },
        { partner: 'Partner C · surveyor', method: 'Moisture survey only, to decide what to do', when: 'Within 2 weeks' },
      ];
    case 'propeller':
      return [
        { partner: 'Partner D · propeller shop', method: 'Remove, straighten and balance the propeller', when: '3–4 days' },
        { partner: 'Partner A · hull repairs', method: 'In-water swap with a spare, repair ashore', when: 'This week' },
      ];
    case 'rope':
      return [
        { partner: 'Partner A · hull repairs', method: 'Diver removes the rope, checks the shaft seal', when: 'Tomorrow' },
        { partner: 'UNDERSEEN', method: 'Robot cuts the rope on the next dive', when: 'Next dive' },
      ];
    case 'paint':
      return [
        { partner: 'Partner B · boatyard', method: 'Touch up antifouling at the next lift-out', when: 'Next lift-out' },
        { partner: 'Partner E · coatings', method: 'Full antifouling recoat with hull polish', when: 'Next lift-out' },
      ];
    case 'intake':
      return [
        { partner: 'UNDERSEEN', method: 'Robot clears the intake grate on the next dive', when: 'Next dive' },
        { partner: 'Partner A · hull repairs', method: 'Diver clears the grate and checks the strainer', when: 'Tomorrow' },
      ];
  }
}

export function makeYacht(ownerRaw: string): Yacht {
  const owner = ownerRaw.trim();
  const seed = hashString(owner.toLowerCase());
  const r = mulberry32(seed);
  const lengthFt = Math.round(range(r, 42, 68));
  const lengthM = lengthFt * 0.3048;
  const hull = pick(r, HULLS);
  const af = pick(r, ANTIFOUL);
  const style = pick(r, STYLES);
  const fouling: Fouling = pick(r, ['light', 'medium', 'heavy', 'heavy', 'medium'] as const);
  const weeksSinceClean = fouling === 'light' ? Math.round(range(r, 3, 5)) : fouling === 'medium' ? Math.round(range(r, 6, 9)) : Math.round(range(r, 10, 16));
  const barnacleCount = fouling === 'light' ? 90 : fouling === 'medium' ? 380 : 900;
  const pontoon = pick(r, ['A', 'B', 'C', 'D'] as const);
  const berth = `${pontoon}-${String(Math.floor(range(r, 2, 24))).padStart(2, '0')}`;

  // Choose 2 or 3 problems
  const pool: FindingKind[] = ['scrape', 'blisters', 'propeller', 'rope', 'paint', 'intake'];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const n = r() < 0.55 ? 2 : 3;
  const kinds = pool.slice(0, n);
  const findings: Finding[] = kinds.map((kind, i) => {
    const sideSign = r() < 0.5 ? -1 : 1;
    const side = sideSign < 0 ? 'port' : 'starboard';
    const id = `${kind}-${i}`;
    switch (kind) {
      case 'scrape': {
        const len = Math.round(range(r, 12, 34));
        return { id, kind, title: 'Keel scrape', where: `Keel, ${side} side, mid-ship`, side, severity: len > 25 ? 'high' : 'medium', size: `about ${len} cm long`,
          detail: 'The gelcoat is scraped along the keel. This usually happens when the boat touches the bottom or a mooring block.',
          action: 'Check how deep it goes. If it reaches the laminate, fill and fair it before water gets in.',
          u: range(r, 0.45, 0.66), t: sideSign * range(r, 0.06, 0.16), quotes: quotesFor(kind) };
      }
      case 'blisters': {
        const count = Math.round(range(r, 6, 14));
        return { id, kind, title: 'Osmosis blisters', where: `Bottom, ${side} side, aft of mid-ship`, side, severity: 'medium', size: `${count} blisters, 1–3 cm`,
          detail: 'A cluster of small blisters in the gelcoat. They form when water slowly gets into the laminate.',
          action: 'Ask a surveyor to test the moisture level at your next lift-out before deciding on repairs.',
          u: range(r, 0.32, 0.5), t: sideSign * range(r, 0.45, 0.7), quotes: quotesFor(kind) };
      }
      case 'propeller':
        return { id, kind, title: 'Bent propeller blade', where: `${side === 'port' ? 'Port' : 'Starboard'} propeller`, side, severity: 'high', size: '1 blade tip bent',
          detail: 'One blade tip is bent. A bent blade causes vibration, which wears the shaft bearings and seals.',
          action: 'Have the propeller straightened and balanced. Avoid high revs until it is fixed.',
          u: 0.075, t: sideSign * 0.3, quotes: quotesFor(kind) };
      case 'rope':
        return { id, kind, title: 'Rope around the shaft', where: `${side === 'port' ? 'Port' : 'Starboard'} propeller shaft`, side, severity: 'high', size: 'about 2 m of line',
          detail: 'A piece of mooring line is wrapped around the shaft just in front of the propeller.',
          action: 'Remove it before you go out. A wrapped line can damage the shaft seal and let water in.',
          u: 0.12, t: sideSign * 0.3, quotes: quotesFor(kind) };
      case 'paint':
        return { id, kind, title: 'Antifouling worn through', where: `Bow, ${side} side, near the waterline`, side, severity: 'low', size: 'patch about 40 × 20 cm',
          detail: 'The antifouling paint has worn through to the primer. Growth will settle here faster.',
          action: 'Touch up the antifouling at your next lift-out. Until then we will clean this area more often.',
          u: range(r, 0.74, 0.84), t: sideSign * range(r, 0.8, 0.9), quotes: quotesFor(kind) };
      case 'intake':
        return { id, kind, title: 'Blocked seawater intake', where: `Bottom, ${side} side, engine room`, side, severity: 'medium', size: 'grate about 60% blocked',
          detail: 'Barnacles are growing on the intake grate that feeds the engine or air-conditioning cooling water.',
          action: 'Clear the grate. A blocked intake can make the engine or the AC overheat.',
          u: range(r, 0.3, 0.38), t: sideSign * 0.42, quotes: quotesFor(kind) };
    }
  });

  const scanNo = Math.round(range(r, 8, 22));
  return {
    owner,
    seed,
    name: pick(r, BOAT_NAMES),
    lengthFt,
    lengthM,
    beamM: lengthM * 0.29,
    style,
    hullColor: hull.c,
    hullColorName: hull.n,
    stripeColor: hull.stripe,
    antifoul: af.c,
    antifoulName: af.n,
    superColor: hull.sup,
    berth,
    pontoon,
    weeksSinceClean,
    fouling,
    barnacleCount,
    anodePct: Math.round(range(r, 22, 78)),
    findings,
    scanNo,
    previousScanNo: scanNo - 1,
  };
}

export function healthScore(y: Yacht): number {
  const w = { low: 6, medium: 12, high: 20 } as const;
  let s = 100;
  for (const f of y.findings) s -= w[f.severity];
  if (y.anodePct < 40) s -= 8; else if (y.anodePct < 60) s -= 4;
  return Math.max(35, Math.min(98, Math.round(s)));
}

export const SEVERITY_LABEL: Record<Severity, string> = { low: 'Plan it', medium: 'Fix soon', high: 'Fix now' };
