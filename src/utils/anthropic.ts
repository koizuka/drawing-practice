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

/**
 * Base for errors carrying a server-provided detail (the API error JSON's
 * `error.message`, or a stop_reason note). Shown verbatim in the UI under the
 * translated message so the user can diagnose without opening the console.
 */
export class AnthropicApiError extends Error {
  readonly detail?: string;
  constructor(message: string, detail?: string) {
    super(detail ? `${message}: ${detail}` : message);
    this.name = 'AnthropicApiError';
    this.detail = detail;
  }
}

export class AnthropicAuthError extends AnthropicApiError {
  constructor(detail?: string) {
    super('Anthropic API key is invalid', detail);
    this.name = 'AnthropicAuthError';
  }
}

export class AnthropicRateLimitError extends AnthropicApiError {
  constructor(detail?: string) {
    super('Anthropic rate limit reached', detail);
    this.name = 'AnthropicRateLimitError';
  }
}

export class AnthropicOverloadedError extends AnthropicApiError {
  constructor(detail?: string) {
    super('Anthropic API is overloaded', detail);
    this.name = 'AnthropicOverloadedError';
  }
}

export class AnthropicNetworkError extends AnthropicApiError {
  constructor(detail?: string) {
    super('Anthropic network error', detail);
    this.name = 'AnthropicNetworkError';
  }
}

/** HTTP 200 but the reply was cut off by max_tokens before the JSON. */
export class AnthropicTruncatedError extends AnthropicApiError {
  constructor(detail?: string) {
    super('Anthropic reply truncated by max_tokens', detail);
    this.name = 'AnthropicTruncatedError';
  }
}

/** Server detail string for UI display, if the error carries one. */
export function anthropicErrorDetail(e: unknown): string | undefined {
  return e instanceof AnthropicApiError ? e.detail : undefined;
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
  | 'anthropicTruncated'
  | 'anthropicNetworkError' {
  if (e instanceof AnthropicKeyMissingError) return 'anthropicKeyRequired';
  if (e instanceof AnthropicAuthError) return 'anthropicKeyInvalid';
  if (e instanceof AnthropicRateLimitError) return 'anthropicRateLimit';
  if (e instanceof AnthropicOverloadedError) return 'anthropicOverloaded';
  if (e instanceof AnthropicTruncatedError) return 'anthropicTruncated';
  return 'anthropicNetworkError';
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

/** One turn of the pose conversation (content is the raw API block array or a string). */
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: unknown;
}

/**
 * A generated pose together with the conversation that produced it, so a
 * validation follow-up (refinePose) can continue in-context.
 */
export interface PoseGeneration {
  pose: PoseJson;
  messages: AnthropicMessage[];
}

interface AnthropicMessagesResponse {
  content: AnthropicContentBlock[];
  stop_reason?: string | null;
}

/**
 * Extract the API error JSON's `error.message` from a non-OK response body,
 * for UI display. Best-effort — returns undefined on any parse failure.
 */
async function readErrorDetail(res: Response): Promise<string | undefined> {
  try {
    const data = await res.json() as { error?: { type?: string; message?: string } };
    const msg = data.error?.message;
    return typeof msg === 'string' && msg.length > 0 ? msg : undefined;
  }
  catch {
    return undefined;
  }
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
export async function generatePose(pngBase64: string | null, hint: string, signal?: AbortSignal): Promise<PoseGeneration> {
  if (pngBase64 === null && hint.trim() === '') {
    throw new Error('generatePose requires a sketch or a non-empty hint');
  }

  const content: unknown[] = pngBase64 !== null
    ? [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBase64 } },
        { type: 'text', text: buildPosePrompt(hint) },
      ]
    : [{ type: 'text', text: buildTextPosePrompt(hint) }];

  return requestPose([{ role: 'user', content }], signal);
}

/**
 * One validation-correction round: appends the geometric feedback to the
 * prior conversation and asks for a corrected pose JSON in-context.
 */
export async function refinePose(prior: PoseGeneration, feedback: string, signal?: AbortSignal): Promise<PoseGeneration> {
  return requestPose([...prior.messages, { role: 'user', content: feedback }], signal);
}

async function requestPose(messages: AnthropicMessage[], signal?: AbortSignal): Promise<PoseGeneration> {
  const key = getAnthropicApiKey();
  if (!key) throw new AnthropicKeyMissingError();

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
        // claude-sonnet-5 runs adaptive thinking by default when `thinking`
        // is omitted. Thinking helps exactly here (spatial/anatomical
        // reasoning), so leave it on — but its tokens count against
        // max_tokens, and there is NO separate thinking cap on this model
        // (budget_tokens is removed, 400). At 2048 thinking consumed the
        // whole budget (2047/2048) with no text block; at 8192 the same
        // happened on a hard pose (8191/8192, 腹筋クランチ). Budget
        // generously instead of disabling — 16384 is the practical ceiling
        // for a non-streaming request (beyond that HTTP timeouts become a
        // risk); stop_reason 'max_tokens' below catches the residual case
        // with a user-visible error rather than a cryptic parse error.
        max_tokens: 16384,
        messages,
      }),
      signal,
    });
  }
  catch (e) {
    // Propagate AbortError so callers can distinguish cancellations from real failures.
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new AnthropicNetworkError(e instanceof Error ? e.message : undefined);
  }

  if (!res.ok) {
    const detail = await readErrorDetail(res);
    if (res.status === 401 || res.status === 403) throw new AnthropicAuthError(detail);
    if (res.status === 429) throw new AnthropicRateLimitError(detail);
    if (res.status === 529) throw new AnthropicOverloadedError(detail);
    throw new AnthropicNetworkError(detail ?? `HTTP ${res.status}`);
  }

  const data = await res.json() as AnthropicMessagesResponse;
  const text = data.content?.find(block => block.type === 'text')?.text ?? '';
  // Debug-level so pose tuning can inspect the model's analysis + JSON from
  // the console (Safari Web Inspector) without noisy default output.
  console.debug('[pose] model reply:', text);
  // Parse FIRST: stop_reason 'max_tokens' can also fire after the pose JSON
  // was fully emitted (budget ran out on trailing text) — those replies are
  // usable and must not be rejected. Only when no pose can be extracted does
  // the stop reason explain the failure (cut off before/mid-JSON, e.g. by
  // thinking consuming the budget) — report that instead of a parse error.
  let pose: PoseJson;
  try {
    pose = parsePoseJson(text);
  }
  catch (e) {
    if (e instanceof PoseParseError) {
      if (data.stop_reason === 'max_tokens') {
        console.error('[pose] reply truncated by max_tokens:', data);
        throw new AnthropicTruncatedError('stop_reason: max_tokens');
      }
      // Surface the raw reply so on-device failures can be diagnosed from
      // the console without extra instrumentation. `text` alone can be ''
      // (no text block at all — e.g. an empty/refused completion), so log
      // the whole response body too.
      console.error('[pose] unparsable model reply:', text || '(no text block)', data);
      // A JSON-less reply is usually the model explaining itself (e.g. a
      // refusal) — carry the text to the UI so the user sees the reason
      // without opening the console.
      if (text) e.replyText = text;
    }
    throw e;
  }
  // A truncated reply can still "parse" into an empty pose (the scanner
  // finds a stray complete {...} in the prose) — treat that as truncation.
  if (data.stop_reason === 'max_tokens' && Object.keys(pose).length === 0) {
    console.error('[pose] reply truncated by max_tokens:', data);
    throw new AnthropicTruncatedError('stop_reason: max_tokens');
  }
  return { pose, messages: [...messages, { role: 'assistant', content: text }] };
}
