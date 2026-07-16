import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generatePose,
  getAnthropicApiKey,
  setAnthropicApiKey,
  mapAnthropicErrorKey,
  AnthropicKeyMissingError,
  AnthropicAuthError,
  AnthropicRateLimitError,
  AnthropicOverloadedError,
  AnthropicNetworkError,
  AnthropicTruncatedError,
  anthropicErrorDetail,
  refinePose,
  POSE_MODEL,
} from './anthropic';
import { PoseParseError } from '../pose/poseTypes';

const fetchMock = vi.fn();

function textResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }), { status });
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('API key storage', () => {
  it('round-trips via localStorage', () => {
    expect(getAnthropicApiKey()).toBe('');
    setAnthropicApiKey('sk-test');
    expect(getAnthropicApiKey()).toBe('sk-test');
    expect(localStorage.getItem('anthropicApiKey')).toBe('sk-test');
    setAnthropicApiKey('');
    expect(getAnthropicApiKey()).toBe('');
    expect(localStorage.getItem('anthropicApiKey')).toBeNull();
  });
});

describe('generatePose', () => {
  it('throws AnthropicKeyMissingError without a key and does not fetch', async () => {
    await expect(generatePose('AAAA', '')).rejects.toBeInstanceOf(AnthropicKeyMissingError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the browser-CORS headers and the image + prompt blocks', async () => {
    setAnthropicApiKey('sk-test');
    fetchMock.mockResolvedValueOnce(textResponse('{"leftArm":{"raise":90}}'));

    await generatePose('BASE64PNG', '走っている');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(POSE_MODEL);
    // Adaptive thinking on by omission (helps spatial reasoning); the budget
    // must be generous because thinking tokens count against max_tokens and
    // sonnet-5 has no separate thinking cap — 8192 was fully consumed by
    // thinking alone on a hard pose. See the comment in anthropic.ts.
    expect(body.thinking).toBeUndefined();
    expect(body.max_tokens).toBeGreaterThanOrEqual(16384);
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'BASE64PNG' },
    });
    expect(body.messages[0].content[1].type).toBe('text');
    expect(body.messages[0].content[1].text).toContain('「走っている」');
  });

  it('sends a text-only prompt when the sketch is null', async () => {
    setAnthropicApiKey('sk-test');
    fetchMock.mockResolvedValueOnce(textResponse('{"body":{"crouch":1}}'));

    await generatePose(null, '深くしゃがんでいる');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).toHaveLength(1);
    expect(body.messages[0].content[0].type).toBe('text');
    expect(body.messages[0].content[0].text).toContain('「深くしゃがんでいる」');
  });

  it('rejects a null sketch with an empty hint before fetching', async () => {
    setAnthropicApiKey('sk-test');
    await expect(generatePose(null, '  ')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses the text block into a sanitized PoseJson and records the conversation', async () => {
    setAnthropicApiKey('sk-test');
    fetchMock.mockResolvedValueOnce(textResponse('```json\n{"body":{"turn":-90},"junk":1}\n```'));
    const result = await generatePose('AAAA', '');
    expect(result.pose).toEqual({ body: { turn: -90 } });
    // The conversation carries the request and the assistant's raw reply so
    // refinePose can continue in-context.
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[1]).toEqual({ role: 'assistant', content: '```json\n{"body":{"turn":-90},"junk":1}\n```' });
  });

  it.each([
    [401, AnthropicAuthError],
    [403, AnthropicAuthError],
    [429, AnthropicRateLimitError],
    [529, AnthropicOverloadedError],
    [500, AnthropicNetworkError],
  ])('maps HTTP %d to the typed error', async (status, errorClass) => {
    setAnthropicApiKey('sk-test');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status }));
    await expect(generatePose('AAAA', '')).rejects.toBeInstanceOf(errorClass);
  });

  it('wraps network failures and propagates aborts', async () => {
    setAnthropicApiKey('sk-test');
    fetchMock.mockRejectedValueOnce(new TypeError('failed to fetch'));
    await expect(generatePose('AAAA', '')).rejects.toBeInstanceOf(AnthropicNetworkError);

    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await expect(generatePose('AAAA', '')).rejects.toSatisfy(
      (e: unknown) => e instanceof DOMException && e.name === 'AbortError',
    );
  });

  it('throws PoseParseError carrying the reply text when the reply has no JSON', async () => {
    setAnthropicApiKey('sk-test');
    fetchMock.mockResolvedValueOnce(textResponse('I cannot see a figure.'));
    const err = await generatePose('AAAA', '').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PoseParseError);
    expect((err as PoseParseError).replyText).toBe('I cannot see a figure.');
  });

  it('surfaces the API error message as detail on HTTP errors', async () => {
    setAnthropicApiKey('sk-test');
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: must be positive' } }),
      { status: 400 },
    ));
    const err = await generatePose('AAAA', '').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnthropicNetworkError);
    expect(anthropicErrorDetail(err)).toBe('max_tokens: must be positive');
  });

  it('returns the pose when max_tokens hit AFTER a complete pose JSON', async () => {
    setAnthropicApiKey('sk-test');
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'Analysis…\n{"leftArm":{"raise":90}}' }],
        stop_reason: 'max_tokens',
      }),
      { status: 200 },
    ));
    await expect(generatePose('AAAA', '').then(r => r.pose)).resolves.toEqual({ leftArm: { raise: 90 } });
  });

  it('treats an empty parsed pose under max_tokens as truncation', async () => {
    setAnthropicApiKey('sk-test');
    // The reply was cut mid-JSON but the prose contained a stray complete
    // object — parsing "succeeds" with an empty pose, which must not pass.
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'The figure {as drawn} sits…\n{"body":{"crouch":1},"leftLeg":{"forw' }],
        stop_reason: 'max_tokens',
      }),
      { status: 200 },
    ));
    const err = await generatePose('AAAA', '').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnthropicTruncatedError);
  });

  it('throws AnthropicTruncatedError when stop_reason is max_tokens (instead of a parse error)', async () => {
    setAnthropicApiKey('sk-test');
    // Thinking consumed the whole budget: HTTP 200 but no usable text block.
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ content: [], stop_reason: 'max_tokens' }),
      { status: 200 },
    ));
    const err = await generatePose('AAAA', '').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnthropicTruncatedError);
    expect(anthropicErrorDetail(err)).toContain('max_tokens');
  });
});

