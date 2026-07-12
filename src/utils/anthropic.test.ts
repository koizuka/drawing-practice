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
  POSE_MODEL,
} from './anthropic';
import { PoseParseError } from '../pose/poseTypes';

const fetchMock = vi.fn();

function textResponse(text: string, status = 200): Response {
  return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status });
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

  it('parses the text block into a sanitized PoseJson', async () => {
    setAnthropicApiKey('sk-test');
    fetchMock.mockResolvedValueOnce(textResponse('```json\n{"body":{"turn":-90},"junk":1}\n```'));
    const pose = await generatePose('AAAA', '');
    expect(pose).toEqual({ body: { turn: -90 } });
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

  it('throws PoseParseError when the reply has no JSON', async () => {
    setAnthropicApiKey('sk-test');
    fetchMock.mockResolvedValueOnce(textResponse('I cannot see a figure.'));
    await expect(generatePose('AAAA', '')).rejects.toBeInstanceOf(PoseParseError);
  });
});

describe('mapAnthropicErrorKey', () => {
  it('maps each error class to its i18n key', () => {
    expect(mapAnthropicErrorKey(new AnthropicKeyMissingError())).toBe('anthropicKeyRequired');
    expect(mapAnthropicErrorKey(new AnthropicAuthError())).toBe('anthropicKeyInvalid');
    expect(mapAnthropicErrorKey(new AnthropicRateLimitError())).toBe('anthropicRateLimit');
    expect(mapAnthropicErrorKey(new AnthropicOverloadedError())).toBe('anthropicOverloaded');
    expect(mapAnthropicErrorKey(new Error('x'))).toBe('anthropicNetworkError');
  });
});
