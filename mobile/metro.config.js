const { getDefaultConfig } = require('expo/metro-config');
const http = require('http');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.server = config.server || {};
const prevEnhance = config.server.enhanceMiddleware;

/**
 * Proxies /api/* requests arriving on Metro's port (8081 / Expo Tunnel) directly to the local
 * Python YOLOv8 + AffectNet + SQLite server on 127.0.0.1:8000 so Windows Firewall or Wi-Fi AP rules never block!
 */
config.server.enhanceMiddleware = (metroMiddleware, metroServer) => {
  const baseMiddleware = prevEnhance ? prevEnhance(metroMiddleware, metroServer) : metroMiddleware;

  return (req, res, next) => {
    if (req.url && req.url.startsWith('/api/')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
        });
        res.end();
        return;
      }

      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const forwardHeaders = {
          Accept: req.headers['accept'] || 'application/json',
        };
        if (req.headers['authorization']) {
          forwardHeaders['Authorization'] = req.headers['authorization'];
        }
        if (req.headers['cookie']) {
          forwardHeaders['Cookie'] = req.headers['cookie'];
        }
        if (req.headers['user-agent']) {
          forwardHeaders['User-Agent'] = req.headers['user-agent'];
        }
        if (body.length > 0) {
          forwardHeaders['Content-Type'] = req.headers['content-type'] || 'application/json';
          forwardHeaders['Content-Length'] = body.length;
        }

        const proxyReq = http.request(
          {
            hostname: '127.0.0.1',
            port: 8000,
            path: req.url,
            method: req.method || 'GET',
            headers: forwardHeaders,
            timeout: 15000,
          },
          (proxyRes) => {
            const respHeaders = {
              'Content-Type': proxyRes.headers['content-type'] || 'application/json',
              'Access-Control-Allow-Origin': '*',
            };
            if (proxyRes.headers['location']) {
              respHeaders['Location'] = proxyRes.headers['location'];
            }
            if (proxyRes.headers['set-cookie']) {
              respHeaders['Set-Cookie'] = proxyRes.headers['set-cookie'];
            }
            res.writeHead(proxyRes.statusCode || 200, respHeaders);
            proxyRes.pipe(res);
          }
        );

        proxyReq.on('error', () => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              detail: 'Bilgisayarınızdaki Python sunucusu (127.0.0.1:8000) henüz hazırlanıyor…',
            })
          );
        });

        proxyReq.on('timeout', () => {
          proxyReq.destroy();
          if (!res.headersSent) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: 'Bilgisayar sunucusu yanıt zaman aşımına uğradı.' }));
          }
        });

        if (body.length > 0) {
          proxyReq.write(body);
        }
        proxyReq.end();
      });
      return;
    }
    return baseMiddleware(req, res, next);
  };
};

module.exports = config;
