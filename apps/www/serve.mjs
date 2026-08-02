import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = new URL("./out/", import.meta.url).pathname;
const port = Number(process.env.PORT ?? 3000);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
};

createServer((request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(root, safePath === "/" ? "index.html" : safePath);

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (!existsSync(filePath)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
    return;
  }

  response.setHeader("Content-Type", mimeTypes[extname(filePath)] ?? "application/octet-stream");
  response.setHeader("Cache-Control", "no-store");
  createReadStream(filePath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Vital Agent Sync website: http://127.0.0.1:${port}`);
});
