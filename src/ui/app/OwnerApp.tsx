import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Activity, History, Anchor, BookOpen, ChevronRight, X, RotateCcw, Ruler, Shell, Timer, Trash2, CheckCircle2, Clock, Wrench,
  Waves, Link2, LifeBuoy, AlertTriangle, CalendarDays, CloudLightning, Share2,
} from 'lucide-react';
import { healthScore, SEVERITY_LABEL, mulberry32, type Yacht, type Finding } from '../../lib/yacht';
import type { CleanStats } from '../../three/Experience';
import * as sound from '../../lib/sound';
import Photo from './Photo';
import { yachtPhoto, FINDING_PHOTOS, MARINA_PHOTO, YARD_PHOTO, DIVER_PHOTO } from '../../lib/photos';
import './app.css';

export interface AppData {
  yacht: Yacht;
  stats: CleanStats;
  hullMap: HullMap;
  plans: string[];
  levels: { growth: number[]; anode: number[]; months: string[]; events: string[] };
}

export interface HullMap { img: string; pins: { id: string; x: number; y: number }[] }
type Tab = 'report' | 'time' | 'berth' | 'pass';
const fmt = (s: number) => `${Math.floor(s / 60)}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`;
const growthWord = (g: number) => (g > 0.8 ? 'Heavy' : g > 0.45 ? 'Medium' : 'Light');

function Ring({ value }: { value: number }) {
  const r = 30, c = 2 * Math.PI * r;
  const col = value >= 80 ? '#11A3A9' : value >= 60 ? '#E9A23B' : '#FF6B4A';
  return (
    <svg className="ring" width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
      <circle cx="38" cy="38" r={r} fill="none" stroke="#E8EEEF" strokeWidth="8" />
      <circle cx="38" cy="38" r={r} fill="none" stroke={col} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} transform="rotate(-90 38 38)" style={{ transition: 'stroke-dashoffset 1.2s ease' }} />
      <text x="38" y="44" textAnchor="middle" fontSize="19" fontWeight="700" fill="#0b1f2c">{value}</text>
    </svg>
  );
}

