import assert from 'node:assert/strict';
import process from 'node:process';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { probe } from '../src/health/probe.ts';

test('a check that resolves reports up with a response time', async () => {
  const result = await probe('redis', async () => {}, 100);

  assert.equal(result.redis.status, 'up');
  assert.equal(typeof result.redis.responseTime, 'number');
  assert.equal('message' in result.redis, false);
});

test('a check that throws reports down with its message', async () => {
  const result = await probe(
    'database',
    async () => {
      throw new Error('connection refused');
    },
    100,
  );

  assert.equal(result.database.status, 'down');
  assert.equal(result.database.message, 'connection refused');
});

test('a check that outlives its timeout reports down', async () => {
  const result = await probe('database', () => sleep(300), 20);

  assert.equal(result.database.status, 'down');
  assert.equal(result.database.message, 'timeout of 20ms exceeded');
});

// The readiness probe runs every 10 s for as long as the API is up. Terminus' attempt() built an
// AbortSignal.any() per call, which Node 22.20 never frees: ~2 KB a probe, an OOM in under a week.
test('probes do not retain memory', async (t) => {
  if (typeof globalThis.gc !== 'function') {
    t.skip('needs node --expose-gc');
    return;
  }
  const heap = () => {
    globalThis.gc();
    globalThis.gc();
    return process.memoryUsage().heapUsed;
  };

  for (let i = 0; i < 2_000; i++) await probe('redis', async () => {}, 1500);
  const before = heap();
  for (let i = 0; i < 20_000; i++) await probe('redis', async () => {}, 1500);
  const grown = heap() - before;

  assert.ok(
    grown < 5 * 1024 * 1024,
    `heap grew by ${(grown / 1024 / 1024).toFixed(1)} MB over 20 000 probes`,
  );
});
