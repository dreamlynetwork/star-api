import forge from 'node-forge'
import { HTTPException } from 'hono/http-exception'
import { config } from './config'

type Params = Record<string, string | number | undefined | null>
export type Ctx = 'web6dot0' | 'android'

const HEADERS = {
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36'
}

/** One place that talks to JioSaavn. Never throws raw errors: always an HTTPException. */
export async function saavn<T = any>(call: string, params: Params = {}, ctx: Ctx = 'web6dot0'): Promise<T> {
  const url = new URL(config.saavn.baseUrl)
  url.searchParams.set('__call', call)
  url.searchParams.set('_format', config.saavn._format)
  url.searchParams.set('_marker', String(config.saavn._marker))
  url.searchParams.set('api_version', config.saavn.api_version)
  url.searchParams.set('ctx', ctx)

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }

  let res: Response
  try {
    res = await fetch(url.toString(), { headers: HEADERS })
  } catch {
    throw new HTTPException(502, { message: 'could not reach the upstream music service' })
  }
  if (!res.ok) throw new HTTPException(502, { message: `upstream music service returned ${res.status}` })

  try {
    return (await res.json()) as T
  } catch {
    throw new HTTPException(502, { message: 'upstream music service returned an invalid response' })
  }
}

/** Last path segment of a jiosaavn.com link (the "token" webapi.get expects). */
export function tokenFromLink(link: string): string {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    throw new HTTPException(400, { message: 'link must be a valid URL' })
  }
  if (url.hostname !== 'jiosaavn.com' && !url.hostname.endsWith('.jiosaavn.com')) {
    throw new HTTPException(400, { message: 'link must be a jiosaavn.com URL' })
  }
  const token = url.pathname.split('/').filter(Boolean).pop()
  if (!token) throw new HTTPException(400, { message: 'could not read a token from the link' })
  return token
}

const QUALITIES = [
  { id: '_12', bitrate: '12kbps' },
  { id: '_48', bitrate: '48kbps' },
  { id: '_96', bitrate: '96kbps' },
  { id: '_160', bitrate: '160kbps' },
  { id: '_320', bitrate: '320kbps' }
]

export function downloadLinks(encrypted?: string) {
  if (!encrypted) return []
  try {
    const decipher = forge.cipher.createDecipher('DES-ECB', forge.util.createBuffer('38346591'))
    decipher.start({})
    decipher.update(forge.util.createBuffer(forge.util.decode64(encrypted)))
    decipher.finish()
    const base = decipher.output.getBytes()
    return QUALITIES.map((q) => ({ quality: q.bitrate, url: base.replace('_96', q.id) }))
  } catch {
    return []
  }
}

export function imageLinks(link?: string) {
  if (!link) return []
  return ['50x50', '150x150', '500x500'].map((quality) => ({
    quality,
    url: link.replace(/150x150|50x50/, quality).replace(/^http:\/\//, 'https://')
  }))
}
