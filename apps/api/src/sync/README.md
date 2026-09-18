# Sync module

The seam between this application and whichever card API is behind it. Nothing
outside this folder knows that pokemontcg.io or TCGdex exist.

## Shape

| File | Holds |
| --- | --- |
| `providers/provider.dto.ts` | `SetDTO`, `CardDTO`, `PriceDTO` — provider-neutral, Zod |
| `providers/provider.errors.ts` | the error taxonomy, and `ProviderItemError` |
| `providers/card-source-provider.ts` | the interface, `CardPage`, the two tokens |
| `providers/index.ts` | the folder's entire public surface |
| `sync.module.ts` | the registry and the configured default |

## The boundary, and how it is held

Nothing outside `providers/` may import a provider-specific type. That is not a
convention — `eslint.config.mjs` refuses it, the same way PD-10's rule refuses
`apps/api` importing from `apps/web`. Import from `providers/index.ts`.

Choosing a provider is `CARD_SOURCE_PROVIDER` in the environment and nothing
else. If changing it ever requires a code change outside this folder, the seam
has been broken.

Note that the patterns match the import specifier **as written**, so the block
exempting this folder is load-bearing rather than decorative: without it, a
sibling import written in the long form — `../../../sync/providers/tcgdex/…` —
is refused inside the very folder it is meant to protect. Verified by removing
the block and watching it fail.

## Three things that will bite

**`CardDTO` has no price fields, and that is deliberate.** `latestPriceUsd`,
`latestPriceEur` and `priceUpdatedAt` belong to the price path. Adding them here
would let a nightly catalog sync overwrite a fresh price with a stale one; with
no field to put it in, it cannot.

**A 429 is not a failover signal.** `ProviderRateLimitError` means slow down.
`ProviderUnavailableError` and `ProviderContractError` mean the upstream is not
serving, and only those two count toward PD-43's circuit breaker. Counting a 429
would move the load onto the fallback and rate-limit that one too.

**A malformed envelope throws; a malformed item does not.** A response that is
not the documented shape raises `ProviderContractError`. One bad card inside a
good response is skipped and reported through `CardPage.skipped`, so it cannot
discard the good ones beside it.

## Measured, 2026-09-18

pokemontcg.io answered 500 on `/v2/cards` — from the origin, `x-runtime`
present — while `/v2/sets` served normally. TCGdex answered everything, but has
no bulk path to full card data: full cards are one request each, roughly 20 000
for a catalog against pokemontcg.io's 80. That is why the primary did not change
when it broke.

The DTOs were checked against both live payloads: a pokemontcg.io set and a
TCGdex set map to `SetDTO`s equal to the millisecond, from `1999/01/09` and
`1999-01-09` respectively.

## What is not here yet

`SyncModule` is not imported into `AppModule`. Nest builds providers eagerly, so
wiring an empty registry would make the boot refusal fire on every start. PD-39
wires it together with the first provider.

| Ticket | Adds |
| --- | --- |
| PD-39 | `providers/pokemon-tcg/` — client, raw schema, mapper |
| PD-40 | `providers/tcgdex/` — the same against the fallback |
| PD-41 | BullMQ queues and the worker entrypoint |
| PD-42 | `catalog-sync.processor.ts` and the `SyncRun` model |
| PD-43 | failover and the circuit breaker, reading the error taxonomy |
