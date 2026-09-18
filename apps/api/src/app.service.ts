import { Injectable } from '@nestjs/common';
import { RoleSchema, type Card, type Role } from '@pokedrop/shared';

@Injectable()
export class AppService {
  readonly defaultRole: Role = RoleSchema.enum.MEMBER;

  describeCard(card: Card): string {
    return `${card.name} — ${card.rarity ?? 'unknown rarity'}`;
  }

  getHello(): string {
    return 'Hello World!';
  }
}
