export type ReferenceSource = 'none' | 'sketchfab' | 'image' | 'url' | 'youtube' | 'pexels'
export type ReferenceMode = 'browse' | 'fixed'

interface ReferenceInfoBase {
  title: string
  author: string
}

/**
 * Per-source reference metadata. Each variant lists the fields that are
 * actually meaningful for that source; everything is type-narrowed on
 * `source`, so utility code doesn't need optional-chain guards on fields that
 * are required for a given variant.
 */
export type ReferenceInfo =
  | (ReferenceInfoBase & {
      source: 'sketchfab'
      sketchfabUid: string
      /** Screenshot data URL captured by "Fix This Angle". */
      imageUrl?: string
    })
  | (ReferenceInfoBase & {
      source: 'image'
      fileName: string
    })
  | (ReferenceInfoBase & {
      source: 'url'
      imageUrl: string
    })
  | (ReferenceInfoBase & {
      source: 'youtube'
      youtubeVideoId: string
    })
  | (ReferenceInfoBase & {
      source: 'pexels'
      pexelsPhotoId: number
      pexelsImageUrl: string
      pexelsPhotographerUrl?: string
      pexelsPageUrl?: string
    })
