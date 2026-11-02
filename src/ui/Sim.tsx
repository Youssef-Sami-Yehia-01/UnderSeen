import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Volume2, VolumeX, ArrowRight, Hand, Sparkles, Paintbrush, Waves, ScanLine, Bot, Eye, Crosshair, Plus, Minus, Info, AlertTriangle, RotateCcw,
} from 'lucide-react';
import { Experience, type Phase, type CleanStats, type Label, type ToolMode } from '../three/Experience';
import { makeYacht, healthScore, SEVERITY_LABEL, type Yacht } from '../lib/yacht';
import * as sound from '../lib/sound';
import { saveStart, saveFinish } from '../lib/api';
import OwnerApp, { type AppData } from './app/OwnerApp';
import { REDSEA_PHOTO, YACHT_PHOTOS, MARINA_PHOTO, type Photo } from '../lib/photos';
import { HullShape } from '../three/hull';

type UIPhase = Phase | 'loading' | 'ping' | 'app';
// first-page slideshow: full-screen photos of yachts, Hurghada Marina and the Red Sea coast
const big = (p: Photo): Photo => ({ ...p, src: p.src.replace(/w=\d+/, 'w=1920') });
const SLIDES: (Photo & { caption: string })[] = [
  { ...big(YACHT_PHOTOS[0]), caption: 'Off Hurghada' },
  { ...big(MARINA_PHOTO), caption: 'Hurghada Marina' },
  { ...big(YACHT_PHOTOS[1]), caption: 'Red Sea' },
  { ...big(REDSEA_PHOTO), caption: 'The Red Sea coast' },
  { ...big(YACHT_PHOTOS[4]), caption: 'Moored for the night' },
];

