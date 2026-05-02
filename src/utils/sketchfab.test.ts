import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canonicalSketchfabUrl,
  getSketchfabLastSearch,
  parseSketchfabModelUrl,
  setSketchfabLastSearch,
} from './sketchfab';

describe('parseSketchfabModelUrl', () => {
  const uid = 'a1b2c3d4e5f6789012345678abcdef99';

  it('parses /3d-models/<slug>-<uid>', () => {
    expect(parseSketchfabModelUrl(`https://sketchfab.com/3d-models/cool-name-${uid}`)).toEqual({ uid });
  });

  it('parses /models/<uid>', () => {
    expect(parseSketchfabModelUrl(`https://sketchfab.com/models/${uid}`)).toEqual({ uid });
  });

  it('accepts www. and trailing slash and trims whitespace', () => {
    expect(parseSketchfabModelUrl(`  https://www.sketchfab.com/3d-models/foo-${uid}/  `)).toEqual({ uid });
  });

  it('returns null when uid is malformed', () => {
    expect(parseSketchfabModelUrl('https://sketchfab.com/models/short')).toBeNull();
    expect(parseSketchfabModelUrl('https://sketchfab.com/3d-models/foo-bar')).toBeNull();
  });

  it('returns null for non-sketchfab hosts', () => {
    expect(parseSketchfabModelUrl(`https://example.com/models/${uid}`)).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(parseSketchfabModelUrl('')).toBeNull();
    expect(parseSketchfabModelUrl('not a url')).toBeNull();
  });
});

describe('canonicalSketchfabUrl', () => {
  it('produces a stable canonical /models/ URL', () => {
    expect(canonicalSketchfabUrl('abc123')).toBe('https://sketchfab.com/models/abc123');
  });
});

describe('getSketchfabLastSearch / setSketchfabLastSearch', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing is stored', () => {
    expect(getSketchfabLastSearch()).toBeNull();
  });

  it('round-trips a query+timeFilter+category context', () => {
    setSketchfabLastSearch({ query: 'pose', timeFilter: 'week', category: 'characters-creatures' });
    expect(getSketchfabLastSearch()).toEqual({ query: 'pose', timeFilter: 'week', category: 'characters-creatures' });
  });

  it('round-trips without category', () => {
    setSketchfabLastSearch({ query: 'tree', timeFilter: 'all' });
    expect(getSketchfabLastSearch()).toEqual({ query: 'tree', timeFilter: 'all' });
  });

  it('returns null on garbage payload', () => {
    localStorage.setItem('sketchfab.lastSearch', 'not-json');
    expect(getSketchfabLastSearch()).toBeNull();
    localStorage.setItem('sketchfab.lastSearch', JSON.stringify({ query: 'q', timeFilter: 'never' }));
    expect(getSketchfabLastSearch()).toBeNull();
    localStorage.setItem('sketchfab.lastSearch', JSON.stringify({ query: 'q', timeFilter: 'all', category: 'made-up' }));
    expect(getSketchfabLastSearch()).toBeNull();
  });
});
