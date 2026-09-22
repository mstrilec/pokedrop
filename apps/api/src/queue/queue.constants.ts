export const QUEUE = {
  catalogSync: 'catalog-sync',
  priceSync: 'price-sync',
  priceSweep: 'price-sweep',
  priceActive: 'price-active',
  tradeExpiry: 'trade-expiry',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];
