// Serves web/ on http://127.0.0.1:8731 so browser wallets see a fixed origin.
import { createServer } from 'node:http'; import { readFile } from 'node:fs/promises'; import { join, extname } from 'node:path'; import { writeFile, mkdir } from 'node:fs/promises'
const root = new URL('../web/', import.meta.url).pathname
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }
createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/results') {
    let body = ''; for await (const c of req) body += c
    const dir = new URL('../results/', import.meta.url).pathname; await mkdir(dir, { recursive: true })
    const name = `wallet-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    await writeFile(join(dir, name), body); console.log('saved results/' + name)
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ saved: name })); return
  }
  const p = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  try { res.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(join(root, p))) }
  catch { res.statusCode = 404; res.end('not found') }
}).listen(8731, '127.0.0.1', () => console.log('S1 harness: http://127.0.0.1:8731'))
