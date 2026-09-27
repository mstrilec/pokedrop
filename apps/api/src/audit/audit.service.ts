import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TransactionClient } from '../prisma/index.js';

export type AuditEntry = {
  /** `null` means the system acted, never "a user who was removed". */
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  meta: Prisma.InputJsonObject;
};

/**
 * Append-only by convention: there is no update or delete path here, and none
 * should be added. Takes the caller's transaction so a rolled-back action
 * leaves no row behind.
 */
@Injectable()
export class AuditService {
  async record(tx: TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: entry });
  }
}
