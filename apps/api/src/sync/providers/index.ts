/**
 * The entire public surface of this folder.
 *
 * Nothing outside `sync/providers/` may import a provider-specific type — the
 * fourth item of PD-38's scope. The rule is enforced by `no-restricted-imports`
 * in eslint.config.mjs rather than left as a convention, following the
 * workspace boundary PD-10 established.
 */
export { CARD_SOURCE_PROVIDER, CARD_SOURCE_REGISTRY } from './card-source-provider.js';
export type {
  CardPage,
  CardSourceName,
  CardSourceProvider,
  CardSourceRegistry,
  FetchCardsParams,
} from './card-source-provider.js';

export { CardDTOSchema, PriceDTOSchema, SetDTOSchema } from './provider.dto.js';
export type { CardDTO, PriceDTO, SetDTO } from './provider.dto.js';

export {
  ProviderContractError,
  ProviderError,
  ProviderRateLimitError,
  ProviderUnavailableError,
} from './provider.errors.js';
export type { ProviderItemError } from './provider.errors.js';