describe('refinePose', () => {
  it('sends the prior conversation plus the feedback as a new user turn', async () => {
    setAnthropicApiKey('sk-test');
    fetchMock.mockResolvedValueOnce(textResponse('{"leftArm":{"raise":90}}'));
    const first = await generatePose(null, 'ジャンプ');
    fetchMock.mockResolvedValueOnce(textResponse('Fixed.\n{"leftArm":{"raise":80}}'));

    const refined = await refinePose(first, 'the left hand is 10cm below the floor.');

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[1].role).toBe('assistant');
    expect(body.messages[2]).toEqual({ role: 'user', content: 'the left hand is 10cm below the floor.' });
    expect(refined.pose).toEqual({ leftArm: { raise: 80 } });
    expect(refined.messages).toHaveLength(4);
  });

  it('throws AnthropicKeyMissingError without a key and does not fetch', async () => {
    await expect(refinePose({ pose: {}, messages: [] }, 'x')).rejects.toBeInstanceOf(AnthropicKeyMissingError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('mapAnthropicErrorKey', () => {
  it('maps each error class to its i18n key', () => {
    expect(mapAnthropicErrorKey(new AnthropicKeyMissingError())).toBe('anthropicKeyRequired');
    expect(mapAnthropicErrorKey(new AnthropicAuthError())).toBe('anthropicKeyInvalid');
    expect(mapAnthropicErrorKey(new AnthropicRateLimitError())).toBe('anthropicRateLimit');
    expect(mapAnthropicErrorKey(new AnthropicOverloadedError())).toBe('anthropicOverloaded');
    expect(mapAnthropicErrorKey(new AnthropicTruncatedError())).toBe('anthropicTruncated');
    expect(mapAnthropicErrorKey(new Error('x'))).toBe('anthropicNetworkError');
  });
});
