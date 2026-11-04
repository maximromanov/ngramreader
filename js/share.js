// Compact links (shared by both apps; keep both copies the same): the view state as JSON in base64url in the URL hash:
// #2z<deflated> or #2r<plain>, whichever is shorter (short states do not compress). No outside service.
// The first form of these links, #v=2&s=<deflated>, is still read.
import { LIBS } from './config.js'
let fflate
const lib = () => (fflate ??= import(LIBS.fflate))
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
export async function packState(state) {
  const { deflateSync, strToU8 } = await lib()
  const plain = strToU8(JSON.stringify(state)), z = deflateSync(plain, { level: 9 })
  return z.length < plain.length ? `#2z${b64u(z)}` : `#2r${b64u(plain)}`
}
export async function unpackState(hash) {
  const m = /^#(?:v=2&s=|2(z|r))([A-Za-z0-9_-]+)/.exec(hash ?? ''); if (!m) return null
  const { inflateSync, strFromU8 } = await lib()
  try { const b = unb64u(m[2]); return JSON.parse(strFromU8(m[1] === 'r' ? b : inflateSync(b))) } catch { return null }
}
