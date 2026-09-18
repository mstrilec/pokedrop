import { Injectable, Logger } from '@nestjs/common';
import { isUniqueViolation } from '../common/errors/prisma-error.js';
import { PrismaService } from '../prisma/index.js';

export const WELCOME_GRANT_AMOUNT = 1_000;

export const WELCOME_GRANT_REF = 'welcome';

@Injectable()
export class WelcomeGrantService {
  private readonly logger = new Logger(WelcomeGrantService.name);

  constructor(private readonly prisma: PrismaService) {}

  async grantIfFirstTime(userId: string): Promise<void> {
    try {
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
        this.logger.debug(`Welcome grant already credited to ${userId}`);
        return;
      }

      throw error;
    }
  }
}
