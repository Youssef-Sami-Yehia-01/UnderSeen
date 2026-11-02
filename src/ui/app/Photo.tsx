import { useState } from 'react';
import type { Photo as P } from '../../lib/photos';

/** Image with a credit line and a calm fallback if the photo cannot load. */
export default function Photo({ p, className, credit = true, children }: { p: P; className?: string; credit?: boolean; children?: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={`ph-wrap ${className ?? ''}${loaded ? ' is-loaded' : ''}`}>
      {!failed && <img src={p.src} alt={p.alt} loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} style={p.pos ? { objectPosition: p.pos } : undefined} />}
      {children}
      {credit && !failed && <span className="ph-credit">{p.credit}</span>}
    </div>
  );
}