export default function OwnerApp({ data, onRestart }: { data: AppData; onRestart: () => void }) {
  const { yacht: y, stats, hullMap, plans, levels } = data;
  const hero = yachtPhoto(y);
  const [tab, setTab] = useState<Tab>('report');
  const [open, setOpen] = useState<Finding | null>(null);
  const [booked, setBooked] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const score = healthScore(y);
  const toastT = useRef(0);

  const notify = useCallback((title: string, body: string) => {
    sound.ping();
    setToast({ title, body });
    clearTimeout(toastT.current);
    toastT.current = window.setTimeout(() => setToast(null), 3800);
  }, []);

  const go = (t: Tab) => { setTab(t); scroller.current?.scrollTo({ top: 0 }); };

  return (
    <div className="oa">
      <div className="oa-scroll" ref={scroller}>
        {tab === 'report' && (
          <>
            <header className="oa-hero">
              <Photo p={hero} className="oa-hero-bg" credit={false} />
              <span className="oa-hero-credit">{hero.credit}</span>
              <div className="oa-hero-top">
                <img className="oa-logo" src="/logo-white.png" alt="UNDERSEEN" />
                <button className="oa-round" onClick={onRestart} aria-label="Try another name"><RotateCcw /></button>
              </div>
              <div className="oa-hero-bottom">
                <small>{y.owner}'s yacht</small>
                <h1>MY {y.name}</h1>
                <span>{y.lengthFt} ft {y.style} · Berth {y.berth} · Hurghada</span>
              </div>
            </header>
            <div className="oa-body">
              <div className="oa-card oa-health">
                <Ring value={score} />
                <div>
                  <small>Hull condition</small>
                  <b>{score >= 80 ? 'Good' : score >= 60 ? 'Needs attention' : 'Act soon'}</b>
                  <span>Scan {y.scanNo} · today · {y.findings.length} new {y.findings.length === 1 ? 'finding' : 'findings'}</span>
                </div>
              </div>
              <div className="oa-tiles">
                <div className="oa-tile"><Ruler /><b>{Math.round(stats.areaM2)} m²</b><span>Hull cleaned</span></div>
                <div className="oa-tile"><Shell /><b>{stats.removed}</b><span>Barnacles removed</span></div>
                <div className="oa-tile"><Trash2 /><b>{stats.debrisKg.toFixed(1)} kg</b><span>Growth in the filter (est.)</span></div>
                <div className="oa-tile"><Timer /><b>{fmt(stats.seconds)}</b><span>Robot on the hull</span></div>
              </div>

              <h3 className="oa-sec">Findings <span>tap for details</span></h3>
              {y.findings.map((f) => (
                <button key={f.id} className="oa-finding" onClick={() => setOpen(f)}>
                  <Photo p={FINDING_PHOTOS[f.kind]} className="oa-thumb" credit={false} />
                  <div>
                    <b>{f.title}</b>
                    <span className="w">{f.where}</span>
                    {booked[f.id] ? <span className="chip ok"><i />Repair booked</span> : <span className={`chip ${f.severity}`}><i />{SEVERITY_LABEL[f.severity]}</span>}
                  </div>
                  <ChevronRight className="chev" />
                </button>
              ))}

              <h3 className="oa-sec">Anodes</h3>
              <div className="oa-card oa-anode">
                <div className="row"><b>Zinc anodes</b><span className="pct">{y.anodePct}%</span></div>
                <div className="track"><i style={{ width: `${y.anodePct}%`, background: y.anodePct < 40 ? '#FF6B4A' : '#E9A23B' }} /></div>
                <p>{y.anodePct < 40 ? 'Replace them within a month. Below 50% they stop protecting the propellers and shafts properly.' : `Plan a replacement within ${y.anodePct < 60 ? 2 : 4} months. We replace them at 50%.`}</p>
              </div>

              <h3 className="oa-sec">Hull map <span>seen from below</span></h3>
              <div className="oa-card" style={{ padding: 10 }}>
                <div className="oa-hullmap">
                  <img src={hullMap.img} alt={`Underside of MY ${y.name} with the findings marked`} />
                  {hullMap.pins.map((p, i) => (
                    <button key={p.id} className="pin" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} onClick={() => setOpen(y.findings.find((f) => f.id === p.id) ?? null)} aria-label={y.findings.find((f) => f.id === p.id)?.title}>{i + 1}</button>
                  ))}
                </div>
                <div className="oa-pinlist">
                  {y.findings.map((f, i) => <button key={f.id} onClick={() => setOpen(f)}><i>{i + 1}</i>{f.title}<span>{f.side === 'centre' ? '' : f.side}</span></button>)}
                </div>
              </div>

              <div className="oa-card oa-review" style={{ marginTop: 4 }}>
                <Photo p={DIVER_PHOTO} className="thumb" credit={false}><span className="cal-badge">DEC</span></Photo>
                <p><b>Annual Hull Review</b><br />A short video of your boat's year below the waterline, and what to plan for next season.</p>
              </div>
              <p className="oa-credits">Photos: {hero.credit}, {y.findings.map((f) => FINDING_PHOTOS[f.kind].credit).join(', ')}, {DIVER_PHOTO.credit}.</p>
            </div>
          </>
        )}

        {tab === 'time' && <TimeLapse y={y} plans={plans} levels={levels} />}
        {tab === 'berth' && <Berth y={y} notify={notify} />}
        {tab === 'pass' && <Passport y={y} levels={levels} />}
      </div>

      <nav className="oa-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'report'} onClick={() => go('report')}><Activity />Report</button>
        <button role="tab" aria-selected={tab === 'time'} onClick={() => go('time')}><History />Time-lapse</button>
        <button role="tab" aria-selected={tab === 'berth'} onClick={() => go('berth')}><Anchor />Berth</button>
        <button role="tab" aria-selected={tab === 'pass'} onClick={() => go('pass')}><BookOpen />Passport</button>
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
        <div className="oa-toast" role="status">
          <span className="ico"><img src="/favicon.svg" alt="" /></span>
          <div><b>{toast.title}</b><span>{toast.body}</span></div>
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
      <div className="oa-scrim" onClick={onClose} />
      <div className="oa-sheet" role="dialog" aria-modal="true" aria-label={f.title}>
        <div className="oa-grab" />
        <div className="oa-sheet-head">
          <div><h2>{f.title}</h2><p>New since scan {y.previousScanNo} · found by comparing the two scans</p></div>
          <button className="oa-x" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="oa-compare">
          {view === 'photo' ? (
            <Photo p={photo} className="fill"><span className="stamp">SCAN {y.scanNo} · TODAY</span></Photo>
          ) : (
            <div className="oa-hullmap fill-map">
              <img src={hullMap.img} alt={`Where the ${f.title.toLowerCase()} is on the hull`} />
              {pin && <span className="pin big" style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }} />}
              <span className="stamp">{f.where.toUpperCase()}</span>
            </div>
          )}
        </div>
        <div className="oa-seg" role="group" aria-label="Photo or position">
          <button aria-pressed={view === 'photo'} onClick={() => setView('photo')}>Photo</button>
          <button aria-pressed={view === 'where'} onClick={() => setView('where')}>Where on the hull</button>
        </div>
        <div className="oa-facts">
          <div><small>Where</small><b>{f.where}</b></div>
          <div><small>Size</small><b>{f.size}</b></div>
          <div><small>Priority</small><b>{SEVERITY_LABEL[f.severity]}</b></div>
        </div>
        <h4>What it means</h4>
        <p className="t">{f.detail}</p>
        <h4>What to do</h4>
        <p className="t">{f.action}</p>
        <p className="oa-note">The scan screens for changes. A repair partner checks the damage on site before any work starts.</p>
        {booked ? (
          <div className="oa-booked"><CheckCircle2 />Booked with {booked}</div>
        ) : stage === 'idle' ? (
          <button className="oa-btn p" onClick={request}><Wrench />Get repair quotes</button>
        ) : stage === 'sending' ? (
          <div className="oa-spin"><i />Sending the scan to repair partners near Hurghada…</div>
        ) : (
          <>
            <Photo p={YARD_PHOTO} className="oa-yard"><span className="oa-yard-label">Repair partners near Hurghada</span></Photo>
            <h4 style={{ marginTop: 0 }}>{f.quotes.length} quotes · example partners</h4>
            {f.quotes.map((q) => (
              <div className="oa-quote" key={q.partner}>
                <b>{q.partner}</b>
                <span>{q.method}</span>
                <div className="meta"><small><Clock />{q.when}</small><button onClick={() => onBook(q.partner)}>Choose</button></div>
              </div>
            ))}
          </>
        )}
        <button className="oa-btn s" onClick={onClose}>Close</button>
      </div>
    </>
  );
}

