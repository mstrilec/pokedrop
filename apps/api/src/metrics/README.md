# Metrics module

What the admin metrics (`GET /admin/metrics`, `docs/API.md` → Admin / Metrics) are counted from. Everything here runs on the request path, so the rule for the whole module is that a request never waits for it and never fails because of it.

## Activity

`ActivityService.touch(userId)` is called by `SessionGuard` for every request with a valid session of a user who is not suspended. It writes one `user_activity` row per user per UTC day (`docs/DataModel.md` → UserActivity).

**No Redis, no `await`.** An in-memory set of the day's user ids, per process, answers "already recorded today" for free. Only the first request of a user's day issues `INSERT … ON CONFLICT DO NOTHING`, and that promise is not awaited. The set is replaced when the UTC date changes.

- **A failed insert** is logged and removes the id from the set, so the user's next request tries again.
- **A restart** empties the set. The next request inserts again, and the primary key absorbs the duplicate — measured: one row after a restart.
- **Several replicas** each insert once per user per day, for the same reason.

Redis was rejected for the "already seen" check: it would put a network round trip on every authenticated request, and make activity depend on a second service.

## Counters

`MetricsCounterService.increment(name)` does `INCR metrics:{name}:{YYYY-MM-DD}` plus `EXPIRE` 100 days, pipelined, in the cache Redis.

- **Outside `cache:`**, as `breaker:` and `throttle:` are, so a cache flush does not reset a day's count.
- **Never awaited.** A count lost to a Redis outage is lost.
- **Quiet on failure.** The cache client is built with `enableOfflineQueue: false`, so a failure is immediate. A warning is logged at most once a minute, so a Redis outage does not write a line per request.
- **An absent key reads as 0.** `null` in the API means Redis could not be read, never that nothing happened.

| Counter | Incremented by |
| --- | --- |
| `requests` | the request-counting middleware, once per `/api/v1` response except `/api/v1/health/*` and CORS preflights |
| `server_errors` | the same middleware, when the final status is ≥ 500 — in the same `MULTI` and on the same day as that response's `requests` |
| `pack_fallbacks` | `PackOpeningService`, once per opening in which any slot fell back to another rarity |
| `pack_unavailable` | `PackOpeningService`, once per 409 `PACK_UNAVAILABLE` |

## Why the request counter is Express middleware

`createRequestMetricsMiddleware` is mounted with `app.use` in `main.ts`, right after the request id, rather than being a Nest interceptor.

Interceptors run after guards. They never see a 401 from `SessionGuard`, a 403 from `RolesGuard`, a 429 from the throttler, or a 404 from the not-found handler behind the router. The Express middleware listens for `finish` and so sees every final status — measured: a 401 and a 404 were both counted, and a health probe was not.

## Cost on the request path

`/users/me` measured p50 5.7 ms and p95 6.5 ms with this module, against 5.6 ms and 7.0 ms before it — within noise, as expected when the work happens after the response or not at all. The "before" sample of 200 requests ran past the default rate limit of 100 a minute, so it may include 429s. Treat the comparison as indicative, not exact.
