import { buildAppConfig, parseEnv } from '../config/index.js';

let moderate: { limit: number; ttl: number } | undefined;

// A decorator cannot inject APP_CONFIG, so this reads the environment the same
// way APP_CONFIG's own factory does, once, at the first throttled request.
function policy(): { limit: number; ttl: number } {
  if (moderate === undefined) {
    const { throttle } = buildAppConfig(parseEnv(process.env));
    moderate = { limit: throttle.moderateLimit, ttl: throttle.moderateWindowMs };
  }
  return moderate;
}

/**
 * Overrides `default` rather than registering a `moderate` throttler: the
 * guard runs every registered throttler on every route, and a second one would
 * silently limit the health probes.
 */
export const MODERATE_THROTTLE = {
  default: { limit: () => policy().limit, ttl: () => policy().ttl },
};