function Slideshow() {
  const [i, setI] = useState(0);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const [paused, setPaused] = useState(false);
  const ok = SLIDES.map((_, k) => k).filter((k) => !failed.has(k));
  useEffect(() => {
    if (paused || ok.length < 2) return;
    const t = window.setTimeout(() => {
      const at = ok.indexOf(i);
      setI(ok[(at + 1) % ok.length]);
    }, 5500);
    return () => clearTimeout(t);
  }, [i, paused, ok.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = SLIDES[i];
  return (
    <div className="slides" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
      {SLIDES.map((sl, k) => (
        <img
          key={sl.src}
          className={`slide${k === i ? ' on' : ''}`}
          src={sl.src}
          alt={k === i ? sl.alt : ''}
          aria-hidden={k !== i}
          loading={k < 2 ? 'eager' : 'lazy'}
          style={{ objectPosition: sl.pos ?? 'center' }}
          onError={() => { setFailed((f) => new Set(f).add(k)); if (k === i) setI((k + 1) % SLIDES.length); }}
        />
      ))}
      <div className="landing-shade" />
      {!failed.has(i) && <span className="landing-credit"><span className="cap">{cur.caption} · </span>Photo: {cur.credit}</span>}
    </div>
  );
}

const fmtTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const GROWTH_COLOR = { light: '#7FD36E', medium: '#E9A23B', heavy: '#FF6B4A' } as const;

function readName() {
  try {
    const q = new URLSearchParams(location.search).get('name');
    if (q) return q;
    return localStorage.getItem('us:name') || '';
  } catch { return ''; }
}

export default function Sim() {
  const mount = useRef<HTMLDivElement>(null);
  const exp = useRef<Experience | null>(null);
  const [phase, setPhase] = useState<UIPhase>('landing');
  const [name, setName] = useState(readName);
  const [yacht, setYacht] = useState<Yacht | null>(null);
  const [stats, setStats] = useState<CleanStats | null>(null);
  const [scanK, setScanK] = useState(0);
  const [labels, setLabels] = useState<Label[]>([]);
  const [tool, setTool] = useState<ToolMode>('auto');
  const [cam, setCam] = useState<'follow' | 'overview'>('follow');
  const [auto, setAuto] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [appData, setAppData] = useState<AppData | null>(null);
  const [now, setNow] = useState(new Date());
  const finalStats = useRef<CleanStats | null>(null);
  const [devScale, setDevScale] = useState(1);
  useEffect(() => {
    const f = () => setDevScale(Math.min(1, (window.innerHeight - 32) / 866, (window.innerWidth - 32) / 412));
    f();
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);

  // the 3D world is only created after the visitor enters a name
  const ensureExp = (initial: Yacht) => {
    if (exp.current || !mount.current) return exp.current;
    const e = new Experience(mount.current, {
      phase: (p) => setPhase(p),
      stats: (s) => setStats(s),
      scan: (k) => setScanK(k),
      labels: (l) => setLabels(l),
    }, initial);
    exp.current = e;
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __us: Experience }).__us = e;
    return e;
  };
  useEffect(() => () => { exp.current?.dispose(); exp.current = null; }, []);

  // autopilot ends on its own when the path is done
  useEffect(() => {
    if (phase !== 'clean') return;
    const id = setInterval(() => { if (exp.current && !exp.current.autopilot && auto) setAuto(false); }, 300);
    return () => clearInterval(id);
  }, [phase, auto]);

  const submitName = (ev: React.FormEvent) => {
    ev.preventDefault();
    const n = name.trim().slice(0, 24);
    if (!n || phase === 'loading') return;
    sound.unlockAudio();
    try { localStorage.setItem('us:name', n); } catch { /* storage off */ }
    const y = makeYacht(n);
    setYacht(y);
    setPhase('loading');
    // let the loading state paint before the 3D world is built
    setTimeout(() => {
      const e = ensureExp(y);
      e?.showYacht(y);
    }, 80);
    void saveStart({ name: n, yacht: y.name, lengthFt: y.lengthFt, fouling: y.fouling });
  };

  const startDive = () => {
    sound.unlockAudio();
    exp.current?.startDive();
  };

  const startScan = () => {
    if (!exp.current) return;
    finalStats.current = exp.current.getStats();
    exp.current.startScan();
  };

  const sendReport = () => {
    if (!exp.current || !yacht) return;
    const st = finalStats.current ?? exp.current.getStats();
    void saveFinish({
      name: yacht.owner, yacht: yacht.name, lengthFt: yacht.lengthFt, fouling: yacht.fouling,
      seconds: Math.round(st.seconds), coverage: Math.round(st.coverage * 100), barnacles: st.removed, findings: yacht.findings.length, score: healthScore(yacht),
    });
    setNow(new Date());
    setPhase('ping');
    setTimeout(() => sound.ping(), 900);
  };

  const openApp = () => {
    const e = exp.current;
    if (!e || !yacht) return;
    const levels = timelapseLevels(yacht);
    const map = e.fouling.planImage(0, true, 900);
    const W = map.canvas.width, H = map.canvas.height;
    setAppData({
      yacht,
      stats: finalStats.current ?? e.getStats(),
      hullMap: {
        img: map.canvas.toDataURL('image/jpeg', 0.88),
        pins: yacht.findings.map((f) => { const [x, y2] = map.map(f.u, f.t); return { id: f.id, x: x / W, y: y2 / H }; }),
      },
      plans: e.planImages(levels.growth, levels.growth.length - 1),
      levels,
    });
    setPhase('app');
  };

  const restart = () => {
    setPhase('landing');
    setYacht(null);
    setAppData(null);
    setStats(null);
    setLabels([]);
    setAuto(false);
    setTool('auto');
    setCam('follow');
    const e = exp.current;
    if (e) e.phase = 'landing';
  };

  const toggleMute = () => { const m = !muted; setMutedState(m); sound.setMuted(m); };

  const hardLeft = !!stats && stats.barnaclesLeft > Math.max(6, stats.barnaclesTotal * 0.12);
  const canScan = !!stats && stats.coverage >= 0.8 && !hardLeft;

  const tip = useMemo(() => {
    if (!stats) return { warn: false, el: <>Press and drag on the hull to steer the robot. Hold still over barnacles to let the jet work.</> };
    if (stats.brushOnBarnacles) return { warn: true, el: <><b>The brush can't lift barnacles.</b> They are cemented to the hull. Switch to the cavitation jet.</> };
    if (stats.activeTool === 'jet') return { warn: false, el: <><b>Cavitation jet on.</b> Bubbles collapse against the shell and crack the cement without stripping the paint.</> };
    if (stats.activeTool === 'brush') return { warn: false, el: <><b>Brushing.</b> Soft nylon bristles lift the slime and weed. Suction pulls it into the filter, so nothing is left in the marina.</> };
    if (canScan) return { warn: false, el: <><b>Hull clean.</b> Start the 3D scan to compare it with last month.</> };
    if (stats.coverage >= 0.8 && hardLeft) return { warn: true, el: <><b>Hard growth is still on the hull.</b> Barnacles need the jet. Turn on Autopilot to finish them.</> };
    if (stats.coverage > 0.35 && !auto) return { warn: false, el: <>Getting tired? Turn on <b>Autopilot</b> and the robot will finish the hull in rows.</> };
    return { warn: false, el: <>Press and drag on the hull to steer the robot. The <b>Auto</b> tool switches to the jet when it finds barnacles.</> };
  }, [stats, canScan, auto, hardLeft]);

  const y = yacht;
  const st = stats;

  return (
    <>
      <div className="stage" ref={mount} />

      {/* top bar */}
      <div className="topbar">
        {phase === 'clean' || phase === 'dive' || phase === 'scan' || phase === 'result' ? (
          <span className="live"><i />{phase === 'scan' ? '3D SCAN' : 'LIVE · ROBOT CAM'}<span className="sep" />{fmtTime(st?.seconds ?? 0)}</span>
        ) : phase === 'intro' ? (
          <div className="brand"><img src="/logo-h-navy.png" alt="UNDERSEEN" /></div>
        ) : <span />}
        {phase !== 'app' && phase !== 'landing' && phase !== 'loading' && (
          <button className="iconbtn" onClick={toggleMute} aria-label={muted ? 'Turn sound on' : 'Turn sound off'}>
            {muted ? <VolumeX /> : <Volume2 />}
          </button>
        )}
      </div>

      {/* landing: photo first, the 3D starts after the name */}
      {(phase === 'landing' || phase === 'loading') && (
        <div className="landing">
          <Slideshow />
          <header className="landing-top"><img src="/logo-h-white.png" alt="UNDERSEEN" /></header>
          <form className="landing-copy" onSubmit={submitName}>
            <div className="landing-eyebrow">Yachting &amp; marine · Hurghada, Red Sea</div>
            <h1 className="landing-title">Dive under your yacht.</h1>
            <p className="landing-lede">Type your name and we will find your yacht in the marina. Then steer our robot to clean its hull, run a 3D scan and get the report on your phone.</p>
            <label htmlFor="owner" className="landing-label">Your name</label>
            <div className="landing-row">
              <input id="owner" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Youssef" maxLength={24} autoComplete="given-name" disabled={phase === 'loading'} />
              <button className="btn btn-light" type="submit" disabled={!name.trim() || phase === 'loading'}>{phase === 'loading' ? 'Finding your yacht…' : 'Find my yacht'}{phase !== 'loading' && <ArrowRight />}</button>
            </div>
            <p className="landing-fine">Every name gets a different yacht with its own problems. Turn your sound on.</p>
          </form>
        </div>
      )}

      {/* intro */}
      {phase === 'intro' && y && (
        <div className="dock glass">
          <div className="eyebrow">{y.owner}'s yacht · Berth {y.berth}</div>
          <h1 className="h-lg">MY {y.name}</h1>
          <div className="specs">
            <div><small>Length</small><b>{y.lengthFt} ft</b></div>
            <div><small>Style</small><b style={{ textTransform: 'capitalize' }}>{y.style}</b></div>
            <div><small>Hull</small><b><span className="swatch" style={{ background: y.hullColor }} />{y.hullColorName}</b></div>
            <div><small>Last cleaned</small><b>{y.weeksSinceClean} weeks ago</b></div>
            <div><small>Growth</small><b className="growth"><i style={{ background: GROWTH_COLOR[y.fouling] }} /><span style={{ textTransform: 'capitalize' }}>{y.fouling}</span></b></div>
            <div><small>Hull area</small><b>{Math.round(new HullShape(y.lengthM, y.beamM).area())} m²</b></div>
          </div>
          <div className="row2">
            <button className="btn btn-primary" onClick={startDive}>Start the dive <ArrowRight /></button>
            <button className="btn btn-ghost btn-sq" onClick={restart} aria-label="Use a different name"><RotateCcw /></button>
          </div>
          <p className="fineprint">The pilot lowers the robot from the tender next to your yacht.</p>
        </div>
      )}

      {phase === 'dive' && (
        <div className="caption glass"><b>The Dive.</b> The robot leaves the tender on its tether and swims under your hull.</div>
      )}

      {/* cleaning */}
      {phase === 'clean' && (
        <>
          <div className="hint-touch"><Hand />Press and drag on the hull</div>
          <div className="side-tools">
            <button className="iconbtn" aria-pressed={cam === 'follow'} onClick={() => { setCam('follow'); exp.current?.setCamMode('follow'); }} aria-label="Follow the robot"><Crosshair /></button>
            <button className="iconbtn" aria-pressed={cam === 'overview'} onClick={() => { setCam('overview'); exp.current?.setCamMode('overview'); }} aria-label="See the whole hull"><Eye /></button>
            <button className="iconbtn" onClick={() => exp.current?.zoom(-0.5)} aria-label="Zoom in"><Plus /></button>
            <button className="iconbtn" onClick={() => exp.current?.zoom(0.5)} aria-label="Zoom out"><Minus /></button>
          </div>
          <div className="hud-panel glass">
            <div className="hud-head"><h2>Clean the hull</h2><span>{y ? `MY ${y.name}` : ''}</span></div>
            <div className="tools" role="group" aria-label="Cleaning tool">
              <button aria-pressed={tool === 'auto'} onClick={() => { setTool('auto'); exp.current?.setTool('auto'); }}><Sparkles />Auto<span className="sub">picks the tool</span></button>
              <button aria-pressed={tool === 'brush'} onClick={() => { setTool('brush'); exp.current?.setTool('brush'); }}><Paintbrush />Brush<span className="sub">soft growth</span></button>
              <button className="jet" aria-pressed={tool === 'jet'} onClick={() => { setTool('jet'); exp.current?.setTool('jet'); }}><Waves />Jet<span className="sub">barnacles</span></button>
            </div>
            <div className="meters one">
              <div className="meter"><small>Hull cleaned <b>{st ? `${Math.round(st.areaM2)} of ${Math.round(st.totalM2)} m²` : '–'}</b></small><div className="bar"><i style={{ width: `${Math.round((st?.coverage ?? 0) * 100)}%` }} /></div></div>
            </div>
            <div className={`tip${tip.warn ? ' warn' : ''}`}>{tip.warn ? <AlertTriangle /> : <Info />}<span>{tip.el}</span></div>
            <div className="actions">
              <button className="btn btn-ghost btn-toggle" aria-pressed={auto} onClick={() => { const v = !auto; setAuto(v); exp.current?.setAutopilot(v); if (v) setCam('follow'); }}><Bot />{auto ? 'Autopilot on' : 'Autopilot'}</button>
              <button className="btn btn-primary" disabled={!canScan} onClick={startScan}><ScanLine />Start 3D scan</button>
            </div>
          </div>
        </>
      )}

      {phase === 'scan' && (
        <div className="scan-card glass">
          <h2>3D scan</h2>
          <p>{scanK < 1 ? 'Cameras are building the 3D model of your hull…' : `Comparing with scan ${y?.previousScanNo}…`}</p>
          <div className="bar"><i style={{ width: `${Math.round(scanK * 100)}%` }} /></div>
        </div>
      )}

      {phase === 'result' && y && (
        <>
          {labels.map((l) => {
            const f = y.findings.find((x) => x.id === l.id);
            if (!f) return null;
            return <div key={l.id} className="tag" style={{ left: l.x, top: l.y, opacity: l.visible ? 1 : 0 }}>{f.title}<small>{SEVERITY_LABEL[f.severity]}</small></div>;
          })}
          <div className="dock glass">
            <div className="eyebrow">Scan {y.scanNo} complete</div>
            <h1 className="h-lg">{y.findings.length} new {y.findings.length === 1 ? 'finding' : 'findings'}</h1>
            <div className="result-list">
              {y.findings.map((f) => <div className="result-item" key={f.id}><i />{f.title}<span>{f.where}</span></div>)}
              <div className="result-item"><i style={{ background: y.anodePct < 40 ? 'var(--coral)' : 'var(--amber)' }} />Anodes at {y.anodePct}%<span>Plan a replacement</span></div>
            </div>
            <button className="btn btn-primary" onClick={sendReport}>Send the report to my phone <ArrowRight /></button>
            <p className="fineprint">Drag to look around the scan. Coral marks what changed since the last scan.</p>
          </div>
        </>
      )}

      {phase === 'ping' && y && (
        <div className="dim">
          <div className="device" style={{ ['--dev-scale' as string]: devScale }}>
            <div className="lock">
              <img className="lock-bg" src={REDSEA_PHOTO.src} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <div className="time">{String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}</div>
              <div className="date">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
              <button className="notif" onClick={openApp} aria-label="Open the UNDERSEEN report">
                <div className="top"><span className="ico"><img src="/favicon.svg" alt="" /></span>UNDERSEEN<span className="when">now</span></div>
                <h3>Scan {y.scanNo} is ready · MY {y.name}</h3>
                <p>Hull cleaned. <em>{y.findings.length} new {y.findings.length === 1 ? 'finding' : 'findings'}</em> since your last scan.</p>
              </button>
              <div className="hint">Tap the notification<i /></div>
            </div>
          </div>
        </div>
      )}

      {phase === 'app' && appData && (
        <div className="dim">
          <div className="device" style={{ ['--dev-scale' as string]: devScale }}>
            <OwnerApp data={appData} onRestart={restart} />
          </div>
        </div>
      )}
    </>
  );
}

export interface Levels { growth: number[]; anode: number[]; months: string[]; events: string[] }

function timelapseLevels(y: Yacht): Levels {
  const months: string[] = [];
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date();
  for (let i = 9; i >= 0; i--) months.push(names[(d.getMonth() - i + 120) % 12]);
  const finalG = y.fouling === 'heavy' ? 1 : y.fouling === 'medium' ? 0.65 : 0.35;
  const growth = months.map((m, i) => {
    if (i === 9) return finalG;
    const summer = ['Jun', 'Jul', 'Aug', 'Sep'].includes(m) ? 0.25 : 0;
    return Math.min(0.75, 0.18 + summer + ((y.seed >> i) & 3) * 0.05);
  });
  const replacedAt = 2 + (y.seed % 3);
  const anode = months.map((_, i) => {
    if (i < replacedAt) return Math.round(Math.max(y.anodePct + 30, 70) - i * 6);
    const span = 9 - replacedAt;
    return Math.round(100 - ((100 - y.anodePct) * (i - replacedAt)) / Math.max(1, span));
  });
  const events = months.map((_, i) => {
    if (i === replacedAt) return 'Anodes replaced';
    if (i === 9) return `${y.findings.length} new ${y.findings.length === 1 ? 'finding' : 'findings'}`;
    if (growth[i] > 0.4) return 'Heavier growth in the summer heat';
    return 'Cleaned and scanned · no changes';
  });
  return { growth, anode, months, events };
}
