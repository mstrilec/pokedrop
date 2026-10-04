import { type PackTemplateId, PackTemplateIdSchema } from '@pokedrop/shared';
import { z } from 'zod';

// /packs/open?template=<templateId>&open=<openId> is the whole hand-off from
// the confirm dialog to the reveal. The tap on the sealed pack is the request.
export type OpenParams = { templateId: PackTemplateId; openId: string };

const OPENED_PREFIX = 'pokedrop.opened.';
const OpenIdSchema = z.uuid();

export function openUrl(templateId: PackTemplateId): string {
  const params = new URLSearchParams({ template: templateId, open: crypto.randomUUID() });
  return `/packs/open?${params.toString()}`;
}

export function parseOpenParams(
  params: Record<string, string | string[] | undefined>,
): OpenParams | null {
  const template = PackTemplateIdSchema.safeParse(params.template);
  const open = OpenIdSchema.safeParse(params.open);
  return template.success && open.success ? { templateId: template.data, openId: open.data } : null;
}

/** Set once the opening's answer arrived, so a reload replays it instead of offering a second tap. */
export function markOpened(openId: string): void {
  try {
    sessionStorage.setItem(`${OPENED_PREFIX}${openId}`, '1');
  } catch {
    // Storage refused: a reload then shows the sealed pack, and the tap replays for free.
  }
}

export function wasOpened(openId: string): boolean {
  try {
    return sessionStorage.getItem(`${OPENED_PREFIX}${openId}`) === '1';
  } catch {
    return false;
  }
}
