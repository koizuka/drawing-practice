import { parsePoseJson, PoseParseError, type PoseJson } from '../pose/poseTypes';
import { buildPosePrompt, buildTextPosePrompt } from '../pose/posePrompt';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const API_KEY_STORAGE_KEY = 'anthropicApiKey';

/** Vision-capable model used for stick-figure → pose interpretation. */
export const POSE_MODEL = 'claude-sonnet-5';

export class AnthropicKeyMissingError extends Error {
  constructor() {
    super('Anthropic API key is not set');
    this.name = 'AnthropicKeyMissingError';
  }
}

export class AnthropicAuthError extends Error {
  constructor() {
    super('Anthropic API key is invalid');
    this.name = 'AnthropicAuthError';
  }
}

export class AnthropicRateLimitError extends Error {
  constructor() {
    super('Anthropic rate limit reached');
    this.name = 'AnthropicRateLimitError';
  }
}

export class AnthropicOverloadedError extends Error {
  constructor() {
    super('Anthropic API is overloaded');
    this.name = 'AnthropicOverloadedError';
  }
}

export class AnthropicNetworkError extends Error {
  constructor(message?: string) {
    super(message ?? 'Anthropic network error');
    this.name = 'AnthropicNetworkError';
  }
}

export function getAnthropicApiKey(): string {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(API_KEY_STORAGE_KEY) : null;
    if (stored && stored.length > 0) return stored;
  }
  catch {
    // localStorage disabled / unavailable
  }
  return '';
}

export function setAnthropicApiKey(key: string): void {
  try {
    if (key === '') {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
    else {
      localStorage.setItem(API_KEY_STORAGE_KEY, key);
    }
  }
  catch {
    // localStorage disabled / unavailable
  }
}

/** Key-related errors — the recovery path is opening the API-key dialog. */
export function isAnthropicAuthError(e: unknown): boolean {
  return e instanceof AnthropicKeyMissingError || e instanceof AnthropicAuthError;
}

/**
 * Map an Anthropic error to the i18n key used for user-facing messages.
 * PoseParseError is not mapped here — the caller distinguishes it because the
 * recovery advice differs (retry generation vs. check key/network).
 */
export function mapAnthropicErrorKey(e: unknown):
  | 'anthropicKeyRequired'
  | 'anthropicKeyInvalid'
  | 'anthropicRateLimit'
  | 'anthropicOverloaded'
  | 'anthropicNetworkError' {
  if (e instanceof AnthropicKeyMissingError) return 'anthropicKeyRequired';
  if (e instanceof AnthropicAuthError) return 'anthropicKeyInvalid';
  if (e instanceof AnthropicRateLimitError) return 'anthropicRateLimit';
  if (e instanceof AnthropicOverloadedError) return 'anthropicOverloaded';
  return 'anthropicNetworkError';
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessagesResponse {
  content: AnthropicContentBlock[];
}

/**
 * Interpret a stick-figure sketch into a PoseJson via the Anthropic Messages
 * API, called directly from the browser with the user's own key (same BYOK
 * model as Pexels).
 *
 * @param pngBase64 PNG image data, base64 WITHOUT the data-URL prefix — or
 *   null to generate from the hint text alone (hint must be non-empty then).
 * @throws PoseParseError when the model's reply contains no usable JSON.
 */
export async function generatePose(pngBase64: string | null, hint: string, signal?: AbortSignal): Promise<PoseJson> {
  const key = getAnthropicApiKey();
  if (!key) throw new AnthropicKeyMissingError();
  if (pngBase64 === null && hint.trim() === '') {
    throw new Error('generatePose requires a sketch or a non-empty hint');
  }

  const content: unknown[] = pngBase64 !== null
    ? [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBase64 } },
        { type: 'text', text: buildPosePrompt(hint) },
      ]
    : [{ type: 'text', text: buildTextPosePrompt(hint) }];

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        // Opts into CORS for direct browser use; the key is the user's own.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: POSE_MODEL,
        // Headroom for the prose pose analysis the prompt now asks for
        // before the JSON (see posePrompt.ts).
        max_tokens: 2048,
        messages: [{ role: 'user', content }],
      }),
      signal,
    });
  }
  catch (e) {
    // Propagate AbortError so callers can distinguish cancellations from real failures.
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new AnthropicNetworkError(e instanceof Error ? e.message : undefined);
  }

  if (res.status === 401 || res.status === 403) throw new AnthropicAuthError();
  if (res.status === 429) throw new AnthropicRateLimitError();
  if (res.status === 529) throw new AnthropicOverloadedError();
  if (!res.ok) throw new AnthropicNetworkError(`HTTP ${res.status}`);

  const data = await res.json() as AnthropicMessagesResponse;
  const text = data.content?.find(block => block.type === 'text')?.text ?? '';
  // Debug-level so pose tuning can inspect the model's analysis + JSON from
  // the console (Safari Web Inspector) without noisy default output.
  console.debug('[pose] model reply:', text);
  try {
    return parsePoseJson(text);
  }
  catch (e) {
    if (e instanceof PoseParseError) {
      // Surface the raw reply so on-device failures can be diagnosed from
      // the console (Safari Web Inspector) without extra instrumentation.
      console.error('[pose] unparsable model reply:', text);
    }
    throw e;
  }
}
