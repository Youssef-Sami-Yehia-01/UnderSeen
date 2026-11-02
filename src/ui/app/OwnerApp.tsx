import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, History, Anchor, ClipboardList, ChevronRight, X, RotateCcw, Ruler, Timer, Trash2, CheckCircle2, Clock, Wrench,
  Waves, Link2, LifeBuoy, AlertTriangle, Gauge, CalendarDays, MapPin, Sparkles,
} from 'lucide-react';
import '@fontsource/source-serif-4/500.css';
import '@fontsource/source-serif-4/600.css';
import { healthScore, SEVERITY_LABEL, mulberry32, type Yacht, type Finding } from '../../lib/yacht';
import type { CleanStats } from '../../three/Experience';
import * as sound from '../../lib/sound';
import Photo from './Photo';
import { yachtPhoto, FINDING_PHOTOS, MARINA_PHOTO, YARD_PHOTO, DIVER_PHOTO } from '../../lib/photos';
import './app.css';

export interface HullMap { img: string; pins: { id: string; x: number; y: number }[] }
export interface AppData {
  yacht: Yacht;
  stats: CleanStats;
  hullMap: HullMap;
  plans: string[];
  levels: { growth: number[]; anode: number[]; months: string[]; events: string[] };
}

type Tab = 'report' | 'time' | 'berth' | 'history';
const TITLES: Record<Tab, string> = { report: 'Report', time: 'Time-lapse', berth: 'Berth', history: 'History' };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const growthWord = (g: number) => (g > 0.8 ? 'Heavy' : g > 0.45 ? 'Medium' : 'Light');
const today = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

function Ring({ value }: { value: number }) {
  const r = 34, c = 2 * Math.PI * r;
  const col = value >= 80 ? '#2E9B6A' : value >= 60 ? '#D08A12' : '#E5533A';
  return (
    <svg className="ring" width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
      <circle cx="44" cy="44" r={r} fill="none" stroke="#EDEBE6" strokeWidth="10" />
      <circle cx="44" cy="44" r={r} fill="none" stroke={col} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} transform="rotate(-90 44 44)" style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1)' }} />
    </svg>
  );
}

function LargeTitle({ eyebrow, title, sub, right, logo }: { eyebrow?: string; title: string; sub?: string; right?: React.ReactNode; logo?: boolean }) {
  return (
    <header className="lt">
      <div className="lt-row">{logo ? <img className="lt-logo" src="/logo-h-navy.png" alt="UNDERSEEN" /> : eyebrow ? <span className="lt-eyebrow">{eyebrow}</span> : <span />}{right}</div>
      {logo && eyebrow && <span className="lt-eyebrow lt-eyebrow-under">{eyebrow}</span>}
      <h1 className="lt-title">{title}</h1>
      {sub && <p className="lt-sub">{sub}</p>}
    </header>
  );
}

