import { Injectable } from '@nestjs/common';
import { RoleSchema, type Role } from '@pokedrop/shared';

@Injectable()
export class AppService {
  /**
   * Placeholder service. Real modules land from PD-14 onward.
   *
   * The @pokedrop/shared import is deliberate: it exercises the contract
   * boundary from the API side too, so a break in the shared package fails
   * `pnpm typecheck` here and not only in apps/web.
   */
  readonly defaultRole: Role = RoleSchema.enum.MEMBER;

  getHello(): string {
    return 'Hello World!';
  }
}
