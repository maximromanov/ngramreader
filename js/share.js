// Compact links (shared by both apps; keep both copies the same): the view state as JSON, deflated (fflate) and in
// base64url, in the URL hash: #v=2&s=<state>. No outside service.
import { LIBS } from './config.js'
let fflate
const lib = () => (fflate ??= import(LIBS.fflate))
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
export async function packState(state) {
  const { deflateSync, strToU8 } = await lib()
  return `#v=2&s=${b64u(deflateSync(strToU8(JSON.stringify(state)), { level: 9 }))}`
}
export async function unpackState(hash) {
  const m = /^#v=2&s=([A-Za-z0-9_-]+)/.exec(hash ?? ''); if (!m) return null
  const { inflateSync, strFromU8 } = await lib()
  try { return JSON.parse(strFromU8(inflateSync(unb64u(m[1])))) } catch { return null }
}