export default function OwnerApp({ data, onRestart }: { data: AppData; onRestart: () => void }) {
  const { yacht: y, stats, hullMap, plans, levels } = data;
  const hero = yachtPhoto(y);
  const [tab, setTab] = useState<Tab>('report');
  const [open, setOpen] = useState<Finding | null>(null);
  const [booked, setBooked] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const score = healthScore(y);
  const toastT = useRef(0);

  const notify = useCallback((title: string, body: string) => {
    sound.ping();
    setToast({ title, body });
    clearTimeout(toastT.current);
    toastT.current = window.setTimeout(() => setToast(null), 3800);
  }, []);

  const go = (t: Tab) => setTab(t);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setScrolled(false);
  }, [tab]);
  const navTitle = tab === 'report' ? `MY ${y.name}` : TITLES[tab];
  const issues = y.findings.length;

  return (
    <div className="oa">
      <div className={`oa-nav${scrolled ? ' on' : ''}`} aria-hidden={!scrolled}><span>{navTitle}</span></div>
      <div className="oa-scroll" ref={scroller} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 64)}>
        {tab === 'report' && (
          <>
            <LargeTitle
              logo
              eyebrow={today()}
              title={`MY ${y.name}`}
              sub={`${y.owner}'s ${y.lengthFt} ft ${y.style} · Berth ${y.berth}`}
              right={<button className="lt-btn" onClick={onRestart} aria-label="Try another name"><RotateCcw /></button>}
            />
            <div className="oa-body">
              <div className="hero">
                <Photo p={hero} className="hero-photo" credit={false} />
                <span className="hero-badge"><i />Scan {y.scanNo} complete</span>
                <span className="hero-credit">{hero.credit}</span>
              </div>

              <section className="card health">
                <div className="health-ring">
                  <Ring value={score} />
                  <b>{score}</b>
                </div>
                <div className="health-text">
                  <small>Hull condition</small>
                  <h3>{score >= 80 ? 'Good' : score >= 60 ? 'Needs attention' : 'Act soon'}</h3>
                  <p>{issues} new {issues === 1 ? 'finding' : 'findings'} since last month. The hull is clean and the scan is saved to your history.</p>
                </div>
              </section>

              <div className="tiles">
                <div className="tile"><span className="tile-k"><Ruler style={{ color: '#0B7F84' }} />Cleaned</span><b>{Math.round(stats.areaM2)}<small> of {Math.round(stats.totalM2)} m²</small></b></div>
                <div className="tile"><span className="tile-k"><CalendarDays style={{ color: '#C77A2E' }} />Next dive</span><b>28<small> days</small></b></div>
                <div className="tile"><span className="tile-k"><Trash2 style={{ color: '#5B7F3A' }} />Kept out of the marina</span><b>{stats.debrisKg.toFixed(1)}<small> kg est.</small></b></div>
                <div className="tile"><span className="tile-k"><Timer style={{ color: '#5A5FD6' }} />On the hull</span><b>{fmt(stats.seconds)}<small> min</small></b></div>
              </div>

              <h2 className="sec">Findings</h2>
              <div className="list">
                {y.findings.map((f) => (
                  <button key={f.id} className="row find" onClick={() => setOpen(f)}>
                    <Photo p={FINDING_PHOTOS[f.kind]} className="row-thumb" credit={false} />
                    <span className="row-main"><b>{f.title}</b><span>{f.where}</span></span>
                    {booked[f.id] ? <span className="pill ok">Booked</span> : <span className={`pill ${f.severity}`}>{SEVERITY_LABEL[f.severity]}</span>}
                    <ChevronRight className="chev" />
                  </button>
                ))}
              </div>

              <h2 className="sec">Anodes</h2>
              <section className="card anode">
                <div className="anode-top"><span><Gauge />Zinc anodes</span><b>{y.anodePct}%<small> left</small></b></div>
                <div className="track"><i style={{ width: `${y.anodePct}%`, background: y.anodePct < 50 ? '#E5533A' : '#D08A12' }} /><em style={{ left: '50%' }} /></div>
                <p>Small zinc blocks on the shafts and the transom. In salt water they corrode on purpose, so your propellers and shafts don't. The scan measures how much metal is left: <b>{y.anodePct}%</b>.</p>
                <p>{y.anodePct < 50 ? 'Less than half is left: replace them now, before they stop protecting the propellers and shafts.' : `Replace them when about half is gone. At this rate that is in about ${y.anodePct < 60 ? 2 : 4} months.`}</p>
              </section>

              <h2 className="sec">Hull map <span>seen from below</span></h2>
              <section className="card pad-s">
                <div className="hullmap">
                  <img src={hullMap.img} alt={`Underside of MY ${y.name} with the findings marked`} />
                  {hullMap.pins.map((p, i) => (
                    <button key={p.id} className="pin" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} onClick={() => setOpen(y.findings.find((f) => f.id === p.id) ?? null)} aria-label={y.findings.find((f) => f.id === p.id)?.title}>{i + 1}</button>
                  ))}
                </div>
                <div className="pinlist">
                  {y.findings.map((f, i) => <button key={f.id} onClick={() => setOpen(f)}><i>{i + 1}</i><span>{f.title}</span><em>{f.side}</em><ChevronRight className="chev" /></button>)}
                </div>
              </section>

              <h2 className="sec">Coming up</h2>
              <div className="list">
                <div className="row">
                  <Photo p={DIVER_PHOTO} className="row-thumb" credit={false} />
                  <span className="row-main"><b>Annual Hull Review</b><span>A short video of your boat's year below the waterline, in December.</span></span>
                </div>
                <div className="row">
                  <span className="row-icon" style={{ background: '#E6F4F4', color: '#0B7F84' }}><CalendarDays /></span>
                  <span className="row-main"><b>Next dive and scan</b><span>{new Date(Date.now() + 28 * 864e5).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span></span>
                </div>
              </div>
              <p className="credits">Photos: {[hero.credit, ...y.findings.map((f) => FINDING_PHOTOS[f.kind].credit), DIVER_PHOTO.credit].filter((v, i, a) => a.indexOf(v) === i).join(' · ')}</p>
            </div>
          </>
        )}

        {tab === 'time' && <TimeLapse y={y} plans={plans} levels={levels} />}
        {tab === 'berth' && <Berth y={y} />}
        {tab === 'history' && <HistoryTab y={y} levels={levels} booked={booked} />}
      </div>

      <nav className="tabbar" role="tablist">
        <button role="tab" aria-selected={tab === 'report'} onClick={() => go('report')}><Activity />Report</button>
        <button role="tab" aria-selected={tab === 'time'} onClick={() => go('time')}><History />Time-lapse</button>
        <button role="tab" aria-selected={tab === 'berth'} onClick={() => go('berth')}><Anchor />Berth</button>
        <button role="tab" aria-selected={tab === 'history'} onClick={() => go('history')}><ClipboardList />History</button>
      </nav>

      {open && (
        <FindingSheet
          y={y}
          f={open}
          hullMap={hullMap}
          booked={booked[open.id]}
          onClose={() => setOpen(null)}
          onQuotes={() => notify(`${open.quotes.length} quotes received`, `For the ${open.title.toLowerCase()} on MY ${y.name}`)}
          onBook={(p) => { setBooked((b) => ({ ...b, [open.id]: p })); setOpen(null); setTimeout(() => notify('Repair booked', `${p}. We will check the repair on your next scan.`), 350); }}
        />
      )}

      {toast && (
        <div className="banner" role="status">
          <span className="banner-ico"><img src="/favicon.svg" alt="" /></span>
          <div><b>{toast.title}</b><span>{toast.body}</span></div>
          <small>now</small>
        </div>
      )}
    </div>
  );
}

