import { ImageResponse } from 'next/og';
import { OG_IMAGE } from '../lib/public-metadata';

// The one shared-link card for the whole site. Next attaches it on its own only
// to routes that set no `openGraph` metadata (the signed-in app); every public
// page names it explicitly via `publicPageMetadata` (`OG_IMAGE`).
// Colours match `app/icon.svg`. The default `next/og` font is used on purpose —
// loading a brand font here means vendoring a TTF just for this card.

export const alt = OG_IMAGE.alt;
export const size = { width: OG_IMAGE.width, height: OG_IMAGE.height };
export const contentType = 'image/png';

const INK = '#1a1612';
const PAPER = '#faf7f1';
const ACCENT = '#c96442';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px 96px',
          background: INK,
          color: PAPER,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: -4, lineHeight: 1 }}>
            drill
          </div>
          <div style={{ width: 150, height: 14, borderRadius: 7, background: ACCENT, marginTop: 16 }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>
            Type it, don’t tap it.
          </div>
          <div style={{ fontSize: 34, opacity: 0.75 }}>
            Spanish · German · Turkish — grammar explained, forms drilled.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
