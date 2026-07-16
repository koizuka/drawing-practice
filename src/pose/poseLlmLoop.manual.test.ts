/**
 * Headless LLM improvement loop: runs the REAL generate → validate → refine
 * pipeline (posePrompt → Anthropic API → applyPose on the real mannequin rig
 * → diagnosePose → refinePose) entirely in vitest — no browser, no WebGL —
 * so prompt/recipe/validator changes can be exercised end-to-end from the
 * terminal.
 *
 * Cost control:
 * - SKIPPED unless an API key is available: env ANTHROPIC_API_KEY, or an
 *   `ANTHROPIC_API_KEY=sk-ant-...` line in .env.local (gitignored). CI has
 *   neither, so this never runs there.
 * - Successful API responses are memoized in .cache/pose-llm/ keyed by the
 *   request-body hash: re-running with unchanged prompts/scenarios replays
 *   from disk and costs zero API calls. Delete a cache file (or change the
 *   prompt — the hash covers it) to force a fresh call.
 *
 * Run with visible model replies:
 *   npx vitest run src/pose/poseLlmLoop.manual.test.ts --silent=false --disable-console-intercept
 */
/// <reference types="node" />
// ^ tsconfig.app deliberately keeps node globals out of app code; this
// vitest-only runner needs fs/crypto/process, so pull the types in here only.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePose, refinePose, type PoseGeneration } from '../utils/anthropic';
import { refinePoseUntilValid } from './poseRefineLoop';
import { makeMannequinHarness } from './poseTestHarness';

const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, '.cache', 'pose-llm');

function loadApiKey(): string {
  const env = process.env.ANTHROPIC_API_KEY;
  if (env) return env;
  const dotenv = join(ROOT, '.env.local');
  if (existsSync(dotenv)) {
    const m = readFileSync(dotenv, 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return '';
}

const API_KEY = loadApiKey();

/**
 * fetch wrapper memoizing successful Anthropic responses on disk. Non-OK
 * responses are never cached (a rate-limit or auth failure must not poison
 * later runs).
 */
function makeMemoFetch(realFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('api.anthropic.com') || typeof init?.body !== 'string') {
      return realFetch(input, init);
    }
    const hash = createHash('sha256').update(init.body).digest('hex').slice(0, 32);
    const file = join(CACHE_DIR, `${hash}.json`);
    if (existsSync(file)) {
      console.debug(`[pose-loop] cache hit ${hash}`);
      return new Response(readFileSync(file, 'utf8'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const res = await realFetch(input, init);
    if (!res.ok) return res;
    const text = await res.text();
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(file, text);
    console.debug(`[pose-loop] cache write ${hash}`);
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

/** Text-only scenarios: hint → hard floor invariants the final pose must hold. */
const SCENARIOS: Array<{ hint: string }> = [
  { hint: '膝抱えストレッチ' },
  { hint: '体育座りをしている' },
];

describe.skipIf(!API_KEY)('headless pose LLM loop (manual, memoized)', () => {
  beforeAll(() => {
    localStorage.setItem('anthropicApiKey', API_KEY);
    vi.stubGlobal('fetch', makeMemoFetch(fetch));
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem('anthropicApiKey');
  });

  it.each(SCENARIOS)('$hint — final pose has no floor penetration', { timeout: 300_000 }, async ({ hint }) => {
    const harness = makeMannequinHarness();
    const initial = await generatePose(null, hint);
    const rounds: string[] = [];
    const result = await refinePoseUntilValid<PoseGeneration>(initial, {
      measure: pose => harness.applyAndMeasure(pose),
      refine: (prior, feedback) => refinePose(prior, feedback),
      onRefineStart: (round, feedback) => {
        rounds.push(feedback);
        console.debug(`[pose-loop] refine round ${round}`);
      },
    });
    const problems = harness.diagnose(result.pose);
    console.debug(`[pose-loop] ${hint}: ${rounds.length} refine rounds, residual problems:`, problems);
    console.debug('[pose-loop] final pose:', JSON.stringify(result.pose));
    // Hard invariant: nothing ends up below the floor. (Other diagnostics may
    // legitimately remain — the loop is bounded and best-effort — but floor
    // penetration is exactly what the planted-footAt guarantee + retuned
    // recipes are supposed to make unreachable.)
    expect(problems.filter(p => p.includes('BELOW the floor'))).toEqual([]);
  });
});

// Keep vitest happy when the whole suite is skipped (no API key).
it.skipIf(API_KEY !== '')('skipped: no ANTHROPIC_API_KEY (env or .env.local)', () => {
  expect(API_KEY).toBe('');
});