function FindingSheet({ y, f, hullMap, booked, onClose, onQuotes, onBook }: {
  y: Yacht; f: Finding; hullMap: HullMap; booked?: string;
  onClose: () => void; onQuotes: () => void; onBook: (p: string) => void;
}) {
  const [view, setView] = useState<'photo' | 'where'>('photo');
  const [stage, setStage] = useState<'idle' | 'sending' | 'quotes'>('idle');
  const photo = FINDING_PHOTOS[f.kind];
  const pin = hullMap.pins.find((p) => p.id === f.id);
  const request = () => {
    setStage('sending');
    setTimeout(() => { setStage('quotes'); onQuotes(); }, 2000);
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={f.title}>
        <div className="grabber" />
        <div className="sheet-head">
          <div>
            <span className={`pill ${booked ? 'ok' : f.severity}`}>{booked ? 'Repair booked' : SEVERITY_LABEL[f.severity]}</span>
            <h2>{f.title}</h2>
            <p>New since scan {y.previousScanNo}</p>
          </div>
          <button className="xbtn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="seg" role="group" aria-label="Photo or position">
          <button aria-pressed={view === 'photo'} onClick={() => setView('photo')}>Photo</button>
          <button aria-pressed={view === 'where'} onClick={() => setView('where')}>Where on the hull</button>
        </div>
        <div className="media">
          {view === 'photo' ? (
            <Photo p={photo} className="fill" />
          ) : (
            <div className="hullmap fill center">
              {/* pins are placed in the image's own box, not the taller photo frame around it */}
              <div className="hm-inner">
                <img src={hullMap.img} alt={`Where the ${f.title.toLowerCase()} is on the hull`} />
                {pin && <span className="pin ring-pin" style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }} />}
              </div>
            </div>
          )}
        </div>
        <div className="list inset">
          <div className="kv"><span><MapPin />Where</span><b>{f.where}</b></div>
          <div className="kv"><span><Ruler />Size</span><b>{f.size}</b></div>
          <div className="kv"><span><Clock />Found</span><b>Scan {y.scanNo}, today</b></div>
        </div>
        <h4>What it means</h4>
        <p className="body">{f.detail}</p>
        <h4>What to do</h4>
        <p className="body">{f.action}</p>
        <p className="note">The scan screens for changes. A repair partner checks the damage on site before any work starts.</p>
        {booked ? (
          <div className="booked"><CheckCircle2 />Booked with {booked}. We will check it on your next dive.</div>
        ) : stage === 'idle' ? (
          <button className="btn-fill" onClick={request}><Wrench />Get repair quotes</button>
        ) : stage === 'sending' ? (
          <div className="spin"><i />Sending the scan to repair partners near Hurghada…</div>
        ) : (
          <>
            <Photo p={YARD_PHOTO} className="yard"><span className="yard-label">Repair partners near Hurghada</span></Photo>
            <h4>{f.quotes.length} quotes <span className="muted">· example partners</span></h4>
            <div className="list">
              {f.quotes.map((q) => (
                <div className="quote" key={q.partner}>
                  <div><b>{q.partner}</b><span>{q.method}</span><small><Clock />{q.when}</small></div>
                  <button onClick={() => onBook(q.partner)}>Choose</button>
                </div>
              ))}
            </div>
          </>
        )}
        <button className="btn-plain" onClick={onClose}>Close</button>
      </div>
    </>
  );
}

