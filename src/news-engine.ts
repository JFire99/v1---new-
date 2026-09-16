import WebSocket from 'ws';
import type { NewsArticle, NewsEngineStatus, CatalystType, PriceReaction, ReactionStatus, NewsDirectionSignal } from './types/news';
import type { DataFreshness } from './types/scanner';

export interface StockSnapshotForNews {
  price: number;
  dailyChange: number | null;
  oneMinuteChange: number | null;
  fiveMinuteChange: number | null;
  relativeVolume: number | null;
  score: number;
  signal?: any;
  freshness?: DataFreshness;
  triggers: string[];
  history?: Array<{ t: number; p: number; v?: number }>;
  lastWsTime?: number;
  lastSeedTime?: number;
}

const HIGH_IMPACT_KEYWORDS = [
  'fda',
  'approval',
  'approved',
  'clearance',
  'clinical trial',
  'phase 1',
  'phase 2',
  'phase 3',
  'phase i',
  'phase ii',
  'phase iii',
  'merger',
  'acquisition',
  'acquire',
  'buyout',
  'takeover',
  'tender offer',
  'contract',
  'major contract',
  'award',
  'awarded',
  'partnership',
  'partner',
  'earnings',
  'revenue',
  'eps',
  'guidance',
  'raised guidance',
  'lowered guidance',
  'outlook',
  'analyst upgrade',
  'upgrade',
  'downgrade',
  'price target',
  'offering',
  'share offering',
  'public offering',
  'private placement',
  'sec',
  '8-k',
  'strategic',
  'strategic alternative',
  'agreement',
  'government',
  'regulatory',
  'patent',
  'breakthrough',
  'fast track',
  'orphan drug',
  'restructuring',
  'spinoff',
];

const CATALYST_KEYWORDS = [
  'reports',
  'announces',
  'launches',
  'expansion',
  'appoints',
  'ceo',
  'cfo',
  'dividend',
  'split',
  'reverse split',
  'settlement',
  'litigation',
  'lawsuit',
  'investigation',
  'compliance',
  'delisting',
  'nasdaq notice',
  'commercialization',
  'distribution',
  'joint venture',
  'milestone',
];

export function classifyCatalyst(headline: string, summary: string): { type: CatalystType; keywords: string[] } {
  const text = `${headline} ${summary}`.toLowerCase();
  const matchedHigh: string[] = [];
  const matchedCatalyst: string[] = [];

  for (const kw of HIGH_IMPACT_KEYWORDS) {
    const regex = new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (regex.test(text)) {
      matchedHigh.push(kw.toUpperCase());
    }
  }

  if (matchedHigh.length > 0) {
    return { type: 'HIGH IMPACT', keywords: matchedHigh.slice(0, 5) };
  }

  for (const kw of CATALYST_KEYWORDS) {
    const regex = new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (regex.test(text)) {
      matchedCatalyst.push(kw.toUpperCase());
    }
  }

  if (matchedCatalyst.length > 0) {
    return { type: 'CATALYST', keywords: matchedCatalyst.slice(0, 5) };
  }

  return { type: 'GENERAL', keywords: [] };
}

function findClosestHistoryPoint(
  history: { t: number; p: number }[],
  targetTime: number,
  maxDeltaMs: number
): { t: number; p: number } | null {
  if (!history || history.length === 0) return null;
  let closest: { t: number; p: number } | null = null;
  let minDelta = Infinity;
  for (const pt of history) {
    if (typeof pt.p !== 'number' || pt.p <= 0 || typeof pt.t !== 'number') continue;
    const delta = Math.abs(pt.t - targetTime);
    if (delta <= maxDeltaMs && delta < minDelta) {
      minDelta = delta;
      closest = pt;
    }
  }
  return closest;
}

