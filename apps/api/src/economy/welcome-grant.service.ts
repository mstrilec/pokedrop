import { Injectable, Logger } from '@nestjs/common';
import { isUniqueViolation } from '../common/errors/prisma-error.js';
import { PrismaService } from '../prisma/index.js';

/** `docs/UserFlows.md` §1. Verification is what releases it. */
export const WELCOME_GRANT_AMOUNT = 1_000;

/**
 * The idempotency key, not a description. Together with (userId, type) it is
 * the unique constraint added in PD-31, which is what makes a second grant
 * impossible rather than merely unlikely.
 */
export const WELCOME_GRANT_REF = 'welcome';

/**
 * Credits the one-time welcome balance.
 *
 * Idempotent by database constraint, not by checking first. Two concurrent
 * verifications both pass a read-then-write guard at READ COMMITTED; neither
 * passes a unique index.
 */
@Injectable()
export class WelcomeGrantService {
  private readonly logger = new Logger(WelcomeGrantService.name);

  constructor(private readonly prisma: PrismaService) {}

  async grantIfFirstTime(userId: string): Promise<void> {
    try {
      // withTransaction rather than $transaction, per the convention
      // PrismaService's own comment sets for anything that must not half
      // apply. The ledger row and the balance move together or not at all —
      // a balance without a row to explain it is the defect this prevents.
      await this.prisma.withTransaction(async (tx) => {
        await tx.currencyTransaction.create({
          data: {
            userId,
            amount: WELCOME_GRANT_AMOUNT,
            type: 'GRANT',
            refId: WELCOME_GRANT_REF,
          },
        });

        await tx.user.update({
          where: { id: userId },
          data: { currency: { increment: WELCOME_GRANT_AMOUNT } },
        });
      });

      this.logger.log(`Welcome grant credited to ${userId}`);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The expected path on a replayed verification link. Not a failure.
        this.logger.debug(`Welcome grant already credited to ${userId}`);
        return;
      }

      throw error;
    }
  }
}
