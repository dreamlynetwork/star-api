import { downloadLinks, imageLinks } from './saavn'

const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v))
const arr = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

export const mapArtistRef = (a: any) => ({
  id: a?.id ?? null,
  name: a?.name ?? null,
  role: a?.role ?? null,
  type: a?.type ?? null,
  image: imageLinks(a?.image),
  url: a?.perma_url ?? null
})

const mapArtistMap = (m: any) => ({
  primary: arr(m?.primary_artists).map(mapArtistRef),
  featured: arr(m?.featured_artists).map(mapArtistRef),
  all: arr(m?.artists).map(mapArtistRef)
})

export const isSongLike = (v: any) => v && typeof v === 'object' && typeof v.id === 'string' && 'title' in v

export const mapSong = (s: any) => ({
  id: s.id,
  name: s.title,
  type: s.type ?? 'song',
  year: s.year || null,
  releaseDate: s.more_info?.release_date || null,
  duration: num(s.more_info?.duration),
  label: s.more_info?.label || null,
  explicitContent: s.explicit_content === '1',
  playCount: num(s.play_count),
  language: s.language ?? null,
  hasLyrics: s.more_info?.has_lyrics === 'true',
  lyricsId: s.more_info?.lyrics_id || null,
  url: s.perma_url ?? null,
  copyright: s.more_info?.copyright_text || null,
  album: {
    id: s.more_info?.album_id || null,
    name: s.more_info?.album || null,
    url: s.more_info?.album_url || null
  },
  artists: mapArtistMap(s.more_info?.artistMap),
  image: imageLinks(s.image),
  downloadUrl: downloadLinks(s.more_info?.encrypted_media_url)
})

export const mapAlbum = (a: any) => ({
  id: a.id ?? a.albumid ?? null,
  name: a.title ?? a.name ?? null,
  description: a.header_desc || a.subtitle || null,
  year: num(a.year),
  type: a.type ?? 'album',
  playCount: num(a.play_count),
  language: a.language ?? null,
  explicitContent: a.explicit_content === '1',
  url: a.perma_url ?? null,
  songCount: num(a.more_info?.song_count ?? a.list_count),
  artists: mapArtistMap(a.more_info?.artistMap),
  image: imageLinks(a.image),
  songs: arr(a.list).filter(isSongLike).map(mapSong)
})

export const mapPlaylist = (p: any) => ({
  id: p.id ?? null,
  name: p.title ?? p.name ?? null,
  description: p.header_desc || p.subtitle || null,
  year: num(p.year),
  type: p.type ?? 'playlist',
  playCount: num(p.play_count),
  language: p.language ?? null,
  explicitContent: p.explicit_content === '1',
  songCount: num(p.list_count),
  url: p.perma_url ?? null,
  image: imageLinks(p.image),
  artists: arr(p.more_info?.artists).map(mapArtistRef),
  songs: arr(p.list).filter(isSongLike).map(mapSong)
})

const parseBio = (bio: unknown) => {
  if (typeof bio !== 'string' || !bio) return []
  try {
    return JSON.parse(bio)
  } catch {
    return []
  }
}

export const mapArtist = (a: any) => ({
  id: a.artistId ?? a.id ?? null,
  name: a.name ?? null,
  url: a.urls?.overview ?? a.perma_url ?? null,
  type: a.type ?? 'artist',
  followerCount: num(a.follower_count),
  fanCount: a.fan_count ?? null,
  isVerified: a.isVerified ?? null,
  dominantLanguage: a.dominantLanguage ?? null,
  dominantType: a.dominantType ?? null,
  bio: parseBio(a.bio),
  image: imageLinks(a.image),
  topSongs: arr(a.topSongs).filter(isSongLike).map(mapSong),
  topAlbums: arr(a.topAlbums).map(mapAlbum),
  singles: arr(a.singles).map(mapAlbum),
  similarArtists: arr(a.similarArtists).map((s: any) => ({
    id: s.id ?? null,
    name: s.name ?? null,
    url: s.perma_url ?? null,
    image: imageLinks(s.image)
  }))
})

/** search.* endpoints answer { total, start, results: [...] } */
export const mapSearchList = (data: any, mapper: (x: any) => unknown) => ({
  total: num(data?.total) ?? 0,
  start: num(data?.start) ?? 0,
  results: arr(data?.results).map(mapper)
})

/** Accepts an array, or an object like { '0': { song }, '1': { song } } and returns mapped songs. */
export const mapSongCollection = (data: unknown) => {
  const values = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data) : []
  return values
    .map((v: any) => (isSongLike(v) ? v : isSongLike(v?.song) ? v.song : null))
    .filter(Boolean)
    .map(mapSong)
}