function computeReactionDetails(
  priceAtNews: number,
  snap: StockSnapshotForNews | null,
  ageMs: number,
  existingRx?: PriceReaction
): {
  status: ReactionStatus;
  direction: NewsDirectionSignal;
  inActiveWsStream: boolean;
  dataStatus: DataFreshness;
} {
  const inActiveWsStream = !!(snap?.lastWsTime && Date.now() - snap.lastWsTime <= 90000);
  const dataStatus: DataFreshness = snap?.freshness || existingRx?.dataStatus || 'STALE';

  // Direction:
  let direction: NewsDirectionSignal = 'NEWS ONLY';
  if (snap) {
    const m1 = snap.oneMinuteChange;
    const m5 = snap.fiveMinuteChange;
    const isPositive =
      ((m1 !== null && m1 >= 1.0) || (m5 !== null && m5 >= 2.0)) &&
      (m1 === null || m1 > -0.5) &&
      (m5 === null || m5 > -0.5) &&
      snap.signal !== '⚪ STALE';
    const isSelling =
      (m5 !== null && m5 <= -1.0) ||
      (m1 !== null && m1 <= -1.0);

    if (isPositive) {
      direction = 'NEWS → MOMENTUM';
    } else if (isSelling) {
      direction = 'NEWS → SELLING PRESSURE';
    }
  }

  // Status:
  let status: ReactionStatus = 'NO DATA';
  if (!priceAtNews || priceAtNews <= 0) {
    status = 'NO DATA';
  } else {
    const hasAnyReaction =
      (existingRx?.reaction30s !== undefined && existingRx.reaction30s !== null) ||
      (existingRx?.reaction1m !== undefined && existingRx.reaction1m !== null) ||
      (existingRx?.reaction5m !== undefined && existingRx.reaction5m !== null) ||
      (existingRx?.reaction10m !== undefined && existingRx.reaction10m !== null);

    if (hasAnyReaction) {
      status = 'REACTION AVAILABLE';
    } else if (ageMs < 30000) {
      status = 'WAITING FOR DATA';
    } else if (snap && (snap.freshness === 'LIVE' || snap.freshness === 'SEEDED' || inActiveWsStream)) {
      status = 'TRACKING';
    } else {
      status = 'NO DATA';
    }
  }

  return { status, direction, inActiveWsStream, dataStatus };
}

export class NewsEngine {
  private key: string;
  private secret: string;
  private emit: (msg: any) => void;
  private getStockSnapshot: (symbol: string) => StockSnapshotForNews | null;

  private ws: WebSocket | null = null;
  private isConnected = false;
  private reconnectTimer: any = null;
  private reactionUpdateTimer: any = null;
  private initialSeedTimer: any = null;

  // In-memory rolling cache of articles (capped at 800)
  private articles: NewsArticle[] = [];
  private articleIds = new Set<string>();

  // Map of Symbol -> List of recent Article IDs (within 24h)
  private symbolToArticleIds = new Map<string, string[]>();

  // Map of Symbol -> Set of alerted article IDs (prevent duplicate alert spam)
  private alertedNewsArticleIds = new Set<string>();

  private lastArticleTime: string | null = null;
  private lastError: string | null = null;

  constructor(
    key: string,
    secret: string,
    emit: (msg: any) => void,
    getStockSnapshot: (symbol: string) => StockSnapshotForNews | null
  ) {
    this.key = key;
    this.secret = secret;
    this.emit = emit;
    this.getStockSnapshot = getStockSnapshot;
  }

  public async start() {
    this.connect();
    // Seed initial recent news via Alpaca REST API so user sees active news on boot
    void this.seedRecentNews();

    // Check & update price reactions every 15 seconds
    this.reactionUpdateTimer = setInterval(() => {
      this.updatePriceReactions();
    }, 15000);
  }

