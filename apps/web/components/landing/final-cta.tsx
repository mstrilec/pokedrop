import { ArrowRight, PackageOpen } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Reveal } from './reveal';

// A rainbow border: the surface fills the padding box, the energy gradient the
// border box under it. Several layers with boxes are beyond a bg-[…] utility.
const PANEL = {
  background: [
    'radial-gradient(500px 260px at 85% 20%, color-mix(in srgb, var(--e-fire) 22%, transparent), transparent 70%) padding-box',
    'radial-gradient(500px 260px at 10% 100%, color-mix(in srgb, var(--e-water) 18%, transparent), transparent 70%) padding-box',
    'linear-gradient(var(--surface), var(--surface)) padding-box',
    'linear-gradient(115deg, var(--e-fire), var(--e-lightning), var(--e-grass), var(--e-water), var(--e-psychic), var(--e-fairy)) border-box',
  ].join(', '),
};

export function FinalCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section
      aria-labelledby="cta-title"
      className="mx-auto max-w-300 px-5 pb-14 sm:px-14 sm:pb-20 lg:pb-28"
    >
      <Reveal
        style={PANEL}
        className="relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] items-center gap-8 overflow-hidden rounded-[18px] border border-transparent px-5 py-8 sm:px-10 sm:py-12 lg:px-16 lg:py-18"
      >
        <div className="flex flex-col gap-3">
          <h2
            id="cta-title"
            className="text-[clamp(1.75rem,4vw,3rem)] leading-[1.05] font-extrabold tracking-[-0.03em] text-balance"
          >
            {signedIn ? 'Your next pack is waiting.' : '1,000 coins are waiting for you.'}
          </h2>
          <p className="max-w-115 text-[1rem] leading-relaxed text-pretty text-mut">
            {signedIn
              ? 'Open a pack, finish a set, or answer an offer.'
              : 'Sign up free, open your first packs and start a collection that is yours to trade.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 lg:justify-end">
          {signedIn ? (
            <>
              <Button asChild size="lg" icon={PackageOpen}>
                <Link href="/packs">Open a pack</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/dashboard">Go to your dashboard</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild size="lg" icon={ArrowRight}>
                <Link href="/register">Start collecting free</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/sign-in">Sign in</Link>
              </Button>
            </>
          )}
        </div>
      </Reveal>
    </section>
  );
}
