import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/index.js';

/**
 * The transaction-scoped client handed to a `withTransaction` callback.
 *
 * It is the full client minus the methods that would break out of the
 * transaction — you cannot nest a `$transaction` or `$connect` inside one.
 */
export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      // Since Prisma 7 the connection string no longer lives in the schema, so
      // the client is constructed with a driver adapter built from the typed
      // config. prisma.config.ts covers the CLI separately.
      adapter: new PrismaPg({ connectionString: config.db.url }),
      log: config.db.queryLogging ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }

  /**
   * Runs `fn` inside a single database transaction, rolling the whole thing
   * back if it throws.
   *
   * This is the primitive the two transactional cores are built on: the pack
   * open in PD-58 debits currency and mints inventory, and the trade
   * settlement in PD-70 swaps items between two users. Neither may ever half
   * apply, so neither should call `$transaction` directly.
   */
  async withTransaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(fn);
  }
}