function TimeLapse({ y, plans, levels }: { y: Yacht; plans: string[]; levels: AppData['levels'] }) {
  const [i, setI] = useState(levels.months.length - 1);
  const n = levels.months.length;
  const W = 320, H = 110, B = H - 18, T = 8;
  const xs = (k: number) => 16 + (k * (W - 32)) / (n - 1);
  const yv = (v: number) => B - (v / 100) * (B - T);
  const aPath = levels.anode.map((v, k) => `${k ? 'L' : 'M'}${xs(k).toFixed(1)} ${yv(v).toFixed(1)}`).join(' ');
  const pct = (i / (n - 1)) * 100;
  return (
    <>
      <LargeTitle eyebrow={`MY ${y.name}`} title="Time-lapse" sub="Your hull at every monthly scan. Drag through the year." />
      <div className="oa-body">
        <section className="card pad-s">
          <div className="plan">
            <img src={plans[i]} alt={`Hull at the ${levels.months[i]} scan`} />
            <span className="plan-badge">Scan {y.scanNo - (n - 1 - i)} · {levels.months[i]}</span>
          </div>
          <div className="slider">
            <input type="range" min={0} max={n - 1} value={i} onChange={(e) => setI(+e.target.value)} aria-label="Choose a scan" style={{ ['--p' as string]: `${pct}%` }} />
            <div className="ticks">{levels.months.map((m, k) => <span key={k} className={k === i ? 'on' : ''}>{m}</span>)}</div>
          </div>
        </section>
        <div className="tiles three">
          <div className="tile"><span className="tile-k">Growth found</span><b className="sm">{growthWord(levels.growth[i])}</b></div>
          <div className="tile"><span className="tile-k">Anodes left</span><b className="sm">{levels.anode[i]}%</b></div>
          <div className="tile"><span className="tile-k">Changes</span><b className="sm">{i === n - 1 ? `${y.findings.length} new` : 'None'}</b></div>
        </div>
        <div className="event"><Sparkles />{levels.events[i]}</div>

        <h2 className="sec">Growth before cleaning</h2>
        <section className="card">
          <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Growth found at each scan">
            {[0.5, 1].map((g) => <line key={g} x1="0" x2={W} y1={B - g * (B - T)} y2={B - g * (B - T)} stroke="#EFEDE8" />)}
            <line x1="0" x2={W} y1={B} y2={B} stroke="#E2DFD8" />
            {levels.growth.map((g, k) => {
              const h = Math.max(4, g * (B - T));
              return <rect key={k} x={xs(k) - 8} y={B - h} width="16" height={h} rx="3" fill={k === i ? '#0A2233' : '#9DCFD2'} />;
            })}
            {levels.months.map((m, k) => <text key={k} x={xs(k)} y={H - 3} textAnchor="middle" className={k === i ? 'on' : ''}>{m}</text>)}
          </svg>
        </section>

        <h2 className="sec">Anode metal left</h2>
        <section className="card">
          <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Anode level at each scan">
            <line x1="0" x2={W} y1={yv(50)} y2={yv(50)} stroke="#F0C2B6" strokeDasharray="3 4" />
            <text x={W - 2} y={yv(50) - 4} textAnchor="end">replace when half is gone</text>
            <line x1="0" x2={W} y1={B} y2={B} stroke="#E2DFD8" />
            <path d={`${aPath} L ${xs(n - 1)} ${B} L ${xs(0)} ${B} Z`} fill="rgba(208,138,18,.10)" />
            <path d={aPath} fill="none" stroke="#D08A12" strokeWidth="2.4" strokeLinejoin="round" />
            <circle cx={xs(i)} cy={yv(levels.anode[i])} r="5" fill="#fff" stroke="#0A2233" strokeWidth="2.5" />
            {levels.months.map((m, k) => <text key={k} x={xs(k)} y={H - 3} textAnchor="middle" className={k === i ? 'on' : ''}>{m}</text>)}
          </svg>
        </section>
      </div>
    </>
  );
}

