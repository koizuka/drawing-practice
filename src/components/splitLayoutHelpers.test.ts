import { computeFitLeader, resolveDrawingFitSize } from './splitLayoutHelpers';

describe('computeFitLeader', () => {
  it('returns "drawing" for source picker (free drawing)', () => {
    expect(computeFitLeader('none', 'browse')).toBe('drawing');
  });

  it('returns "drawing" for Sketchfab and Pexels search screens (browse mode)', () => {
    expect(computeFitLeader('sketchfab', 'browse')).toBe('drawing');
    expect(computeFitLeader('pexels', 'browse')).toBe('drawing');
  });

  it('returns "reference" for YouTube regardless of mode', () => {
    expect(computeFitLeader('youtube', 'browse')).toBe('reference');
    expect(computeFitLeader('youtube', 'fixed')).toBe('reference');
  });

  it('returns "reference" for image-bearing sources in fixed mode', () => {
    expect(computeFitLeader('image', 'fixed')).toBe('reference');
    expect(computeFitLeader('url', 'fixed')).toBe('reference');
    expect(computeFitLeader('pexels', 'fixed')).toBe('reference');
    expect(computeFitLeader('sketchfab', 'fixed')).toBe('reference');
  });
});

describe('resolveDrawingFitSize', () => {
  const stale = { width: 1920, height: 1080 };
  const live = { width: 800, height: 600 };

  it('returns referenceSize when the reference panel leads', () => {
    expect(resolveDrawingFitSize('reference', live)).toEqual(live);
  });

  it('returns null when the drawing panel leads, even with a non-null referenceSize', () => {
    // referenceSize is not cleared on source change; without this rule the
    // baseScale would alternate between fit-to-stale-image and 1 as the user
    // navigates between the source picker and a search screen.
    expect(resolveDrawingFitSize('drawing', stale)).toBeNull();
  });

  it('handles null referenceSize either way', () => {
    expect(resolveDrawingFitSize('reference', null)).toBeNull();
    expect(resolveDrawingFitSize('drawing', null)).toBeNull();
  });

  it('does not alternate fitSize across navigation between source picker and search screens', () => {
    // Simulate the user's reported scenario: load an image (sets referenceSize
    // = some image dims), close to source picker, open Sketchfab search,
    // close, open Pexels search. Throughout, drawing canvas should see null
    // (so baseScale stays 1 and visual zoom doesn't flip).
    const refSizeFromPriorImage = { width: 1920, height: 1080 };
    const navigationStates: Array<{ source: 'none' | 'sketchfab' | 'pexels'; mode: 'browse' }> = [
      { source: 'none', mode: 'browse' },
      { source: 'sketchfab', mode: 'browse' },
      { source: 'none', mode: 'browse' },
      { source: 'pexels', mode: 'browse' },
      { source: 'none', mode: 'browse' },
    ];
    const fitSizes = navigationStates.map(({ source, mode }) =>
      resolveDrawingFitSize(computeFitLeader(source, mode), refSizeFromPriorImage),
    );
    expect(fitSizes.every(s => s === null)).toBe(true);
  });
});
