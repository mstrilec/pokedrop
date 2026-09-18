export const QUEUE = {
  catalogSync: 'catalog-sync',
  priceSync: 'price-sync',
  tradeExpiry: 'trade-expiry',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];