function Berth({ y }: { y: Yacht }) {
  const r = useMemo(() => mulberry32(y.seed ^ 0xbe), [y.seed]);
  const facts = useMemo(() => ({ depth: (3 + r() * 1.2).toFixed(1), pile: r() < 0.6, pileNo: Math.max(1, Number(y.berth.split('-')[1]) - 2) }), [r, y.berth]);
  const my = Number(y.berth.split('-')[1]);
  const berths = Array.from({ length: 7 }, (_, k) => my - 3 + k).filter((b) => b > 0);
  return (
    <>
      <LargeTitle eyebrow={`Pontoon ${y.pontoon} · Hurghada Marina`} title={`Berth ${y.berth}`} sub="What holds your yacht in place, checked in every marina scan." />
      <div className="oa-body">
        <div className="hero short">
          <Photo p={MARINA_PHOTO} className="hero-photo" credit={false} />
          <span className="hero-credit">{MARINA_PHOTO.credit}</span>
        </div>
        <section className="card pad-s">
          <svg className="marina" viewBox="0 0 340 236" role="img" aria-label={`Map of pontoon ${y.pontoon}`}>
            <rect x="0" y="0" width="340" height="236" rx="10" fill="#EAF3F4" />
            {Array.from({ length: 6 }, (_, k) => <path key={k} d={`M0 ${150 + k * 15} Q 85 ${144 + k * 15} 170 ${150 + k * 15} T 340 ${150 + k * 15}`} fill="none" stroke="rgba(11,127,132,.08)" />)}
            <rect x="14" y="30" width="312" height="16" rx="4" fill="#D9CFC0" />
            <text x="16" y="22" fontSize="10.5" fontWeight="700" fill="#8E8A82" letterSpacing="1">PONTOON {y.pontoon}</text>
            {berths.map((b, k) => {
              const x = 34 + k * 44, me = b === my;
              return (
                <g key={b}>
                  <rect x={x - 2} y="46" width="4" height="76" rx="1" fill="#C9C1B4" />
                  {k < berths.length - 1 && (
                    <>
                      <path d={`M${x + 22} 56 l -13 0 q -7 24 0 56 l 13 7 l 13 -7 q 7 -32 0 -56 z`} fill={me ? '#0B7F84' : '#FFFFFF'} stroke={me ? '#0B7F84' : '#D8D4CC'} strokeWidth="1.2" />
                      <text x={x + 22} y="142" textAnchor="middle" fontSize={me ? 11.5 : 10} fontWeight={me ? 700 : 500} fill={me ? '#0B7F84' : '#9A968E'}>{y.pontoon}-{String(b).padStart(2, '0')}</text>
                      <path d={`M${x + 22} 121 Q ${x + 31} 170 ${x + 25} 204`} fill="none" stroke={me ? '#0B7F84' : '#CFCAC1'} strokeDasharray="2 4" strokeWidth="1.5" />
                      <rect x={x + 17} y="204" width="16" height="8" rx="2" fill={me ? '#0B7F84' : '#CFCAC1'} />
                    </>
                  )}
                </g>
              );
            })}
            {facts.pile && <><circle cx={34 + 44} cy="38" r="8" fill="#fff" stroke="#E5533A" strokeWidth="2" /><circle cx={34 + 44} cy="38" r="2.8" fill="#E5533A" /></>}
            <text x="328" y="228" textAnchor="end" fontSize="10" fill="#8E8A82">depth {facts.depth} m</text>
          </svg>
        </section>

        <div className="list">
          <div className="row"><span className="row-icon" style={{ background: '#E6F4F4', color: '#0B7F84' }}><Link2 /></span><span className="row-main"><b>Mooring chain and block</b><span>Checked in the Q3 marina scan</span></span><span className="row-v">OK</span></div>
          <div className="row"><span className="row-icon" style={{ background: '#E8F0FB', color: '#3D6FC4' }}><Waves /></span><span className="row-main"><b>Berth depth</b><span>No silting since the last scan</span></span><span className="row-v">{facts.depth} m</span></div>
          <div className="row"><span className="row-icon" style={{ background: '#EEF6EA', color: '#4F8A3A' }}><LifeBuoy /></span><span className="row-main"><b>Pontoon floats</b><span>No change</span></span><span className="row-v">OK</span></div>
          {facts.pile && <div className="row"><span className="row-icon" style={{ background: '#FDECE8', color: '#D2472F' }}><AlertTriangle /></span><span className="row-main"><b>Nearby: pile {y.pontoon}-{String(facts.pileNo).padStart(2, '0')}</b><span>Corrosion flagged for engineer review. The marina has been told.</span></span></div>}
        </div>

      </div>
    </>
  );
}

