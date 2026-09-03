// Serves web/ on http://127.0.0.1:8731 so browser wallets see a fixed origin.
import { createServer } from 'node:http'; import { readFile } from 'node:fs/promises'; import { join, extname } from 'node:path'
const root = new URL('../web/', import.meta.url).pathname
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }
createServer(async (req, res) => {
  const p = req.url === '/' ? '/index.html' : req.url.split('?')[0]
  try { res.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream'); res.end(await readFile(join(root, p))) }
  catch { res.statusCode = 404; res.end('not found') }
}).listen(8731, '127.0.0.1', () => console.log('S1 harness: http://127.0.0.1:8731'))
