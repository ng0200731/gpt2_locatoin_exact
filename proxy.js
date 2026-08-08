// proxy.js — Local dev server + API proxy for xiangsuai.cn
// Run:  node proxy.js
// Then open http://localhost:3001/bag-compositor.html in your browser
// (NOT file:// — that breaks fetch CORS)

import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;
const TARGET = 'https://www.xiangsuai.cn';

// CORS for the API proxy route
app.use('/api', cors({
  origin: true,
  credentials: true,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// CORS for the /files proxy route (GET image downloads)
app.use('/files', cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Health check
app.get('/health', (_, res) => res.send('OK'));

// Serve static files from this directory (bag-compositor.html etc.)
app.use(express.static(__dirname));

// Proxy /api/* → https://www.xiangsuai.cn/*
app.use('/api', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },          // /api/v1/... → /v1/...
  onProxyReq: (proxyReq, req, _res) => {
    // Forward Authorization header if present
    const auth = req.headers.authorization;
    if (auth) proxyReq.setHeader('Authorization', auth);
  },
  onError: (err, _req, res) => {
    console.error('[Proxy Error /api]', err.message);
    res.status(502).json({ error: 'Bad Gateway', message: err.message });
  }
}));

// Proxy /files/* → https://files.closeai.fans/*
// The upstream image API returns image URLs on files.closeai.fans; the browser
// can't fetch those cross-origin without CORS taint, so we proxy them here too.
// Let createProxyMiddleware do path REWRITING its own way, then we override the
// proxied path in onProxyReq (proxyReq.path) to guarantee the leading "/files"
// is stripped and "/filesystem/..." is preserved.
const FILES_TARGET = 'https://files.closeai.fans';
app.use('/files', createProxyMiddleware({
  target: FILES_TARGET,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },          // placeholder; real rewrite below
  onProxyReq: (proxyReq, req) => {
    // req.url is "/files/filesystem/..." → strip the "/files" prefix ourselves.
    const cleanPath = req.url.replace(/^\/files/, '');
    proxyReq.path = cleanPath;
    proxyReq.setHeader('Referer', 'https://www.xiangsuai.cn/');
    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36');
    console.log('[/files proxy]', req.url, '→', cleanPath);
  },
  onError: (err, _req, res) => {
    console.error('[Proxy Error /files]', err.message);
    res.status(502).json({ error: 'Bad Gateway', message: err.message });
  }
}));

app.listen(PORT, () => {
  console.log(`🚀 Server + proxy running at http://localhost:${PORT}`);
  console.log(`   Open    → http://localhost:${PORT}/bag-compositor.html`);
  console.log(`   Proxy   /api/* → ${TARGET}/*`);
});