'use client';

import Image from 'next/image';
import { useState } from 'react';
import { isOptimizable } from '@/lib/images';

/** The set's logo, or its name in text when there is none or it fails to load. */
export function SetLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!logoUrl || failed) {
    return (
      <span className="text-center text-small font-extrabold tracking-wide uppercase">{name}</span>
    );
  }
  return (
    <span className="relative block size-full">
      <Image
        src={logoUrl}
        alt=""
        fill
        sizes="160px"
        unoptimized={!isOptimizable(logoUrl)}
        onError={() => setFailed(true)}
        className="object-contain"
      />
    </span>
  );
}
