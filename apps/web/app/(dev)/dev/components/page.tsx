import type { Metadata } from 'next';
import { CardsSection } from './_sections/cards';
import { DataDisplaySection } from './_sections/data-display';
import { DomainSection } from './_sections/domain';
import { InputsSection } from './_sections/inputs';
import { NavigationSection } from './_sections/navigation';
import { OverlaysSection } from './_sections/overlays';
import { PrimitivesSection } from './_sections/primitives';

export const metadata: Metadata = { title: 'Components', robots: { index: false } };

export default function ComponentsGallery() {
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-h1">Component library</h1>
        <p className="text-mut">
          Every component in docs/ComponentSpecs.md, in each variant and state. Development only.
        </p>
      </header>
      <PrimitivesSection />
      <InputsSection />
      <NavigationSection />
      <CardsSection />
      <DataDisplaySection />
      <OverlaysSection />
      <DomainSection />
    </>
  );
}
