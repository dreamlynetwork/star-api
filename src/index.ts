import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'

import { E } from './config'
import { saavn, tokenFromLink } from './saavn'
import {
  mapAlbum,
  mapArtist,
  mapPlaylist,
  mapSearchList,
  mapSong,
  mapSongCollection
} from './mappers'

const app = new Hono()
app.use(logger())
app.use(cors())

/* ------------------------------ helpers ------------------------------ */

const ok = (c: Context, data: unknown) => c.json({ success: true, data })

const bad = (message: string) => new HTTPException(400, { message })

/** Required, trimmed query parameter. */
const need = (c: Context, name: string) => {
  const v = c.req.query(name)?.trim()
  if (!v) throw bad(`${name} is required`)
  return v
}

/** Optional integer query parameter with bounds. */
const int = (c: Context, name: string, def: number, min = 0, max = 100) => {
  const raw = c.req.query(name)
  if (raw === undefined || raw === '') return def
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} must be an integer between ${min} and ${max}`)
  return n
}

/** Path ids: letters, digits, _ and -, optionally comma separated. */
const id = (c: Context, name = 'id', multiple = false) => {
  const v = c.req.param(name)
  const re = multiple ? /^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$/ : /^[A-Za-z0-9_-]+$/
  if (!v || !re.test(v)) throw bad(`invalid ${name}`)
  return v
}

const found = <T>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) throw new HTTPException(404, { message: `${what} not found` })
  return value
}

const isEmpty = (v: unknown) =>
  !v || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)

/* -------------------------------- index -------------------------------- */

app.get('/', (c) =>
  c.json({
    success: true,
    name: 'star-api',
    version: '3.0.0',
    routes: [
      'GET /api/song/:id[,:id]?lyrics=true',
      'GET /api/song?link=',
      'GET /api/song/:id/recommended?limit=',
      'GET /api/song/:id/suggestions?limit=',
      'GET /api/song/:id/lyrics',
      'GET /api/album/:id',
      'GET /api/album?link=',
      'GET /api/album/:id/recommended',
      'GET /api/albums/top?year=&language=',
      'GET /api/playlist/:id?page=&limit=',
      'GET /api/playlist?link=&page=&limit=',
      'GET /api/playlist/:id/recommended',
      'GET /api/artist/:id?songs=&albums=',
      'GET /api/artist?link=',
      'GET /api/artist/:id/songs?page=&sort=&category=',
      'GET /api/artist/:id/albums?page=&sort=&category=',
      'GET /api/artist/:id/top-songs?songId=&language=',
      'GET /api/search?query=',
      'GET /api/search/{songs|albums|artists|playlists}?query=&page=&limit=',
      'GET /api/search/top',
      'GET /api/search/more?query=&page=&limit=',
      'GET /api/modules/home | /api/modules/browse',
      'GET /api/radio/featured?name=&language= | /api/radio/artist?name=&language=',
      'GET /api/radio/song/:id | /api/radio/:stationId/songs?limit=',
      'GET /api/show?link= | /api/show/:id/episodes | /api/episode?link=',
      'GET /api/trending?type=&language=',
      'GET /api/charts | /api/featured-playlists | /api/top-shows | /api/top-artists | /api/top-albums',
      'GET /api/featured-stations | /api/footer | /api/mega-menu',
      'GET /api/mix?link= | /api/label?link= | /api/channel?link='
    ]
  })
)

const api = new Hono()

/* -------------------------------- songs -------------------------------- */

api.get('/song', async (c) => {
  const token = tokenFromLink(need(c, 'link'))
  const data = await saavn(E.song.link, { token, type: 'song' })
  const songs = (data?.songs ?? []).map(mapSong)
  return ok(c, found(songs.length ? songs : null, 'song'))
})

api.get('/song/:id', async (c) => {
  const pids = id(c, 'id', true)
  const withLyrics = c.req.query('lyrics') === 'true'

  const data = await saavn(E.song.id, { pids })
  const songs = (data?.songs ?? []).map(mapSong)
  if (!songs.length) throw new HTTPException(404, { message: 'song not found' })

  if (withLyrics) {
    await Promise.all(
      songs.map(async (song: any) => {
        song.lyrics = await saavn(E.get.lyrics, { lyrics_id: song.id }).then(
          (l) => (isEmpty(l) ? null : { lyrics: l.lyrics ?? null, snippet: l.snippet ?? null, copyright: l.lyrics_copyright ?? null }),
          () => null
        )
      })
    )
  }
  return ok(c, songs)
})

api.get('/song/:id/recommended', async (c) => {
  const pid = id(c)
  const limit = int(c, 'limit', 10, 1, 50)
  const data = await saavn(E.song.recommended, { pid, language: c.req.query('language') })
  return ok(c, mapSongCollection(data).slice(0, limit))
})

api.get('/song/:id/suggestions', async (c) => {
  const songId = id(c)
  const limit = int(c, 'limit', 10, 1, 50)

  const station = await saavn<{ stationid?: string }>(
    E.radio.entity,
    { entity_id: JSON.stringify([encodeURIComponent(songId)]), entity_type: 'queue' },
    'android'
  )
  if (!station?.stationid) throw new HTTPException(404, { message: 'could not create a station for the given song' })

  const { stationid: _s, ...entries } = await saavn<Record<string, unknown>>(
    E.radio.songs,
    { stationid: station.stationid, k: limit },
    'android'
  )

  const songs = mapSongCollection(entries).filter((s) => s.id !== songId).slice(0, limit)
  if (!songs.length) throw new HTTPException(404, { message: 'no suggestions found for the given song' })
  return ok(c, songs)
})

api.get('/song/:id/lyrics', async (c) => {
  const data = await saavn(E.get.lyrics, { lyrics_id: id(c) })
  if (isEmpty(data) || !data.lyrics) throw new HTTPException(404, { message: 'lyrics not found' })
  return ok(c, { lyrics: data.lyrics, snippet: data.snippet ?? null, copyright: data.lyrics_copyright ?? null })
})

/* -------------------------------- albums -------------------------------- */

api.get('/albums/top', async (c) => {
  const year = int(c, 'year', new Date().getFullYear(), 1950, new Date().getFullYear() + 1)
  const data = await saavn(E.album.top_albums_by_year, { year, language: c.req.query('language') ?? 'hindi' })
  const list = Array.isArray(data) ? data : data?.albums ?? data?.data ?? []
  return ok(c, list.map(mapAlbum))
})

api.get('/album', async (c) => {
  const token = tokenFromLink(need(c, 'link'))
  const data = await saavn(E.album.token, { token, type: 'album' })
  return ok(c, mapAlbum(found(isEmpty(data) ? null : data, 'album')))
})

api.get('/album/:id', async (c) => {
  const data = await saavn(E.album.id, { albumid: id(c) })
  return ok(c, mapAlbum(found(isEmpty(data) ? null : data, 'album')))
})

api.get('/album/:id/recommended', async (c) => {
  const data = await saavn(E.album.recommended, { albumid: id(c) })
  const list = Array.isArray(data) ? data : Object.values(data ?? {})
  return ok(c, list.map(mapAlbum))
})

/* ------------------------------- playlists ------------------------------- */

const playlistParams = (c: Context) => ({ p: int(c, 'page', 0, 0, 1000), n: int(c, 'limit', 50, 1, 100) })

api.get('/playlist', async (c) => {
  const token = tokenFromLink(need(c, 'link'))
  const data = await saavn(E.playlist.token, { token, type: 'playlist', ...playlistParams(c) })
  return ok(c, mapPlaylist(found(isEmpty(data) ? null : data, 'playlist')))
})

api.get('/playlist/:id', async (c) => {
  const data = await saavn(E.playlist.id, { listid: id(c), ...playlistParams(c) })
  return ok(c, mapPlaylist(found(isEmpty(data) ? null : data, 'playlist')))
})

api.get('/playlist/:id/recommended', async (c) => {
  const data = await saavn(E.playlist.recommended, { listid: id(c) })
  const list = Array.isArray(data) ? data : Object.values(data ?? {})
  return ok(c, list.map(mapPlaylist))
})

/* -------------------------------- artists -------------------------------- */

const artistListParams = (c: Context) => ({
  page: int(c, 'page', 0, 0, 1000),
  sort_order: c.req.query('sort') === 'desc' ? 'desc' : 'asc',
  category: c.req.query('category') ?? 'latest'
})

api.get('/artist', async (c) => {
  const token = tokenFromLink(need(c, 'link'))
  const data = await saavn(E.artist.link, {
    token,
    type: 'artist',
    n_song: int(c, 'songs', 10, 0, 50),
    n_album: int(c, 'albums', 10, 0, 50),
    ...artistListParams(c)
  })
  return ok(c, mapArtist(found(isEmpty(data) ? null : data, 'artist')))
})

api.get('/artist/:id', async (c) => {
  const data = await saavn(E.artist.id, {
    artistId: id(c),
    n_song: int(c, 'songs', 10, 0, 50),
    n_album: int(c, 'albums', 10, 0, 50),
    ...artistListParams(c)
  })
  return ok(c, mapArtist(found(isEmpty(data) ? null : data, 'artist')))
})

api.get('/artist/:id/songs', async (c) => {
  const data = await saavn(E.artist.songs, { artistId: id(c), ...artistListParams(c) })
  const block = data?.topSongs ?? data
  return ok(c, { total: block?.total ?? 0, songs: (block?.songs ?? []).map(mapSong) })
})

api.get('/artist/:id/albums', async (c) => {
  const data = await saavn(E.artist.albums, { artistId: id(c), ...artistListParams(c) })
  const block = data?.topAlbums ?? data
  return ok(c, { total: block?.total ?? 0, albums: (block?.albums ?? []).map(mapAlbum) })
})

api.get('/artist/:id/top-songs', async (c) => {
  const data = await saavn(E.artist.top_songs, {
    artist_ids: id(c),
    song_id: c.req.query('songId'),
    language: c.req.query('language') ?? 'hindi'
  })
  return ok(c, mapSongCollection(data))
})

/* -------------------------------- search -------------------------------- */

const searchParams = (c: Context) => ({
  q: need(c, 'query'),
  p: int(c, 'page', 0, 0, 1000),
  n: int(c, 'limit', 10, 1, 50)
})

api.get('/search/top', async (c) => ok(c, await saavn(E.search.top_search)))

api.get('/search/more', async (c) => {
  const { q, p, n } = searchParams(c)
  return ok(c, await saavn(E.search.more, { query: q, p, n }))
})

api.get('/search/songs', async (c) =>
  ok(c, mapSearchList(await saavn(E.search.songs, searchParams(c)), mapSong))
)
api.get('/search/albums', async (c) =>
  ok(c, mapSearchList(await saavn(E.search.albums, searchParams(c)), mapAlbum))
)
api.get('/search/playlists', async (c) =>
  ok(c, mapSearchList(await saavn(E.search.playlists, searchParams(c)), mapPlaylist))
)
api.get('/search/artists', async (c) =>
  ok(c, mapSearchList(await saavn(E.search.artists, searchParams(c)), (a: any) => ({
    id: a.id ?? null,
    name: a.name ?? a.title ?? null,
    role: a.role ?? null,
    url: a.perma_url ?? null
  })))
)

api.get('/search', async (c) => ok(c, await saavn(E.search.all, { query: need(c, 'query') })))

/* --------------------------- modules and lists --------------------------- */

api.get('/modules/home', async (c) => ok(c, await saavn(E.modules.home)))
api.get('/modules/browse', async (c) => ok(c, await saavn(E.modules.browse_modules)))

api.get('/trending', async (c) =>
  ok(c, await saavn(E.get.trending, {
    entity_type: c.req.query('type') ?? 'song',
    entity_language: c.req.query('language') ?? 'hindi'
  }))
)

const paged = (c: Context) => ({ p: int(c, 'page', 0, 0, 1000), n: int(c, 'limit', 20, 1, 100) })
const lang = (c: Context) => c.req.query('language') ?? 'hindi'

api.get('/charts', async (c) => ok(c, await saavn(E.get.charts)))
api.get('/featured-playlists', async (c) =>
  ok(c, await saavn(E.get.featured_playlists, { ...paged(c), language: lang(c), fetch_from_serialized_files: 'true' }))
)
api.get('/top-shows', async (c) => ok(c, await saavn(E.get.top_shows, paged(c))))
api.get('/top-artists', async (c) => ok(c, await saavn(E.get.top_artists, paged(c))))
api.get('/top-albums', async (c) => ok(c, await saavn(E.get.top_albums, { ...paged(c), language: lang(c) })))
api.get('/featured-stations', async (c) => ok(c, await saavn(E.get.featured_stations)))
api.get('/footer', async (c) => ok(c, await saavn(E.get.footer_details)))
api.get('/mega-menu', async (c) => ok(c, await saavn(E.get.mega_menu)))

/* --------------------------- link based lookups --------------------------- */

const byLink = (type: string, call: string) => async (c: Context) => {
  const token = tokenFromLink(need(c, 'link'))
  const data = await saavn(call, { token, type, ...paged(c) })
  return ok(c, found(isEmpty(data) ? null : data, type))
}

api.get('/mix', byLink('mix', E.get.mix_details))
api.get('/label', byLink('label', E.get.label_details))
api.get('/channel', byLink('channel', E.channel.token))
api.get('/show', byLink('show', E.show.show_details))
api.get('/episode', byLink('episode', E.show.episode_details))

api.get('/show/:id/episodes', async (c) =>
  ok(c, await saavn(E.show.episodes, { show_id: id(c), sort_order: c.req.query('sort') === 'asc' ? 'asc' : 'desc', ...paged(c) }))
)

/* --------------------------------- radio --------------------------------- */

api.get('/radio/featured', async (c) =>
  ok(c, await saavn(E.radio.featured, { name: need(c, 'name'), language: lang(c) }, 'android'))
)
api.get('/radio/artist', async (c) =>
  ok(c, await saavn(E.radio.artist, { name: need(c, 'name'), language: lang(c) }, 'android'))
)
api.get('/radio/song/:id', async (c) => {
  const station = await saavn<{ stationid?: string }>(
    E.radio.entity,
    { entity_id: JSON.stringify([encodeURIComponent(id(c))]), entity_type: 'queue' },
    'android'
  )
  return ok(c, found(station?.stationid ? { stationId: station.stationid } : null, 'station'))
})
api.get('/radio/:stationId/songs', async (c) => {
  const limit = int(c, 'limit', 10, 1, 50)
  const { stationid: _s, ...entries } = await saavn<Record<string, unknown>>(
    E.radio.songs,
    { stationid: id(c, 'stationId'), k: limit },
    'android'
  )
  const songs = mapSongCollection(entries).slice(0, limit)
  return ok(c, found(songs.length ? songs : null, 'songs for this station'))
})

/* ------------------------------ wiring / errors ------------------------------ */

app.route('/api', api)

app.notFound((c) => c.json({ success: false, message: 'route not found' }, 404))

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ success: false, message: err.message }, err.status)
  console.error(err)
  return c.json({ success: false, message: 'internal server error' }, 500)
})

export default app
