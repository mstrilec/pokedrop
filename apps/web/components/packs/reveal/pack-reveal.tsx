'use client';

import type { PackOpenResult } from '@pokedrop/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { prefersReducedMotion } from '@/lib/motion';
import { markOpened, type OpenParams, openUrl, wasOpened } from '@/lib/pack-open-flow';
import { useOpenPack, usePackTemplates } from '@/lib/query/packs';
import { PackRevealProvider, usePackReveal } from '@/lib/stores/pack-reveal';
import { OpeningStage } from './opening-stage';
import { RevealStage } from './reveal-stage';
import { SealedStage } from './sealed-stage';
import { SummaryStage } from './summary-stage';

const OPENING_MIN_MS = 2000;
const STILL_OPENING_MS = 6000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const noSubscription = () => () => {};

/** The client root of /packs/open: the reveal store lives here, one per openId. */
export function PackRevealScreen(params: OpenParams) {
  return (
    <PackRevealProvider key={params.openId}>
      <PackReveal {...params} />
    </PackRevealProvider>
  );
}

function PackReveal({ templateId, openId }: OpenParams) {
  const router = useRouter();
  const stage = usePackReveal((state) => state.stage);
  const index = usePackReveal((state) => state.index);
  const send = usePackReveal((state) => state.send);
  const template = usePackTemplates().data?.find((candidate) => candidate.id === templateId);
  const openPack = useOpenPack();
  const mounted = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  const [result, setResult] = useState<PackOpenResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [replaying, setReplaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const started = useRef(false);
  // Read once: whether this load is a return to an opened pack. Rendered only after mount.
  const [openedOnArrival] = useState(() => typeof window !== 'undefined' && wasOpened(openId));

  async function start(replay: boolean) {
    setError(null);
    setReplaying(replay);
    send({ type: 'open' });
    const minimum = replay || prefersReducedMotion() ? 0 : OPENING_MIN_MS;
    const slowTimer = replay ? undefined : setTimeout(() => setSlow(true), STILL_OPENING_MS);
    try {
      // Marked as soon as the answer is in, not after the animation's floor: a reload
      // or Back and Forward in between must replay, not offer a second tap.
      const [opened] = await Promise.all([
        openPack.mutateAsync({ templateId, openId }).then((answer) => {
          markOpened(openId);
          return answer;
        }),
        delay(minimum),
      ]);
      setResult(opened);
      send({ type: 'opened', total: opened.cards.length });
      if (replay) send({ type: 'skip' });
    } catch (caught) {
      setError(caught);
      send({ type: 'failed' });
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
      setReplaying(false);
    }
  }

  // A reload after the opening: replay it (free, the same cards) and go to the summary.
  const replayIfOpened = useEffectEvent(() => {
    if (started.current || !wasOpened(openId)) return;
    started.current = true;
    void start(true);
  });
  useEffect(() => replayIfOpened(), []);

  const name = template?.name ?? 'Your pack';
  const pendingReplay = mounted && openedOnArrival && stage === 'sealed' && error === null;

  if (!mounted || pendingReplay || replaying) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 text-mut">
        <Spinner />
        Loading your pack…
      </div>
    );
  }

  switch (stage) {
    case 'sealed':
      return (
        <SealedStage
          name={name}
          error={error}
          onOpen={() => {
            started.current = true;
            void start(wasOpened(openId));
          }}
        />
      );
    case 'opening':
      return <OpeningStage name={name} slow={slow} />;
    case 'reveal':
      return result ? (
        <RevealStage
          cards={result.cards}
          index={index}
          onNext={() => send({ type: 'next' })}
          onSkip={() => send({ type: 'skip' })}
        />
      ) : null;
    case 'summary':
      return result ? (
        <SummaryStage
          name={name}
          result={result}
          template={template}
          onOpenAnother={(next) => router.replace(openUrl(next.id))}
        />
      ) : null;
  }
}