function TimeLapse({ y, plans, levels }: { y: Yacht; plans: string[]; levels: AppData['levels'] }) {
  const [i, setI] = useState(levels.months.length - 1);
  const n = levels.months.length;
  const W = 320, H = 90;
  const xs = (k: number) => 14 + (k * (W - 28)) / (n - 1);
  const aPath = levels.anode.map((v, k) => `${k ? 'L' : 'M'}${xs(k).toFixed(1)} ${(H - 14 - ((v - 0) / 100) * (H - 26)).toFixed(1)}`).join(' ');
  return (
    <>
      <div className="oa-title"><small>MY {y.name}</small><h1>Time-lapse</h1><p>Your hull at every monthly scan. Drag to move through the year.</p></div>
      <div className="oa-body">
        <div className="oa-card">
          <div className="oa-plan">
            <img src={plans[i]} alt={`Hull at the ${levels.months[i]} scan`} />
            <span className="badge">Scan {y.scanNo - (n - 1 - i)} · {levels.months[i]}</span>
          </div>
          <input className="oa-range" type="range" min={0} max={n - 1} value={i} onChange={(e) => setI(+e.target.value)} aria-label="Choose a scan" />
          <div className="oa-ticks">{levels.months.map((m, k) => <span key={k} className={k === i ? 'on' : ''}>{m}</span>)}</div>
          <div className="oa-kv">
            <div><small>Growth found</small><b>{growthWord(levels.growth[i])}</b></div>
            <div><small>Anodes</small><b>{levels.anode[i]}%</b></div>
            <div><small>Changes</small><b>{i === n - 1 ? `${y.findings.length} new` : 'None'}</b></div>
          </div>
          <div className="oa-event"><CalendarDays />{levels.events[i]}</div>
        </div>
        <div className="oa-card">
          <b style={{ fontSize: 15 }}>Growth found before cleaning</b>
          <svg className="oa-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Growth by month">
            <line x1="0" x2={W} y1={H - 14} y2={H - 14} stroke="#E2E8E9" />
            {levels.growth.map((g, k) => {
              const h = g * (H - 26);
              return <rect key={k} x={xs(k) - 9} y={H - 14 - h} width="18" height={h} rx="4" fill={k === i ? '#0A2233' : g > 0.8 ? '#FF6B4A' : g > 0.45 ? '#E9A23B' : '#19C3C9'} opacity={k === i ? 1 : 0.75} />;
            })}
            {levels.months.map((m, k) => <text key={k} x={xs(k)} y={H - 2} textAnchor="middle">{m}</text>)}
          </svg>
        </div>
        <div className="oa-card">
          <b style={{ fontSize: 15 }}>Anode level</b>
          <svg className="oa-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Anode level by month">
            {[0, 50, 100].map((v) => <line key={v} x1="0" x2={W} y1={H - 14 - (v / 100) * (H - 26)} y2={H - 14 - (v / 100) * (H - 26)} stroke={v === 50 ? '#F2C7BD' : '#EEF2F3'} strokeDasharray={v === 50 ? '3 3' : undefined} />)}
            <text x={W - 2} y={H - 14 - 0.5 * (H - 26) - 3} textAnchor="end">replace at 50%</text>
            <path d={`${aPath} L ${xs(n - 1)} ${H - 14} L ${xs(0)} ${H - 14} Z`} fill="rgba(233,162,59,.12)" />
            <path d={aPath} fill="none" stroke="#E9A23B" strokeWidth="2.2" />
            <circle cx={xs(i)} cy={H - 14 - (levels.anode[i] / 100) * (H - 26)} r="4.5" fill="#0A2233" stroke="#fff" strokeWidth="2" />
            {levels.months.map((m, k) => <text key={k} x={xs(k)} y={H - 2} textAnchor="middle">{m}</text>)}
          </svg>
        </div>
      </div>
    </>
  );
}

