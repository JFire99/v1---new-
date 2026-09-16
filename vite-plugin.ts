import type { Plugin, ViteDevServer } from 'vite';
import { ResilientScanner } from './src/resilient-scanner';
import { ResilientNewsEngine } from './src/resilient-news-engine';
import type { ScannerSettings } from './src/types/scanner';

export function jfire(env: Record<string, string>): Plugin {
  let s: ResilientScanner | null = null;
  let n: ResilientNewsEngine | null = null;
  const clients = new Set<any>();

  const send = (x: any) => {
    const d = `data: ${JSON.stringify(x)}\n\n`;
    for (const c of clients) {
      try {
        c.write(d);
      } catch {
        clients.delete(c);
      }
    }
  };

  const getScanner = () => {
    if (s) return s;
    const apiKey =
      env.ALPACA_API_KEY ||
      process.env.ALPACA_API_KEY ||
      env.ALPACA_API_KEY_ID ||
      process.env.ALPACA_API_KEY_ID;
    const apiSecret =
      env.ALPACA_API_SECRET ||
      process.env.ALPACA_API_SECRET ||
      env.ALPACA_API_SECRET_KEY ||
      process.env.ALPACA_API_SECRET_KEY;
    const feed = env.ALPACA_FEED || process.env.ALPACA_FEED || 'iex';

    if (!apiKey || !apiSecret) return null;
    s = new ResilientScanner(apiKey, apiSecret, feed, send);

    // Initialize NewsEngine with stock snapshot callback
    n = new ResilientNewsEngine(apiKey, apiSecret, send, (sym) => s?.getSnapshotForNews(sym) || null);
    s.setNewsEngine(n);

    void s.start();
    void n.start();
    return s;
  };

  const getNewsEngine = () => {
    if (n) return n;
    getScanner();
    return n;
  };

  return {
    name: 'jfire',
    configureServer(v: ViteDevServer) {
      // 1. Status endpoint
      v.middlewares.use('/api/status', (_, res) => {
        res.setHeader('Content-Type', 'application/json');
        const scanner = getScanner();
        res.end(
          JSON.stringify(
            scanner?.status() || { connected: false, error: 'Missing Alpaca credentials' }
          )
        );
      });

      // 2. Stocks endpoint
      v.middlewares.use('/api/stocks', (_, res) => {
        res.setHeader('Content-Type', 'application/json');
        const scanner = getScanner();
        res.end(
          JSON.stringify(
            scanner?.payload() || { stocks: [], universeSize: 0, stocksTracked: 0 }
          )
        );
      });

      // 2b. Diagnostics endpoint
      v.middlewares.use('/api/diagnostics', (_, res) => {
        res.setHeader('Content-Type', 'application/json');
        const scanner = getScanner();
        res.end(JSON.stringify(scanner?.getDiagnostics() || {}));
      });

      // 2c. News endpoint
      v.middlewares.use('/api/news', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        const newsEngine = getNewsEngine();
        const url = new URL(req.url || '', 'http://localhost');
        const sym = url.searchParams.get('symbol');
        if (sym) {
          res.end(JSON.stringify({ articles: newsEngine?.getArticlesForSymbol(sym) || [] }));
          return;
        }
        res.end(
          JSON.stringify({
            articles: newsEngine?.getArticles(150) || [],
            status: newsEngine?.status() || { connected: false },
          })
        );
      });

      // 3. Settings endpoint
      v.middlewares.use('/api/settings', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        const scanner = getScanner();
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const updated = JSON.parse(body) as Partial<ScannerSettings>;
              if (scanner) {
                scanner.updateSettings(updated);
                res.end(JSON.stringify({ ok: true, settings: scanner.settings }));
                return;
              }
            } catch {}
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid settings payload' }));
          });
        } else {
          res.end(JSON.stringify(scanner?.settings || {}));
        }
      });

      // 4. SSE Stream endpoint
      v.middlewares.use('/api/stream', (req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        clients.add(res);

        const scanner = getScanner();
        const newsEngine = getNewsEngine();
        res.write(
          `data: ${JSON.stringify({ type: 'connection_status', ...(scanner?.status() || {}) })}\n\n`
        );
        res.write(
          `data: ${JSON.stringify({ type: 'stocks', ...(scanner?.payload() || {}) })}\n\n`
        );
        if (newsEngine) {
          res.write(
            `data: ${JSON.stringify({ type: 'news_init', articles: newsEngine.getArticles(100) })}\n\n`
          );
          res.write(
            `data: ${JSON.stringify({ type: 'news_status', ...newsEngine.status() })}\n\n`
          );
        }

        const pingInterval = setInterval(() => {
          try {
            res.write(': ping\n\n');
          } catch {}
        }, 15000);

        req.on('close', () => {
          clearInterval(pingInterval);
          clients.delete(res);
        });
      });
    },
    closeBundle() {
      s?.stop();
      n?.stop();
    },
  };
}
