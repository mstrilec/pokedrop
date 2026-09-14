import { Injectable } from '@nestjs/common';
import { RoleSchema, type Card, type Role } from '@pokedrop/shared';

@Injectable()
export class AppService {
  /**
   * Placeholder service. Real modules land from PD-14 onward.
   *
   * The @pokedrop/shared imports are deliberate: they exercise the contract
   * boundary from the API side, so a change to a shared schema fails
   * `pnpm typecheck` here and not only in apps/web.
   */
  readonly defaultRole: Role = RoleSchema.enum.MEMBER;

  describeCard(card: Card): string {
    return `${card.name} — ${card.rarity ?? 'unknown rarity'}`;
  }

  getHello(): string {
    return 'Hello World!';
  }
}
