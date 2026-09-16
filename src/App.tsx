import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Clock,
  Download,
  ExternalLink,
  Newspaper,
  Settings as SettingsIcon,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import './App.css';
import type { ScannerSettings, StockData, ScannerStatus } from './types/scanner';
import { DEFAULT_SETTINGS } from './types/scanner';
import type { NewsArticle, NewsEngineStatus } from './types/news';
import { SettingsPanel } from './components/SettingsPanel';
import { NewsPanel } from './components/NewsPanel';
import { StockDetailDrawer } from './components/StockDetailDrawer';
import { getMarketSession } from './market-session';

type Category = 'momentum' | 'news';

const pct = (x: number | null | undefined) => {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;
};

const money = (x: number | null | undefined) => {
  if (x === null || x === undefined || !Number.isFinite(x) || x <= 0) return '—';
  return `$${x < 1 ? x.toFixed(4) : x.toFixed(2)}`;
};

const compact = (x: number | null | undefined) => {
  if (!x || !Number.isFinite(x)) return '0';
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${Math.round(x / 1e3)}K`;
  return String(Math.round(x));
};

const getSignalClass = (signal?: string) => {
  if (!signal) return 'signal-watch';
  if (signal.includes('EXPLOSIVE')) return 'signal-explosive';
  if (signal.includes('STRONG')) return 'signal-strong';
  if (signal.includes('BUILDING')) return 'signal-building';
  if (signal.includes('STALE')) return 'signal-stale';
  return 'signal-watch';
};

const getFreshnessConfig = (freshness?: string) => {
  if (freshness === 'LIVE') {
    return { label: 'LIVE', icon: '●', className: 'freshness-live', title: 'Live WebSocket trade/bar updates' };
  }
  if (freshness === 'SEEDED') {
    return { label: 'REST', icon: '◐', className: 'freshness-seeded', title: 'REST snapshot / historical data fallback' };
  }
  return { label: 'STALE', icon: '○', className: 'freshness-stale', title: 'Data older than the active freshness window' };
};

const getTriggerClass = (trigger: string) => {
  if (trigger.includes('NEWS')) return 'trigger-news';
  if (trigger.includes('SURGE')) return 'trigger-surge';
  if (trigger.includes('HIGH') || trigger.includes('BREAKOUT')) return 'trigger-breakout';
  if (trigger.includes('RVOL') || trigger.includes('VOLUME')) return 'trigger-vol';
  if (trigger.includes('RUNNER') || trigger.includes('DAILY')) return 'trigger-runner';
  return '';
};

const trading212Url = (symbol: string) => `https://www.trading212.com/trading-instruments/invest/${encodeURIComponent(symbol.toUpperCase())}.US`;

export default function App() {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [status, setStatus] = useState<ScannerStatus>({
    connected: false,
    marketOpen: false,
    feed: 'iex',
    universeSize: 0,
    stocksTracked: 0,
    monitoredSymbols: 0,
    scanProgress: { processed: 0, received: 0, universeSize: 0, scanning: false },
    alertCount: 0,
  });
  const [settings, setSettings] = useState<ScannerSettings>(DEFAULT_SETTINGS);
  const [cat, setCat] = useState<Category>('momentum');
  const [showSettings, setShowSettings] = useState(false);
  const [selectedStockSymbol, setSelectedStockSymbol] = useState<string | null>(null);
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [newsStatus, setNewsStatus] = useState<NewsEngineStatus>({
    connected: false,
    totalArticles: 0,
    trackedSymbolsWithNews: 0,
    lastArticleTime: null,
  });
  const [ukTime, setUkTime] = useState('');
  const [etTime, setEtTime] = useState('');
  const [lastRestUpdate, setLastRestUpdate] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const fmt = (timeZone: string) =>
        now.toLocaleTimeString('en-GB', {
          timeZone,
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
      setUkTime(`${fmt('Europe/London')} UK`);
      setEtTime(`${fmt('America/New_York')} ET`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const sessionInfo = useMemo(
    () => status.sessionInfo || getMarketSession(new Date(), undefined, status.activeFeed || status.feed),
    [status.sessionInfo, status.activeFeed, status.feed]
  );

  const restFallbackActive = !status.connected && stocks.length > 0 && status.stocksTracked > 0;

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === 'object') {
          setStatus((prev) => ({ ...prev, ...data }));
          if (data.settings) setSettings(data.settings);
        }
      })
      .catch(() => {});

    fetch('/api/stocks')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.stocks)) {
          setStocks(data.stocks);
          if (data.stocks.length) setLastRestUpdate(new Date());
        }
      })
      .catch(() => {});

    const stream = new EventSource('/api/stream');
    stream.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'stocks') {
          setStocks(msg.stocks || []);
          setLastRestUpdate(new Date());
          setStatus((prev) => ({
            ...prev,
            universeSize: msg.universeSize ?? prev.universeSize,
            stocksTracked: msg.stocksTracked ?? prev.stocksTracked,
          }));
        } else if (msg.type === 'connection_status') {
          setStatus((prev) => ({ ...prev, ...msg }));
          if (msg.settings) setSettings(msg.settings);
        } else if (msg.type === 'scanProgress') {
          setStatus((prev) => ({
            ...prev,
            scanProgress: msg.data,
            universeSize: msg.data?.universeSize || prev.universeSize,
          }));
        } else if (msg.type === 'stockUpdate' && msg.stock) {
          setStocks((prev) => {
            const idx = prev.findIndex((s) => s.symbol === msg.stock.symbol);
            if (idx < 0) return prev;
            const next = [...prev];
            next[idx] = msg.stock;
            return next;
          });
          setLastRestUpdate(new Date());
        } else if (msg.type === 'news_init') {
          setNewsArticles(msg.articles || []);
        } else if (msg.type === 'news_article' && msg.article) {
          setNewsArticles((prev) => prev.some((a) => a.id === msg.article.id) ? prev : [msg.article, ...prev.slice(0, 799)]);
        } else if (msg.type === 'news_status') {
          setNewsStatus((prev) => ({ ...prev, ...msg }));
        } else if (msg.type === 'news_reaction_update') {
          setNewsArticles((prev) => prev.map((article) =>
            article.id !== msg.articleId ? article : {
              ...article,
              reactions: {
                ...(article.reactions || {}),
                [msg.symbol]: msg.reaction,
              },
            }
          ));
        }
      } catch {}
    };

    return () => stream.close();
  }, []);

  const handleApplySettings = (newSettings: Partial<ScannerSettings>) => {
    const merged = { ...settings, ...newSettings };
    setSettings(merged);
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings),
    }).catch(() => {});
  };

  const rows = useMemo(() => {
    const candidates = stocks.filter((s) => {
      if (!Number.isFinite(s.dailyChange ?? NaN) || (s.dailyChange ?? 0) <= 0) return false;
      if (s.volume < settings.minVolume || s.dollarVolume < settings.minDollarVolume) return false;
      if (s.price < settings.minPrice || s.price > settings.maxPrice) return false;
      if (s.score <= 0) return false;
      return true;
    });

    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const b5 = b.fiveMinuteChange ?? -999;
      const a5 = a.fiveMinuteChange ?? -999;
      if (b5 !== a5) return b5 - a5;
      const b1 = b.oneMinuteChange ?? -999;
      const a1 = a.oneMinuteChange ?? -999;
      if (b1 !== a1) return b1 - a1;
      return (b.dailyChange ?? 0) - (a.dailyChange ?? 0);
    });

    return candidates.slice(0, 7);
  }, [stocks, settings]);

  const selectedStock = useMemo(
    () => stocks.find((s) => s.symbol === selectedStockSymbol) || null,
    [stocks, selectedStockSymbol]
  );

  const selectedNews = useMemo(() => {
    if (!selectedStockSymbol) return [];
    return newsArticles.filter((article) => article.symbols?.some((s) => s.toUpperCase() === selectedStockSymbol.toUpperCase()));
  }, [newsArticles, selectedStockSymbol]);

  const exportCSV = () => {
    const header = 'Rank,Symbol,Price,DailyChangePct,5mChangePct,1mChangePct,RVOL,Volume,DollarVolume,DayHigh,Score,Triggers\n';
    const body = rows.map((s, i) => `${i + 1},${s.symbol},${s.price},${s.dailyChange ?? ''},${s.fiveMinuteChange ?? ''},${s.oneMinuteChange ?? ''},${s.relativeVolume ?? ''},${s.volume},${s.dollarVolume},${s.dayHigh},${s.score},"${s.triggers.join('; ')}"`).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jfire_top7_momentum_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const openStock = (symbol: string) => setSelectedStockSymbol(symbol);
  const openTrading212 = (symbol: string) => window.open(trading212Url(symbol), '_blank', 'noopener,noreferrer');

  return (
    <div className="app" id="app-container">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-line"><span className="brand-mark">JF</span><b>JFIRE MOMENTUM</b></div>
          <small>TOP 7 US EQUITY MOMENTUM SCANNER</small>
        </div>

        <div className="clocks">
          <div className="clock-card uk-clock"><Clock size={14} /><div><span>YOUR TIMEZONE</span><b>{ukTime || '—'}</b></div></div>
          <div className="clock-card"><Clock size={14} /><div><span>NEW YORK</span><b>{etTime || '—'}</b></div></div>
        </div>

        <div className="market-state">
          <span className={`market-dot ${sessionInfo.session === 'REGULAR' ? 'green' : 'amber'}`}>●</span>
          <div><b>{sessionInfo.displayStatus}</b><small>{sessionInfo.sessionBadge} · {sessionInfo.feedBadge}</small></div>
        </div>
      </header>

      <main>
        <section className="hero-bar">
          <div>
            <div className="hero-title"><Zap size={18} /> Momentum Leaders</div>
            <div className="hero-subtitle">Only the 7 strongest stocks currently moving UP with momentum are shown.</div>
          </div>
          <div className="toolbar-actions">
            <button onClick={() => setCat('momentum')} className={cat === 'momentum' ? 'active' : ''}><Activity size={13} /> Top 7 Momentum</button>
            <button onClick={() => setCat('news')} className={cat === 'news' ? 'active' : ''}><Newspaper size={13} /> Live News</button>
            <button onClick={() => setShowSettings(true)}><SettingsIcon size={13} /> Settings</button>
            <button onClick={exportCSV}><Download size={13} /> Export 7</button>
          </div>
        </section>

        <section className="status-strip">
          <div className={`data-mode ${status.connected ? 'live' : restFallbackActive ? 'rest' : 'offline'}`}>
            {status.connected ? <Wifi size={13} /> : restFallbackActive ? <Activity size={13} /> : <WifiOff size={13} />}
            <b>{status.connected ? 'LIVE — IEX WEBSOCKET' : restFallbackActive ? 'LIVE — REST SNAPSHOT' : 'OFFLINE'}</b>
          </div>
          <span>{status.universeSize.toLocaleString()} common stocks</span>
          <span>{status.stocksTracked.toLocaleString()} tracked</span>
          <span>{rows.length}/7 momentum leaders</span>
          <span>{lastRestUpdate ? `Last update ${lastRestUpdate.toLocaleTimeString('en-GB', { hour12: false })} UK` : 'Waiting for data'}</span>
          <span className="status-next">Next: {sessionInfo.nextTransition.targetBadge} {sessionInfo.nextTransition.countdownFormatted}</span>
        </section>

        {cat === 'news' ? (
          <NewsPanel
            articles={newsArticles}
            newsStatus={newsStatus}
            stocks={stocks}
            onSelectStock={openStock}
            getSignalClass={getSignalClass}
            getFreshnessConfig={getFreshnessConfig}
          />
        ) : (
          <section className="leaderboard">
            <div className="leaderboard-head">
              <div><b>TOP 7 MOMENTUM</b><span>Real market data · positive daily momentum · liquidity filtered</span></div>
              <span className="leader-count">{rows.length} / 7</span>
            </div>

            {rows.length === 0 ? (
              <div className="empty-state"><Activity size={28} /><b>Waiting for upward momentum</b><span>REST snapshots are active. The leaderboard will populate when qualifying positive-momentum stocks are available.</span></div>
            ) : (
              <div className="leader-list">
                {rows.map((s, index) => {
                  const fresh = getFreshnessConfig(s.freshness);
                  const positive5 = s.fiveMinuteChange !== null && s.fiveMinuteChange !== undefined && s.fiveMinuteChange > 0;
                  const positive1 = s.oneMinuteChange !== null && s.oneMinuteChange !== undefined && s.oneMinuteChange > 0;
                  return (
                    <article className={`stock-card rank-${index + 1}`} key={s.symbol} onClick={() => openStock(s.symbol)}>
                      <div className="rank">#{index + 1}</div>
                      <div className="stock-main">
                        <div className="ticker-line">
                          <strong>{s.symbol}</strong>
                          <span className={`signal-badge ${getSignalClass(s.signal)}`}>{s.signal || 'MOMENTUM'}</span>
                          <span className={`freshness-badge ${fresh.className}`}>{fresh.icon} {fresh.label}</span>
                        </div>
                        <span className="stock-name">{s.name || 'US common stock'}</span>
                        <div className="trigger-row">
                          {s.triggers.slice(0, 4).map((t) => <span key={t} className={`trigger-tag ${getTriggerClass(t)}`}>{t}</span>)}
                          {s.newsCount ? <span className="news-pill"><Newspaper size={9} /> {s.newsCount} news</span> : null}
                        </div>
                      </div>
                      <div className="metric price-metric"><span>PRICE</span><b>{money(s.price)}</b></div>
                      <div className="metric"><span>DAY</span><b className="positive">{pct(s.dailyChange)}</b></div>
                      <div className="metric"><span>5M</span><b className={positive5 ? 'positive' : 'muted'}>{pct(s.fiveMinuteChange)}</b></div>
                      <div className="metric"><span>1M</span><b className={positive1 ? 'positive' : 'muted'}>{pct(s.oneMinuteChange)}</b></div>
                      <div className="metric"><span>RVOL</span><b>{s.relativeVolume ? `${s.relativeVolume.toFixed(2)}x` : '—'}</b></div>
                      <div className="metric"><span>SCORE</span><b className="score">{s.score}</b></div>
                      <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                        <button className="news-button" onClick={() => openStock(s.symbol)} title="Open stock details and news"><Newspaper size={13} /> News</button>
                        <button className="trade-button" onClick={() => openTrading212(s.symbol)} title="Open this stock in Trading 212"><ArrowUpRight size={13} /> Trading 212</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <div className="footer-note">
          <span>Real market data only — no demo stocks.</span>
          <span>Signal scanner only — Trading 212 opens for manual review/order placement.</span>
          <a href="https://www.trading212.com/" target="_blank" rel="noopener noreferrer">Trading 212 ↗</a>
        </div>
      </main>

      <SettingsPanel settings={settings} onApply={handleApplySettings} isOpen={showSettings} onClose={() => setShowSettings(false)} />

      <StockDetailDrawer
        symbol={selectedStockSymbol}
        onClose={() => setSelectedStockSymbol(null)}
        stock={selectedStock}
        newsArticles={selectedNews}
        getSignalClass={getSignalClass}
        getFreshnessConfig={getFreshnessConfig}
        getTriggerClass={getTriggerClass}
      />
    </div>
  );
}
