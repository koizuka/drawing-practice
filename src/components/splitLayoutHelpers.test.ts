import { computeFitLeader, isSameReferenceContent, resolveDrawingFitSize, shouldFullscreenReferenceBrowse } from './splitLayoutHelpers';
import type { ReferenceSnapshot } from '../drawing/types';
import type { ReferenceInfo } from '../types';

describe('shouldFullscreenReferenceBrowse', () => {
  it('uses the full portrait viewport for search, pose, and trace browse screens', () => {
    expect(shouldFullscreenReferenceBrowse(false, 'pexels', 'browse', false)).toBe(true);
    expect(shouldFullscreenReferenceBrowse(false, 'sketchfab', 'browse', false)).toBe(true);
    expect(shouldFullscreenReferenceBrowse(false, 'pose', 'browse', false)).toBe(true);
    expect(shouldFullscreenReferenceBrowse(false, 'trace-template', 'browse', false)).toBe(true);
  });

  it('keeps content viewers and landscape layouts split', () => {
    expect(shouldFullscreenReferenceBrowse(false, 'sketchfab', 'browse', true)).toBe(false);
    expect(shouldFullscreenReferenceBrowse(false, 'pose', 'fixed', false)).toBe(false);
    expect(shouldFullscreenReferenceBrowse(false, 'trace-template', 'fixed', false)).toBe(false);
    expect(shouldFullscreenReferenceBrowse(true, 'pose', 'browse', false)).toBe(false);
    expect(shouldFullscreenReferenceBrowse(true, 'trace-template', 'browse', false)).toBe(false);
  });

  it('does not fullscreen the source picker or ordinary references', () => {
    expect(shouldFullscreenReferenceBrowse(false, 'none', 'browse', false)).toBe(false);
    expect(shouldFullscreenReferenceBrowse(false, 'image', 'browse', false)).toBe(false);
  });
});

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

  it('returns "reference" for trace template in fixed mode, "drawing" while browsing the picker', () => {
    expect(computeFitLeader('trace-template', 'fixed')).toBe('reference');
    expect(computeFitLeader('trace-template', 'browse')).toBe('drawing');
  });

  it('returns "reference" for pose in fixed mode (screenshot), "drawing" while orbiting the mannequin', () => {
    expect(computeFitLeader('pose', 'fixed')).toBe('reference');
    expect(computeFitLeader('pose', 'browse')).toBe('drawing');
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

describe('isSameReferenceContent', () => {
  function snap(overrides: Partial<ReferenceSnapshot> = {}): ReferenceSnapshot {
    return {
      source: 'none',
      referenceMode: 'browse',
      fixedImageUrl: null,
      localImageUrl: null,
      referenceInfo: null,
      ...overrides,
    };
  }

  it('matches url refs by identical fixed image URL', () => {
    const ref: ReferenceInfo = { source: 'url', imageUrl: 'https://x/a.png', title: '', author: '' };
    expect(isSameReferenceContent(snap({ source: 'url', fixedImageUrl: 'https://x/a.png' }), ref)).toBe(true);
    expect(isSameReferenceContent(snap({ source: 'url', fixedImageUrl: 'https://x/b.png' }), ref)).toBe(false);
  });

  it('rejects when the sources differ, even with the same URL', () => {
    const ref: ReferenceInfo = { source: 'url', imageUrl: 'https://x/a.png', title: '', author: '' };
    expect(isSameReferenceContent(snap({ source: 'pexels', fixedImageUrl: 'https://x/a.png' }), ref)).toBe(false);
  });

  it('matches pexels refs by pexelsImageUrl', () => {
    const ref: ReferenceInfo = { source: 'pexels', pexelsPhotoId: 1, pexelsImageUrl: 'https://p/1.jpg', pexelsPageUrl: 'https://p/page', title: '', author: '' };
    expect(isSameReferenceContent(snap({ source: 'pexels', fixedImageUrl: 'https://p/1.jpg' }), ref)).toBe(true);
    expect(isSameReferenceContent(snap({ source: 'pexels', fixedImageUrl: 'https://p/2.jpg' }), ref)).toBe(false);
  });

  it('matches sketchfab/pose refs by screenshot imageUrl; missing imageUrl never matches', () => {
    const sf: ReferenceInfo = { source: 'sketchfab', sketchfabUid: 'u1', imageUrl: 'data:capture', title: '', author: '' };
    expect(isSameReferenceContent(snap({ source: 'sketchfab', fixedImageUrl: 'data:capture' }), sf)).toBe(true);
    const sfNoShot: ReferenceInfo = { source: 'sketchfab', sketchfabUid: 'u1', title: '', author: '' };
    expect(isSameReferenceContent(snap({ source: 'sketchfab', fixedImageUrl: null }), sfNoShot)).toBe(false);
  });

  it('matches image refs by the content-hash history key, not the data URL', () => {
    const ref: ReferenceInfo = { source: 'image', url: 'local:abc', fileName: 'a.png', title: '', author: '' };
    const prevInfo: ReferenceInfo = { source: 'image', url: 'local:abc', fileName: 'a.png', title: '', author: '' };
    expect(isSameReferenceContent(snap({ source: 'image', localImageUrl: 'data:whatever', referenceInfo: prevInfo }), ref)).toBe(true);
    const otherInfo: ReferenceInfo = { source: 'image', url: 'local:zzz', fileName: 'b.png', title: '', author: '' };
    expect(isSameReferenceContent(snap({ source: 'image', localImageUrl: 'data:whatever', referenceInfo: otherInfo }), ref)).toBe(false);
  });

  it('matches youtube refs by video id and trace templates by templateId', () => {
    const yt: ReferenceInfo = { source: 'youtube', youtubeVideoId: 'v1', title: '', author: '' };
    expect(isSameReferenceContent(snap({ source: 'youtube', referenceInfo: yt }), yt)).toBe(true);
    expect(isSameReferenceContent(snap({ source: 'youtube', referenceInfo: { ...yt, youtubeVideoId: 'v2' } }), yt)).toBe(false);
    const tmpl: ReferenceInfo = { source: 'trace-template', templateId: 't1', title: '', author: '' };
    expect(isSameReferenceContent(snap({ source: 'trace-template', referenceInfo: tmpl }), tmpl)).toBe(true);
    expect(isSameReferenceContent(snap({ source: 'trace-template', referenceInfo: { ...tmpl, templateId: 't2' } }), tmpl)).toBe(false);
  });

  it('never matches when nothing was displayed', () => {
    const ref: ReferenceInfo = { source: 'url', imageUrl: 'https://x/a.png', title: '', author: '' };
    expect(isSameReferenceContent(snap(), ref)).toBe(false);
  });
});
