// Static server for web/. WebAuthn treats http://localhost as a secure context.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const root = new URL("./web/", import.meta.url);
const types = { ".html": "text/html", ".js": "text/javascript", ".map": "application/json" };
export function serve(port) {
  const server = createServer(async (req, res) => {
    const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    try {
      const body = await readFile(new URL("." + path, root));
      res.writeHead(200, { "content-type": types[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
