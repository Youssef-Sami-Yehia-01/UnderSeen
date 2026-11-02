// All sounds are synthesised with Web Audio, so there are no audio files to load.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let brushGain: GainNode | null = null;
let jetGain: GainNode | null = null;
let ambGain: GainNode | null = null;
let muted = false;

function noiseBuffer(a: AudioContext, seconds = 2) {
  const len = a.sampleRate * seconds;
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      const nb = noiseBuffer(ctx);
      // brush: mid band noise
      const s1 = ctx.createBufferSource(); s1.buffer = nb; s1.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 850; bp.Q.value = 0.8;
      brushGain = ctx.createGain(); brushGain.gain.value = 0;
      s1.connect(bp); bp.connect(brushGain); brushGain.connect(master); s1.start();
      // jet: bright hiss
      const s2 = ctx.createBufferSource(); s2.buffer = nb; s2.loop = true; s2.playbackRate.value = 1.3;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
      jetGain = ctx.createGain(); jetGain.gain.value = 0;
      s2.connect(hp); hp.connect(jetGain); jetGain.connect(master); s2.start();
      // underwater ambience: low rumble
      const s3 = ctx.createBufferSource(); s3.buffer = nb; s3.loop = true; s3.playbackRate.value = 0.5;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      ambGain = ctx.createGain(); ambGain.gain.value = 0;
      s3.connect(lp); lp.connect(ambGain); ambGain.connect(master); s3.start();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

export function setMuted(m: boolean) {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
}
export const isMuted = () => muted;

export function setLoops(o: { brush?: number; jet?: number; ambience?: number }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  if (o.brush !== undefined && brushGain) brushGain.gain.setTargetAtTime(o.brush * 0.05, t, 0.08);
  if (o.jet !== undefined && jetGain) jetGain.gain.setTargetAtTime(o.jet * 0.035, t, 0.06);
  if (o.ambience !== undefined && ambGain) ambGain.gain.setTargetAtTime(o.ambience * 0.12, t, 0.6);
}

/** The UNDERSEEN Ping: one soft sonar ping with two echoes. */
export function ping() {
  if (!ctx || !master) return;
  const t = ctx.currentTime + 0.02;
  [0, 0.27, 0.54].forEach((d, i) => {
    const o = ctx!.createOscillator(), g = ctx!.createGain(), f = ctx!.createBiquadFilter();
    o.type = 'sine';
    o.frequency.setValueAtTime(1240, t + d);
    o.frequency.exponentialRampToValueAtTime(1150, t + d + 1.3);
    f.type = 'lowpass'; f.frequency.value = 5200 - i * 1600;
    const peak = 0.3 / (1 + i * 2.4);
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(peak, t + d + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.35);
    o.connect(f); f.connect(g); g.connect(master!);
    o.start(t + d); o.stop(t + d + 1.45);
  });
  try { navigator.vibrate?.([25, 70, 25]); } catch { /* not supported */ }
}

/** Short pop when a barnacle comes off. */
export function pop() {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(420 + Math.random() * 260, t);
  o.frequency.exponentialRampToValueAtTime(120, t + 0.09);
  g.gain.setValueAtTime(0.06, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.12);
}

/** Soft rising tone for the scan. */
export function sweep(seconds: number) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(320, t);
  o.frequency.linearRampToValueAtTime(640, t + seconds);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.03, t + 0.3);
  g.gain.setValueAtTime(0.03, t + seconds - 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + seconds + 0.05);
}
