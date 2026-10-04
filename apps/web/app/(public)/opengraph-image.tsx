import { ImageResponse } from 'next/og';

export const alt = 'PokéDrop: open, collect, build and trade Pokémon cards';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// The image renderer cannot read CSS variables, so the tokens are spelled out
// here as rgb(): --bg, --tx, --mut, --pri and --pri-hover from app/globals.css.
const BG = 'rgb(10, 11, 14)';
const TX = 'rgb(238, 240, 244)';
const MUT = 'rgb(150, 156, 171)';
const PRI = 'rgb(76, 141, 255)';
const PRI_HOVER = 'rgb(93, 153, 255)';

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 88,
        color: TX,
        background: `radial-gradient(900px 500px at 85% -10%, rgba(76, 141, 255, 0.28), transparent 60%), ${BG}`,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 44, fontWeight: 700 }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 18,
            background: `linear-gradient(135deg, ${PRI}, ${PRI_HOVER})`,
          }}
        />
        <span>PokéDrop</span>
      </div>
      <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: -3, marginTop: 56 }}>
        Open. Collect. Build. Trade.
      </div>
      <div style={{ fontSize: 34, color: MUT, marginTop: 24 }}>
        The Pokémon Trading Card Game, collected online.
      </div>
    </div>,
    size,
  );
}