function Berth({ y, notify }: { y: Yacht; notify: (t: string, b: string) => void }) {
  const r = useMemo(() => mulberry32(y.seed ^ 0xbe), [y.seed]);
  const facts = useMemo(() => ({ depth: (3 + r() * 1.2).toFixed(1), pile: r() < 0.6, pileNo: Math.max(1, Number(y.berth.split('-')[1]) - 2) }), [r, y.berth]);
  const [storm, setStorm] = useState<'idle' | 'running' | 'done'>('idle');
  const [waveT, setWaveT] = useState(0);
  useEffect(() => {
    if (storm !== 'running') return;
    const id = setInterval(() => setWaveT((t) => t + 1), 110);
    const done = setTimeout(() => { setStorm('done'); notify('Storm check done', `Your boat and berth ${y.berth}: no changes.`); }, 2800);
    return () => { clearInterval(id); clearTimeout(done); };
  }, [storm, notify, y.berth]);
  const my = Number(y.berth.split('-')[1]);
  const berths = Array.from({ length: 7 }, (_, k) => my - 3 + k).filter((b) => b > 0);
  const now = new Date();
  return (
    <>
      <div className="oa-title"><small>Pontoon {y.pontoon} · Hurghada Marina</small><h1>Berth {y.berth}</h1><p>What holds your yacht in place, checked in every marina scan.</p></div>
      <div className="oa-body">
        <Photo p={MARINA_PHOTO} className="oa-berth-photo" />
        <div className="oa-card" style={{ padding: 10 }}>
          <svg className="oa-map" viewBox="0 0 340 240" role="img" aria-label={`Map of pontoon ${y.pontoon}`}>
            {Array.from({ length: 6 }, (_, k) => <path key={k} d={`M0 ${150 + k * 15} Q 85 ${144 + k * 15} 170 ${150 + k * 15} T 340 ${150 + k * 15}`} fill="none" stroke="rgba(25,195,201,.12)" />)}
            <rect x="14" y="34" width="312" height="16" rx="3" fill="#C9D4D8" />
            <text x="16" y="24" fontSize="11" fontWeight="700" fill="#9DB2BC">PONTOON {y.pontoon}</text>
            {berths.map((b, k) => {
              const x = 34 + k * 44, me = b === my;
              return (
                <g key={b}>
                  <rect x={x - 2} y="50" width="4" height="74" fill="#8FA2AA" />
                  {k < berths.length - 1 && (
                    <>
                      <path d={`M${x + 22} 60 l -13 0 q -7 24 0 56 l 13 7 l 13 -7 q 7 -32 0 -56 z`} fill={me ? 'rgba(25,195,201,.25)' : 'rgba(238,241,238,.1)'} stroke={me ? '#19C3C9' : 'rgba(238,241,238,.35)'} strokeWidth={me ? 2 : 1} />
                      <text x={x + 22} y="144" textAnchor="middle" fontSize={me ? 12 : 10} fontWeight={me ? 800 : 600} fill={me ? '#19C3C9' : '#7D909A'}>{y.pontoon}-{String(b).padStart(2, '0')}</text>
                      <path d={`M${x + 22} 123 Q ${x + 31} 172 ${x + 25} 208`} fill="none" stroke={me ? '#19C3C9' : 'rgba(238,241,238,.25)'} strokeDasharray="2 4" strokeWidth="1.6" />
                      <rect x={x + 17} y="208" width="16" height="8" fill={me ? '#19C3C9' : 'rgba(238,241,238,.3)'} />
                    </>
                  )}
                </g>
              );
            })}
            {facts.pile && <><circle cx={34 + 1 * 44} cy="42" r="8" fill="none" stroke="#FF6B4A" strokeWidth="2" /><circle cx={34 + 44} cy="42" r="2.6" fill="#FF6B4A" /></>}
            <text x="330" y="234" textAnchor="end" fontSize="10" fill="#7D909A">depth {facts.depth} m</text>
            {storm === 'running' && Array.from({ length: 7 }, (_, k) => {
              const yy = 60 + k * 24 + Math.sin(waveT / 2 + k) * 4;
              return <path key={`w${k}`} d={`M0 ${yy} Q 42 ${yy - 10} 85 ${yy} T 170 ${yy} T 255 ${yy} T 340 ${yy}`} fill="none" stroke="rgba(238,241,238,.4)" strokeWidth="1.6" />;
            })}
          </svg>
        </div>
        <div className="oa-card oa-rows">
          <div className="oa-row"><span className="ic" style={{ background: '#DCF4F4', color: '#0B7F84' }}><Link2 /></span><div><b>Mooring chain and block</b><span>Checked in the Q3 marina scan</span></div><span className="v">OK</span></div>
          <div className="oa-row"><span className="ic" style={{ background: '#DCF4F4', color: '#0B7F84' }}><Waves /></span><div><b>Berth depth</b><span>No silting since the last scan</span></div><span className="v">{facts.depth} m</span></div>
          <div className="oa-row"><span className="ic" style={{ background: '#DCF4F4', color: '#0B7F84' }}><LifeBuoy /></span><div><b>Pontoon floats</b><span>No change</span></div><span className="v">OK</span></div>
          {facts.pile && <div className="oa-row"><span className="ic" style={{ background: '#FFE8E2', color: '#C2401F' }}><AlertTriangle /></span><div><b>Nearby: pile {y.pontoon}-{String(facts.pileNo).padStart(2, '0')}</b><span>Corrosion flagged for engineer review. The marina has been told.</span></div><span className="v" /></div>}
        </div>
        <div className="oa-card">
          <b style={{ fontSize: 16 }}>Storm Check</b>
          <p style={{ margin: '4px 0 12px', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>After every storm the robot checks your boat and berth before you ask.</p>
          {storm === 'idle' && <button className="oa-btn p" onClick={() => setStorm('running')}><CloudLightning />Simulate a storm</button>}
          {storm === 'running' && <div className="oa-spin"><i />Storm passed. Checking chain, block and depth at {y.berth}…</div>}
          {storm === 'done' && (
            <>
              <div className="oa-storm"><span className="ico"><img src="/favicon.svg" alt="" /></span><div><b>Storm check done.</b> Your boat and berth {y.berth}: <span style={{ color: 'var(--cyan-ink)', fontWeight: 650 }}>no changes.</span><small>Today {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')} · chain, block and depth re-scanned</small></div></div>
              <button className="oa-btn s" onClick={() => setStorm('running')}>Run it again</button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Passport({ y, levels }: { y: Yacht; levels: AppData['levels'] }) {
  const [qr, setQr] = useState('');
  const first = new Date();
  first.setMonth(first.getMonth() - (y.scanNo - 1));
  const items = useMemo(() => {
    const out: { date: string; title: string; text: string }[] = [];
    const n = levels.months.length;
    for (let k = 0; k < 6; k++) {
      const d = new Date(); d.setMonth(d.getMonth() - k);
      const idx = n - 1 - k;
      out.push({
        date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        title: `Scan ${y.scanNo - k}`,
        text: k === 0 ? `Cleaned · ${y.findings.length} new ${y.findings.length === 1 ? 'finding' : 'findings'}` : levels.events[idx] ?? 'Cleaned and scanned · no changes',
      });
    }
    out.push({ date: first.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), title: 'Scan 1', text: 'First dive · baseline scan of the hull' });
    return out;
  }, [y, levels]);
  const share = async () => {
    const url = `${location.origin}/?name=${encodeURIComponent(y.owner)}`;
    setQr(await QRCode.toDataURL(url, { margin: 1, width: 380, color: { dark: '#0A2233', light: '#FFFFFF' } }));
  };
  return (
    <>
      <div className="oa-title"><small>Proof for buyers, brokers and insurers</small><h1>Hull Passport</h1></div>
      <div className="oa-body">
        <div className="oa-book">
          <Photo p={yachtPhoto(y)} className="oa-book-photo" credit={false} />
          <img src="/logo-white.png" alt="" style={{ width: 120, position: 'relative' }} />
          <small>HULL PASSPORT</small>
          <h2>MY {y.name}</h2>
          <span>{y.lengthFt} ft · {y.scanNo} scans since {first.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span>
        </div>
        <div className="oa-card">
          <b style={{ fontSize: 16 }}>Scan history</b>
          <div className="oa-time" style={{ marginTop: 8 }}>
            {items.map((it) => (
              <div className="oa-ti" key={it.title}><time>{it.date}</time><span className="dotline"><i /></span><div><b>{it.title}</b><span>{it.text}</span></div></div>
            ))}
          </div>
        </div>
        <div className="oa-card">
          <b style={{ fontSize: 16 }}>Selling the boat?</b>
          <p style={{ margin: '4px 0 12px', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.45 }}>Share the full scan history with a buyer, broker or insurer.</p>
          {qr ? (
            <div className="oa-qr"><img src={qr} alt="QR code for this Hull Passport" /><p>Scan to open MY {y.name} in UNDERSEEN.<br />Demo: it opens this yacht in the simulator.</p></div>
          ) : (
            <button className="oa-btn c" onClick={share}><Share2 />Share with a buyer</button>
          )}
        </div>
      </div>
    </>
  );
}
