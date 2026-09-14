/**
 * @pokedrop/shared — the API contract.
 *
 * Schemas are the source of truth and every type is inferred from one, so a
 * change here surfaces as a typecheck error in both apps rather than as a
 * runtime surprise. Nothing in this package may import from Nest or React.
 *
 * Endpoint request/response schemas are added by the ticket that implements
 * the endpoint. What lives here is what docs/DataModel.md and docs/API.md
 * actually specify: enums, entities, and the primitives every route shares.
 */

export * from './enums.js';

export * from './primitives/id.js';
export * from './primitives/pagination.js';
export * from './primitives/error.js';

export * from './entities/user.js';
export * from './entities/set.js';
export * from './entities/card.js';
export * from './entities/price.js';
export * from './entities/inventory.js';
export * from './entities/pack.js';
export * from './entities/deck.js';
export * from './entities/trade.js';
export * from './entities/currency.js';
export * from './entities/audit.js';
export * from './entities/notification.js';
