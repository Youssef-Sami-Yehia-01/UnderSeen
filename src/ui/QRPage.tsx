import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** Big QR code for a slide or a printed card: /?view=qr (optionally &url=...). */
export default function QRPage() {
  const params = new URLSearchParams(location.search);
  const url = params.get('url') || location.origin;
  const [img, setImg] = useState('');
  useEffect(() => {
    void QRCode.toDataURL(url, { margin: 1, width: 900, errorCorrectionLevel: 'M', color: { dark: '#0A2233', light: '#FFFFFF' } }).then(setImg);
  }, [url]);
  return (
    <div className="page">
      <div className="qr-wrap">
        <div style={{ display: 'grid', gap: 26, justifyItems: 'center' }}>
          <img src="/logo-navy.png" alt="UNDERSEEN" style={{ width: 'min(320px, 70vw)' }} />
          <div className="qr-card">
            {img && <img className="qr" src={img} alt={`QR code for ${url}`} />}
            <b style={{ fontSize: 22 }}>Scan to dive under your yacht</b>
            <span className="url">{url.replace(/^https?:\/\//, '')}</span>
          </div>
          <p style={{ color: 'var(--ink-3)', fontSize: 14, margin: 0 }}>Right-click the code and save it, or take a screenshot for your slides.</p>
        </div>
      </div>
    </div>
  );
}
