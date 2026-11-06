#!/usr/bin/env node
// Local development server (Node built-ins only, nothing to install): serves both apps and the local data copy from one
// port, with HTTP Range requests (python's http.server has none) and CORS headers.
//   node tools/dev_server.mjs [port] [ngramreader-folder] [classifier-folder] [data-folder]
//   http://localhost:8001/ngramreader/   http://localhost:8001/classifier/   http://localhost:8001/data/
import { createServer } from 'node:http'
import { createReadStream, statSync, existsSync } from 'node:fs'
import { join, extname, normalize, resolve } from 'node:path'
const [port = '8001', ngr = 'app-v1', cls = 'classifier_app-v1', data = 'data_repos/ngramreader-data-2023.1.8-derived', host = '127.0.0.1'] = process.argv.slice(2)   // host 0.0.0.0: reachable on the local network
const ROOTS = { ngramreader: resolve(ngr), classifier: resolve(cls), data: resolve(data) }
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.tsv': 'text/tab-separated-values; charset=utf-8', '.json': 'application/json', '.parquet': 'application/octet-stream' }
createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges', 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=300' }
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  const url = decodeURIComponent(req.url.split(/[?#]/)[0]); const [, top, ...rest] = url.split('/')
  const root = ROOTS[top]
  if (!root) { res.writeHead(302, { Location: '/ngramreader/' }); return res.end() }
  let file = normalize(join(root, ...rest)); if (!file.startsWith(root)) { res.writeHead(403, cors); return res.end() }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) { res.writeHead(404, cors); return res.end('not found') }
  const size = statSync(file).size, type = TYPES[extname(file)] ?? 'application/octet-stream'
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (m) {
    let a = m[1] === '' ? size - Number(m[2]) : Number(m[1]), b = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1
    if (a < 0) a = 0
    if (a >= size || a > b) { res.writeHead(416, { ...cors, 'Content-Range': `bytes */${size}` }); return res.end() }
    res.writeHead(206, { ...cors, 'Content-Type': type, 'Content-Length': b - a + 1, 'Content-Range': `bytes ${a}-${b}/${size}` })
    return req.method === 'HEAD' ? res.end() : createReadStream(file, { start: a, end: b }).pipe(res)
  }
  res.writeHead(200, { ...cors, 'Content-Type': type, 'Content-Length': size })
  req.method === 'HEAD' ? res.end() : createReadStream(file).pipe(res)
}).listen(Number(port), host, () => console.log(`http://localhost:${port}/ngramreader/  http://localhost:${port}/classifier/  http://localhost:${port}/data/`))
