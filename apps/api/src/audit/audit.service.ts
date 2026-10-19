import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TransactionClient } from '../prisma/index.js';

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  meta: Prisma.InputJsonObject;
};

/**
 * Append-only: add no update or delete path. Takes the caller's transaction so a rolled-back
 * action leaves no row.
 */
@Injectable()
export class AuditService {
  async record(tx: TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: entry });
  }
}