  public stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.reactionUpdateTimer) clearInterval(this.reactionUpdateTimer);
    if (this.initialSeedTimer) clearTimeout(this.initialSeedTimer);
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    this.isConnected = false;
  }

  private connect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }

    const wsUrl = 'wss://stream.data.alpaca.markets/v1beta1/news';
    console.log(`[JFIRE NEWS] Connecting to Alpaca News stream: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on('open', () => {
      console.log('[JFIRE NEWS] News WebSocket connected, authenticating...');
      ws.send(JSON.stringify({ action: 'auth', key: this.key, secret: this.secret }));
    });

    ws.on('message', (raw) => {
      try {
        const msgs = JSON.parse(raw.toString());
        if (Array.isArray(msgs)) {
          for (const m of msgs) {
            this.handleMessage(m);
          }
        } else if (msgs && typeof msgs === 'object') {
          this.handleMessage(msgs);
        }
      } catch (err: any) {
        console.error('[JFIRE NEWS] Message parse error:', err.message);
      }
    });

    ws.on('error', (err) => {
      console.error('[JFIRE NEWS] WebSocket error:', err.message);
      this.lastError = err.message;
    });

    ws.on('close', (code, reason) => {
      console.warn(`[JFIRE NEWS] WebSocket closed (${code}: ${reason.toString()}). Reconnecting in 5s...`);
      this.isConnected = false;
      this.emitNewsStatus();
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, 5000);
    });
  }

  private handleMessage(m: any) {
    if (!m) return;

    // Authentication reply
    if (m.T === 'success' && m.msg === 'authenticated') {
      console.log('[JFIRE NEWS] Successfully authenticated to Alpaca News stream. Subscribing to news...');
      this.isConnected = true;
      this.lastError = null;
      this.ws?.send(JSON.stringify({ action: 'subscribe', news: ['*'] }));
      this.emitNewsStatus();
      return;
    }

    // Subscription confirmation
    if (m.T === 'subscription') {
      console.log('[JFIRE NEWS] Subscribed to news channels:', m.news);
      return;
    }

    // Auth error or other error
    if (m.T === 'error') {
      console.error(`[JFIRE NEWS] Alpaca error (${m.code}): ${m.msg}`);
      this.lastError = `${m.code}: ${m.msg}`;
      this.emitNewsStatus();
      return;
    }

    // Real-time news article received (T === 'n')
    if (m.T === 'n') {
      this.processRawArticle(m);
    }
  }

  private async seedRecentNews() {
    try {
      console.log('[JFIRE NEWS] Seeding recent news via Alpaca REST API...');
      const url = 'https://data.alpaca.markets/v1beta1/news?limit=50&sort=desc&include_content=false';
      const res = await fetch(url, {
        headers: {
          'APCA-API-KEY-ID': this.key,
          'APCA-API-SECRET-KEY': this.secret,
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.news)) {
          console.log(`[JFIRE NEWS] Received ${data.news.length} initial historical news articles.`);
          // Sort oldest to newest so newest ends up at top of cache
          const chron = [...data.news].reverse();
          for (const item of chron) {
            this.processRawArticle(item, false);
          }
          this.emit({ type: 'news_init', articles: this.getArticles(100) });
          this.emitNewsStatus();
        }
      } else {
        console.warn(`[JFIRE NEWS] Seed news HTTP ${res.status}: ${res.statusText}`);
      }
    } catch (err: any) {
      console.warn('[JFIRE NEWS] Seed news error:', err.message);
    }
  }

  private processRawArticle(raw: any, emitLive = true): NewsArticle | null {
    const rawId = String(raw.id || raw.headline || Date.now());
    if (this.articleIds.has(rawId)) {
      return null;
    }

    const headline = String(raw.headline || '').trim();
    const summary = String(raw.summary || raw.content || '').trim();
    const symbols = Array.isArray(raw.symbols)
      ? raw.symbols.map((s: string) => String(s).toUpperCase()).filter((s: string) => s.length > 0 && s.length <= 8)
      : [];

    const createdAt = raw.created_at || raw.updated_at || new Date().toISOString();
    const url = raw.url || '';
    const author = raw.author || undefined;
    const source = raw.source || undefined;

    const { type: catalystType, keywords: catalystKeywords } = classifyCatalyst(headline, summary);

    const newsTimeMs = new Date(createdAt).getTime() || Date.now();

    // Attach initial price reactions and current stock snapshots
    const reactions: Record<string, PriceReaction> = {};
    const stockSnapshots: Record<string, any> = {};

    for (const sym of symbols) {
      const snap = this.getStockSnapshot(sym);
      const priceAtNews = snap && snap.price > 0 ? snap.price : 0;
      const ageMs = Date.now() - newsTimeMs;

      const details = computeReactionDetails(priceAtNews, snap, ageMs);

      reactions[sym] = {
        priceAtNews,
        newsTime: newsTimeMs,
        dataStatus: details.dataStatus,
        status: details.status,
        direction: details.direction,
        inActiveWsStream: details.inActiveWsStream,
      };

      if (snap && snap.price > 0) {
        stockSnapshots[sym] = {
          price: snap.price,
          dailyChange: snap.dailyChange,
          oneMinuteChange: snap.oneMinuteChange,
          fiveMinuteChange: snap.fiveMinuteChange,
          relativeVolume: snap.relativeVolume,
          score: snap.score,
          signal: snap.signal,
          freshness: snap.freshness,
          triggers: snap.triggers,
        };
      }
    }

    const article: NewsArticle = {
      id: rawId,
      headline,
      summary,
      author,
      source,
      url,
      createdAt,
      updatedAt: raw.updated_at,
      symbols,
      catalystType,
      catalystKeywords,
      reactions: Object.keys(reactions).length > 0 ? reactions : undefined,
      stockSnapshots: Object.keys(stockSnapshots).length > 0 ? stockSnapshots : undefined,
    };

    // Cache management
    this.articleIds.add(rawId);
    this.articles.unshift(article); // newest at front

    // Cap at 800 articles
    if (this.articles.length > 800) {
      const removed = this.articles.pop();
      if (removed) {
        this.articleIds.delete(removed.id);
        // Clean up alerted tracker for removed article
        for (const s of removed.symbols) {
          this.alertedNewsArticleIds.delete(`${s}:${removed.id}`);
        }
      }
    }

    this.lastArticleTime = createdAt;

    // Track symbol -> article mappings
    for (const sym of symbols) {
      const existing = this.symbolToArticleIds.get(sym) || [];
      existing.unshift(rawId);
      if (existing.length > 20) {
        existing.pop();
      }
      this.symbolToArticleIds.set(sym, existing);
    }

    // Check for News-driven Alerts
    if (emitLive) {
      this.checkAndEmitNewsAlert(article);
      // Emit through SSE
      this.emit({ type: 'news', article });
      this.emitNewsStatus();
    }

    return article;
  }

  private checkAndEmitNewsAlert(article: NewsArticle) {
    if (!article.symbols || article.symbols.length === 0) return;

    for (const sym of article.symbols) {
      const snap = this.getStockSnapshot(sym);
      this.checkMomentumAlert(article, sym, snap);
    }
  }

  private checkMomentumAlert(article: NewsArticle, symbol: string, snap: StockSnapshotForNews | null) {
    if (!snap || snap.price <= 0) return;
    const alertKey = `${symbol}:${article.id}`;
    if (this.alertedNewsArticleIds.has(alertKey)) return;

    const m1 = snap.oneMinuteChange;
    const m5 = snap.fiveMinuteChange;

    const isPositive =
      ((m1 !== null && m1 >= 1.0) || (m5 !== null && m5 >= 2.0)) &&
      (m1 === null || m1 > -0.5) &&
      (m5 === null || m5 > -0.5) &&
      snap.signal !== '⚪ STALE';

    const isSelling =
      (m5 !== null && m5 <= -1.0) ||
      (m1 !== null && m1 <= -1.0);

    if (isPositive) {
      this.alertedNewsArticleIds.add(alertKey);
      this.emit({
        type: 'alert',
        alertType: 'NEWS_MOMENTUM',
        title: '🚨 NEWS → MOMENTUM',
        symbol,
        headline: article.headline,
        articleId: article.id,
        m1: snap.oneMinuteChange,
        m5: snap.fiveMinuteChange,
        rvol: snap.relativeVolume,
        signal: snap.signal,
        price: snap.price,
        stock: {
          symbol,
          name: snap.name || '',
          price: snap.price,
          dailyChange: snap.dailyChange,
          oneMinuteChange: snap.oneMinuteChange,
          fiveMinuteChange: snap.fiveMinuteChange,
          relativeVolume: snap.relativeVolume,
          score: snap.score,
          signal: snap.signal,
          freshness: snap.freshness,
          triggers: snap.triggers,
        },
      });
    } else if (isSelling) {
      this.alertedNewsArticleIds.add(alertKey);
      this.emit({
        type: 'alert',
        alertType: 'NEWS_SELLING',
        title: '⚠️ NEWS → SELLING PRESSURE',
        symbol,
        headline: article.headline,
        articleId: article.id,
        m1: snap.oneMinuteChange,
        m5: snap.fiveMinuteChange,
        rvol: snap.relativeVolume,
        signal: snap.signal,
        price: snap.price,
        stock: {
          symbol,
          name: snap.name || '',
          price: snap.price,
          dailyChange: snap.dailyChange,
          oneMinuteChange: snap.oneMinuteChange,
          fiveMinuteChange: snap.fiveMinuteChange,
          relativeVolume: snap.relativeVolume,
          score: snap.score,
          signal: snap.signal,
          freshness: snap.freshness,
          triggers: snap.triggers,
        },
      });
    }
  }

  private updatePriceReactions() {
    const now = Date.now();
    let updatedAny = false;

    // Inspect articles from the last 30 minutes
    const recentArticles = this.articles.slice(0, 100);

    for (const art of recentArticles) {
      const newsTime = new Date(art.createdAt).getTime();
      const ageMs = now - newsTime;
      if (ageMs > 30 * 60 * 1000) continue;

      for (const sym of art.symbols) {
        const snap = this.getStockSnapshot(sym);
        if (!art.reactions) {
          art.reactions = {};
        }

        let rx = art.reactions[sym];
        if (!rx) {
          const priceAtNews = snap && snap.price > 0 ? snap.price : 0;
          const details = computeReactionDetails(priceAtNews, snap, ageMs);
          rx = {
            priceAtNews,
            newsTime,
            dataStatus: details.dataStatus,
            status: details.status,
            direction: details.direction,
            inActiveWsStream: details.inActiveWsStream,
          };
          art.reactions[sym] = rx;
          updatedAny = true;
        }

        // If priceAtNews was 0, attempt to backfill from snapshot or bar history
        if (rx.priceAtNews <= 0 && snap && snap.price > 0) {
          if (ageMs < 60000) {
            rx.priceAtNews = snap.price;
            updatedAny = true;
          } else if (snap.history && snap.history.length > 0) {
            const pt = findClosestHistoryPoint(snap.history, newsTime, 60000);
            if (pt && pt.p > 0) {
              rx.priceAtNews = pt.p;
              updatedAny = true;
            }
          }
        }

        const basePrice = rx.priceAtNews;
        if (basePrice > 0) {
          // 30 sec reaction (age >= 30s)
          if (ageMs >= 30000 && rx.reaction30s === undefined) {
            if (snap && snap.price > 0 && ageMs < 75000) {
              rx.reaction30s = Number((((snap.price - basePrice) / basePrice) * 100).toFixed(2));
              updatedAny = true;
            } else if (snap && snap.history && snap.history.length > 0) {
              const pt = findClosestHistoryPoint(snap.history, newsTime + 30000, 45000);
              if (pt && pt.p > 0) {
                rx.reaction30s = Number((((pt.p - basePrice) / basePrice) * 100).toFixed(2));
                updatedAny = true;
              } else if (ageMs > 90000) {
                rx.reaction30s = null;
                updatedAny = true;
              }
            } else if (ageMs > 90000) {
              rx.reaction30s = null;
              updatedAny = true;
            }
          }

          // 1 min reaction (age >= 60s)
          if (ageMs >= 60000 && rx.reaction1m === undefined) {
            if (snap && snap.price > 0 && ageMs < 120000) {
              rx.reaction1m = Number((((snap.price - basePrice) / basePrice) * 100).toFixed(2));
              updatedAny = true;
            } else if (snap && snap.history && snap.history.length > 0) {
              const pt = findClosestHistoryPoint(snap.history, newsTime + 60000, 60000);
              if (pt && pt.p > 0) {
                rx.reaction1m = Number((((pt.p - basePrice) / basePrice) * 100).toFixed(2));
                updatedAny = true;
              } else if (ageMs > 180000) {
                rx.reaction1m = null;
                updatedAny = true;
              }
            } else if (ageMs > 180000) {
              rx.reaction1m = null;
              updatedAny = true;
            }
          }

          // 5 min reaction (age >= 300s)
          if (ageMs >= 300000 && rx.reaction5m === undefined) {
            if (snap && snap.price > 0 && ageMs < 360000) {
              rx.reaction5m = Number((((snap.price - basePrice) / basePrice) * 100).toFixed(2));
              updatedAny = true;
            } else if (snap && snap.history && snap.history.length > 0) {
              const pt = findClosestHistoryPoint(snap.history, newsTime + 300000, 120000);
              if (pt && pt.p > 0) {
                rx.reaction5m = Number((((pt.p - basePrice) / basePrice) * 100).toFixed(2));
                updatedAny = true;
              } else if (ageMs > 420000) {
                rx.reaction5m = null;
                updatedAny = true;
              }
            } else if (ageMs > 420000) {
              rx.reaction5m = null;
              updatedAny = true;
            }
          }

          // 10 min reaction (age >= 600s)
          if (ageMs >= 600000 && rx.reaction10m === undefined) {
            if (snap && snap.price > 0 && ageMs < 660000) {
              rx.reaction10m = Number((((snap.price - basePrice) / basePrice) * 100).toFixed(2));
              updatedAny = true;
            } else if (snap && snap.history && snap.history.length > 0) {
              const pt = findClosestHistoryPoint(snap.history, newsTime + 600000, 150000);
              if (pt && pt.p > 0) {
                rx.reaction10m = Number((((pt.p - basePrice) / basePrice) * 100).toFixed(2));
                updatedAny = true;
              } else if (ageMs > 750000) {
                rx.reaction10m = null;
                updatedAny = true;
              }
            } else if (ageMs > 750000) {
              rx.reaction10m = null;
              updatedAny = true;
            }
          }
        }

        // Recompute status, direction, inActiveWsStream and dataStatus
        const details = computeReactionDetails(rx.priceAtNews, snap, ageMs, rx);
        rx.status = details.status;
        rx.direction = details.direction;
        rx.inActiveWsStream = details.inActiveWsStream;
        rx.dataStatus = details.dataStatus;

        // Check if momentum or selling pressure subsequently developed
        this.checkMomentumAlert(art, sym, snap);

        // Update snapshot on article if snap exists
        if (snap && snap.price > 0) {
          if (!art.stockSnapshots) art.stockSnapshots = {};
          art.stockSnapshots[sym] = {
            price: snap.price,
            dailyChange: snap.dailyChange,
            oneMinuteChange: snap.oneMinuteChange,
            fiveMinuteChange: snap.fiveMinuteChange,
            relativeVolume: snap.relativeVolume,
            score: snap.score,
            signal: snap.signal,
            freshness: snap.freshness,
            triggers: snap.triggers,
          };
        }
      }
    }

    if (updatedAny) {
      // Broadcast update of recent articles with revised reactions
      this.emit({ type: 'news_update', articles: this.articles.slice(0, 30) });
    }
  }

  public getArticles(limit = 100): NewsArticle[] {
    return this.articles.slice(0, limit);
  }

  public getRecentArticleCountForSymbol(symbol: string, maxAgeMinutes = 120): number {
    const ids = this.symbolToArticleIds.get(symbol.toUpperCase());
    if (!ids || ids.length === 0) return 0;

    const now = Date.now();
    let count = 0;
    for (const id of ids) {
      const art = this.articles.find((a) => a.id === id);
      if (art) {
        const ageMs = now - new Date(art.createdAt).getTime();
        if (ageMs <= maxAgeMinutes * 60 * 1000) {
          count++;
        }
      }
    }
    return count;
  }

  public getArticlesForSymbol(symbol: string, limit = 10): NewsArticle[] {
    const sym = symbol.toUpperCase();
    return this.articles.filter((a) => a.symbols.includes(sym)).slice(0, limit);
  }

  public hasRecentNews(symbol: string, maxAgeMinutes = 60): boolean {
    return this.getRecentArticleCountForSymbol(symbol, maxAgeMinutes) > 0;
  }

  public status(): NewsEngineStatus {
    return {
      connected: this.isConnected,
      totalArticles: this.articles.length,
      trackedSymbolsWithNews: this.symbolToArticleIds.size,
      lastArticleTime: this.lastArticleTime,
      error: this.lastError,
    };
  }

  private emitNewsStatus() {
    this.emit({ type: 'news_status', ...(this.status() || {}) });
  }
}
