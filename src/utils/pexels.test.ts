import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getPexelsApiKey,
  parsePexelsPhotoUrl,
  setPexelsApiKey,
} from './pexels'

describe('parsePexelsPhotoUrl', () => {
  it('extracts id from /photo/slug-12345/', () => {
    expect(parsePexelsPhotoUrl('https://www.pexels.com/photo/man-jogging-in-park-12345/')).toEqual({ id: 12345 })
  })

  it('extracts id from /photo/12345 without slug', () => {
    expect(parsePexelsPhotoUrl('https://www.pexels.com/photo/12345/')).toEqual({ id: 12345 })
  })

  it('extracts id from locale-prefixed paths', () => {
    expect(parsePexelsPhotoUrl('https://www.pexels.com/ja-jp/photo/some-slug-987654/')).toEqual({ id: 987654 })
    expect(parsePexelsPhotoUrl('https://www.pexels.com/en-us/photo/42/')).toEqual({ id: 42 })
  })

  it('accepts pexels.com without www', () => {
    expect(parsePexelsPhotoUrl('https://pexels.com/photo/foo-1/')).toEqual({ id: 1 })
  })

  it('trims surrounding whitespace', () => {
    expect(parsePexelsPhotoUrl('  https://www.pexels.com/photo/foo-555/  ')).toEqual({ id: 555 })
  })

  it('returns null for non-Pexels URLs', () => {
    expect(parsePexelsPhotoUrl('https://www.example.com/photo/foo-1/')).toBeNull()
    expect(parsePexelsPhotoUrl('https://www.sketchfab.com/photo/foo-1/')).toBeNull()
  })

  it('returns null for Pexels home/collections pages', () => {
    expect(parsePexelsPhotoUrl('https://www.pexels.com/')).toBeNull()
    expect(parsePexelsPhotoUrl('https://www.pexels.com/search/pose/')).toBeNull()
    expect(parsePexelsPhotoUrl('https://www.pexels.com/collections/abc/')).toBeNull()
  })

  it('returns null when the trailing segment has no numeric id', () => {
    expect(parsePexelsPhotoUrl('https://www.pexels.com/photo/')).toBeNull()
    expect(parsePexelsPhotoUrl('https://www.pexels.com/photo/no-numbers/')).toBeNull()
  })

  it('returns null for malformed or empty input', () => {
    expect(parsePexelsPhotoUrl('')).toBeNull()
    expect(parsePexelsPhotoUrl('not a url')).toBeNull()
  })
})

describe('API key management', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('returns empty string when no key is set', () => {
    expect(getPexelsApiKey()).toBe('')
  })

  it('persists key via setPexelsApiKey and reads it back', () => {
    setPexelsApiKey('abc123')
    expect(getPexelsApiKey()).toBe('abc123')
  })

  it('clears the stored key when an empty string is passed', () => {
    setPexelsApiKey('abc123')
    setPexelsApiKey('')
    expect(getPexelsApiKey()).toBe('')
    expect(localStorage.getItem('pexelsApiKey')).toBeNull()
  })
})