function HistoryTab({ y, levels, booked }: { y: Yacht; levels: AppData['levels']; booked: Record<string, string> }) {
  const first = new Date();
  first.setMonth(first.getMonth() - (y.scanNo - 1));
  const n = levels.months.length;
  const items = useMemo(() => {
    const out: { date: string; title: string; text: string; tags: string[]; key?: boolean }[] = [];
    for (let k = 0; k < Math.min(n, y.scanNo - 1); k++) {
      const d = new Date(); d.setMonth(d.getMonth() - k);
      const idx = n - 1 - k;
      const ev = levels.events[idx] ?? '';
      out.push({
        date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: k === 0 || d.getMonth() === 11 ? 'numeric' : undefined }),
        title: k === 0 ? `Dive ${y.scanNo} · today` : `Dive ${y.scanNo - k}`,
        text: k === 0 ? `Cleaned and scanned · ${y.findings.length} new ${y.findings.length === 1 ? 'finding' : 'findings'}` : ev || 'Cleaned and scanned · no changes',
        tags: [`Growth: ${growthWord(levels.growth[idx] ?? 0).toLowerCase()}`, `Anodes ${levels.anode[idx] ?? y.anodePct}% left`],
        key: k === 0 || ev.startsWith('Anodes'),
      });
    }
    return out;
  }, [y, levels, n]);
  const repairs = Object.entries(booked);
  return (
    <>
      <LargeTitle eyebrow={`MY ${y.name}`} title="History" sub={`Every dive, scan and repair on your hull since ${first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}.`} />
      <div className="oa-body">
        <div className="tiles three">
          <div className="tile"><span className="tile-k">Dives</span><b className="sm">{y.scanNo}</b></div>
          <div className="tile"><span className="tile-k">Repairs booked</span><b className="sm">{repairs.length}</b></div>
          <div className="tile"><span className="tile-k">Open findings</span><b className="sm">{y.findings.length - repairs.length}</b></div>
        </div>

        {repairs.length > 0 && (
          <>
            <h2 className="sec">Repairs</h2>
            <div className="list">
              {repairs.map(([id, partner]) => {
                const f = y.findings.find((x) => x.id === id);
                return (
                  <div className="row" key={id}>
                    <span className="row-icon" style={{ background: '#E4F3EE', color: '#1F7A55' }}><Wrench /></span>
                    <span className="row-main"><b>{f?.title}</b><span>Booked with {partner} · checked on the next dive</span></span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <h2 className="sec">Dives and scans</h2>
        <section className="card">
          <div className="timeline">
            {items.map((it) => (
              <div className={`tl${it.key ? ' key' : ''}`} key={it.title}>
                <time>{it.date}</time>
                <span className="tl-dot"><i /></span>
                <div><b>{it.title}</b><span>{it.text}</span><em className="tl-tags">{it.tags.join(' · ')}</em></div>
              </div>
            ))}
            <div className="tl key">
              <time>{first.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</time>
              <span className="tl-dot"><i /></span>
              <div><b>Dive 1</b><span>First dive · baseline 3D scan of the hull</span></div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
