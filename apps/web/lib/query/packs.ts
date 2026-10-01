import type { PackTemplateId } from '@pokedrop/shared';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/browser';
import { openPack } from '@/lib/api/endpoints/packs';
import { mutationKeys } from './invalidation';

// The caller makes one openId per attempt and reuses it on a retry, so a
// repeated request replays the opening instead of buying a second pack.
export function useOpenPack() {
  return useMutation({
    mutationKey: mutationKeys.openPack,
    mutationFn: ({ templateId, openId }: { templateId: PackTemplateId; openId: string }) =>
      api.call(openPack(templateId, { openId })),
  });
}
