#!/usr/bin/env node
// 构建后前端的同源服务：静态 apps/web/dist + API 反代（与 deploy/nginx.conf 的路径语义一致：
// ^/(auth|base|admin|health) 转发到后端，其余走 SPA 回退到 index.html）。
// 仅用于浏览器验收作业，替代 nginx；差异记录在 docs/playtests/browser-review-environment.md。
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const WEB_PORT = Number(process.env.PLAYTEST_WEB_PORT ?? 4173);
const API_ORIGIN = `http://127.0.0.1:${process.env.SERVER_PORT ?? 3000}`;
const DIST = resolve(process.env.PLAYTEST_WEB_DIST ?? "apps/web/dist");
const API_PREFIX = /^\/(auth|base|admin|health)(\/|$)/;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8"
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let filePath = normalize(join(DIST, urlPath));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(DIST, "index.html"); // SPA 回退
  }
  if (!existsSync(filePath)) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("frontend build output missing (apps/web/dist)");
    return;
  }
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(res);
}

function proxyApi(req, res) {
  const upstream = new URL(req.url, API_ORIGIN);
  const proxyReq = http.request(
    {
      host: "127.0.0.1",
      port: Number(new URL(API_ORIGIN).port),
      path: upstream.pathname + upstream.search,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${new URL(API_ORIGIN).port}` }
    },
    (proxyRes) => {
      const headers = { ...proxyRes.headers };
      delete headers["transfer-encoding"]; // 由 node 重新定长
      res.writeHead(proxyRes.statusCode ?? 502, headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", (error) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "api_unreachable", detail: String(error) }));
  });
  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  if (API_PREFIX.test(new URL(req.url, "http://localhost").pathname)) {
    proxyApi(req, res);
  } else {
    serveStatic(req, res);
  }
});

server.listen(WEB_PORT, "127.0.0.1", () => {
  console.log(`[serve-web] dist=${DIST} api=${API_ORIGIN} listening on http://127.0.0.1:${WEB_PORT}`);
});
