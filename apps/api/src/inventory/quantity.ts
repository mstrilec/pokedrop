export type Holding = { quantity: number; lockedQuantity: number };

export type QuantityChange = { cardId: string; quantity: number };

export function availableQuantity(holding: Holding): number {
  return holding.quantity - holding.lockedQuantity;
}

// Sorted so that two transactions touching the same rows take their row locks
// in the same order; the other order deadlocks under concurrency.
export function normalizeChanges(changes: QuantityChange[]): QuantityChange[] {
  const seen = new Set<string>();
  for (const change of changes) {
    if (!Number.isInteger(change.quantity) || change.quantity < 1) {
      throw new Error(`Quantity change for ${change.cardId} must be a positive integer`);
    }
    if (seen.has(change.cardId)) {
      throw new Error(`Card ${change.cardId} appears twice in one quantity change`);
    }
    seen.add(change.cardId);
  }
  return [...changes].sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0));
}
