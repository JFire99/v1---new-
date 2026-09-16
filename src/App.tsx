import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  Clock,
  Download,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Wifi,
  WifiOff,
} from 'lucide-react';
import './App.css';
import type { ScannerSettings, StockData, ScannerStatus } from './types/scanner';
import { DEFAULT_SETTINGS } from './types/scanner';
import type { NewsArticle, NewsEngineStatus } from './types/news';
import { SettingsPanel } from './components/SettingsPanel';
import { NewsPanel } from './components/NewsPanel';
import { StockDetailDrawer } from './components/StockDetailDrawer';
import { getMarketSession } from './market-session';

type Category = 'momentum' | 'gainers' | 'rvol' | 'breakouts' | 'news';

const pct = (x: number | null | undefined) => {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;
};

const rvolFormat = (x: number | null | undefined) => {
  if (x === null || x === undefined || !Number.isFinite(x) || x <= 0) return '—';
  return `${x.toFixed(2)}x`;
};

const money = (x: number | null | undefined) => {
  if (x === null || x === undefined || !Number.isFinite(x) || x <= 0) return '—';
  return `$${x < 1 ? x.toFixed(4) : x.toFixed(2)}`;
};

const volumeFormat = (x: number | null | undefined) => {
  if (!x || !Number.isFinite(x) || x <= 0) return '0';
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(0)}K`;
  return String(Math.round(x));
};

const dollarVolFormat = (x: number | null | undefined) => {
  if (!x || !Number.isFinite(x) || x <= 0) return '$0';
  if (x >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `$${(x / 1e3).toFixed(0)}K`;
  return `$${Math.round(x)}`;
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
    return { label: 'LIVE', icon: '●', className: 'freshness-live', title: 'Live WebSocket trade/bar updates within last 90s' };
  }
  if (freshness === 'SEEDED') {
    return { label: 'SEEDED', icon: '◐', className: 'freshness-seeded', title: 'Momentum from REST historical 1Min bars / snapshot' };
  }
  return { label: 'STALE', icon: '○', className: 'freshness-stale', title: 'Momentum data older than 10m or missing' };
};

const getTriggerClass = (trigger: string) => {
  if (trigger.includes('NEWS + MOMENTUM')) return 'trigger-news-momentum';
  if (trigger.includes('NEWS')) return 'trigger-news';
  if (trigger.includes('SURGE')) return 'trigger-surge';
  if (trigger.includes('HIGH') || trigger.includes('BREAKOUT')) return 'trigger-breakout';
  if (trigger.includes('RVOL') || trigger.includes('VOLUME')) return 'trigger-vol';
  if (trigger.includes('RUNNER') || trigger.includes('DAILY')) return 'trigger-runner';
  return '';
};

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'momentum', label: 'Top Momentum' },
  { id: 'gainers', label: 'Top Gainers' },
  { id: 'rvol', label: 'Top RVOL' },
  { id: 'breakouts', label: 'Breakouts' },
  { id: 'news', label: '📰 Live News' },
];

const TABLE_HEADERS = [
  'STOCK',
  'SIGNAL',
  'PRICE',
  'DAILY %',
  '5M %',
  '1M %',
  'RVOL',
  'VOLUME',
  'DOLLAR VOL',
  'DAY HIGH',
  'FROM HIGH',
  'SCORE',
  'TRIGGERS',
];

export default function App() {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [status, setStatus] = useState<ScannerStatus>({
    connected: false,
    marketOpen: false,
    feed: 'iex',
    universeSize: 0,
    stocksTracked: 0,
    monitoredSymbols: 0,
    scanProgress: {
      processed: 0,
      received: 0,
      universeSize: 0,
      scanning: false,
    },
    alertCount: 0,
  });

  const [settings, setSettings] = useState<ScannerSettings>(DEFAULT_SETTINGS);
  const [cat, setCat] = useState<Category>('momentum');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentEtTime, setCurrentEtTime] = useState<string>('');

  // News State
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [newsStatus, setNewsStatus] = useState<NewsEngineStatus>({
    connected: false,
    articleCount: 0,
  });
  const [selectedStockSymbol, setSelectedStockSymbol] = useState<string | null>(null);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      setCurrentEtTime(`${timeStr} ET`);
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const sessionInfo = useMemo(() => {
    if (status.sessionInfo) return status.sessionInfo;
    return getMarketSession(new Date(), undefined, status.activeFeed || status.feed);
  }, [status.sessionInfo, status.activeFeed, status.feed]);

  useEffect(() => {
    // Initial fetch of stocks and status
    fetch('/api/status')
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data.connected === 'boolean') {
          setStatus((prev) => ({ ...prev, ...data }));
          if (data.settings) setSettings(data.settings);
        }
      })
      .catch(() => {});

    fetch('/api/stocks')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.stocks)) {
          setStocks(data.stocks);
        }
      })
      .catch(() => {});

    // SSE Stream
    const e = new EventSource('/api/stream');

    e.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'stocks') {
          setStocks(msg.stocks || []);
          if (msg.universeSize || msg.stocksTracked) {
            setStatus((prev) => ({
              ...prev,
              universeSize: msg.universeSize ?? prev.universeSize,
              stocksTracked: msg.stocksTracked ?? prev.stocksTracked,
            }));
          }
        } else if (msg.type === 'connection_status') {
          setStatus((prev) => ({ ...prev, ...msg }));
          if (msg.settings) setSettings(msg.settings);
        } else if (msg.type === 'scanProgress') {
          setStatus((prev) => ({
            ...prev,
            scanProgress: msg.data,
            universeSize: msg.data.universeSize || prev.universeSize,
          }));
        } else if (msg.type === 'stockUpdate' && msg.stock) {
          setStocks((prev) => {
            const idx = prev.findIndex((s) => s.symbol === msg.stock.symbol);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = msg.stock;
              return updated;
            }
            return prev;
          });
        } else if (msg.type === 'news_init') {
          setNewsArticles(msg.articles || []);
        } else if (msg.type === 'news_article' && msg.article) {
          setNewsArticles((prev) => {
            if (prev.some((a) => a.id === msg.article.id)) return prev;
            return [msg.article, ...prev.slice(0, 799)];
          });
        } else if (msg.type === 'news_status') {
          setNewsStatus((prev) => ({ ...prev, ...msg }));
        } else if (msg.type === 'news_reaction_update') {
          setNewsArticles((prev) => {
            const idx = prev.findIndex((a) => a.id === msg.articleId);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                reactions: {
                  ...(updated[idx].reactions || {}),
                  [msg.symbol]: msg.reaction,
                },
              };
              return updated;
            }
            return prev;
          });
        }
      } catch {}
    };

    return () => {
      e.close();
    };
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
    const filtered = stocks.filter((s) => {
      // 1. Ticker search
      if (q && !s.symbol.toUpperCase().includes(q.toUpperCase())) {
        return false;
      }

      // 2. Reject stocks missing valid daily change (no valid regular-session close)
      if (s.dailyChange === null || !Number.isFinite(s.dailyChange)) {
        return false;
      }

      // 3. Liquidity filter (min volume and min dollar volume)
      if (s.volume < settings.minVolume || s.dollarVolume < settings.minDollarVolume) {
        return false;
      }

      // 4. Price filter
      if (s.price < settings.minPrice || s.price > settings.maxPrice) {
        return false;
      }

      // 5. Active filter toggles
      if (filters) {
        if (settings.minDailyChangePct > 0 && s.dailyChange < settings.minDailyChangePct) {
          return false;
        }
        if (settings.minMomentumScore > 0 && s.score < settings.minMomentumScore) {
          return false;
        }
      }

      return true;
    });

    if (cat === 'gainers') {
      filtered.sort((a, b) => (b.dailyChange ?? -999) - (a.dailyChange ?? -999));
    } else if (cat === 'rvol') {
      filtered.sort((a, b) => (b.relativeVolume ?? -999) - (a.relativeVolume ?? -999));
    } else if (cat === 'breakouts') {
      filtered.sort((a, b) => {
        const aDist = a.distanceFromHigh ?? 999;
        const bDist = b.distanceFromHigh ?? 999;
        if (Math.abs(aDist - bDist) > 0.5) return aDist - bDist;
        return (b.fiveMinuteChange ?? -999) - (a.fiveMinuteChange ?? -999);
      });
    } else {
      // Top Momentum: strict momentum score prioritization, then 5m and 1m momentum
      filtered.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const b5 = b.fiveMinuteChange ?? -999;
        const a5 = a.fiveMinuteChange ?? -999;
        if (b5 !== a5) return b5 - a5;
        const b1 = b.oneMinuteChange ?? -999;
        const a1 = a.oneMinuteChange ?? -999;
        if (b1 !== a1) return b1 - a1;
        return (b.dailyChange ?? 0) - (a.dailyChange ?? 0);
      });
    }

    return filtered.slice(0, 100);
  }, [stocks, q, filters, cat, settings]);

  const exportCSV = () => {
    const csvHeader =
      'Symbol,Signal,Freshness,Price,DailyChangePct,5mChangePct,1mChangePct,RVOL,VolAccel,Volume,DollarVolume,DayHigh,DistanceFromHigh,Score,Triggers\n';
    const csvRows = rows
      .map(
        (s) =>
          `${s.symbol},"${s.signal || ''}","${s.freshness || 'STALE'}",${s.price},${s.dailyChange ?? ''},${s.fiveMinuteChange ?? ''},${
            s.oneMinuteChange ?? ''
          },${s.relativeVolume ?? ''},${s.volumeAcceleration ?? ''},${s.volume},${s.dollarVolume},${s.dayHigh},${
            s.distanceFromHigh ?? ''
          },${s.score},"${s.triggers.join('; ')}"`
      )
      .join('\n');

    const blob = new Blob([csvHeader + csvRows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `jfire_momentum_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <div className="app" id="app-container">
      <header id="app-header">
        <div>
          <b>JFIRE MOMENTUM</b>
          <small>REAL-TIME US EQUITY SCANNER (COMMON STOCKS ONLY)</small>
        </div>

        <div className="session-status-container" id="session-status-container">
          <div className="session-main-badge" id="session-main-badge">
            <span
              className={`session-dot-indicator ${
                sessionInfo.session === 'REGULAR'
                  ? 'status-regular'
                  : sessionInfo.session === 'PRE_MARKET'
                  ? 'status-pre'
                  : sessionInfo.session === 'AFTER_HOURS'
                  ? 'status-post'
                  : sessionInfo.session === 'OVERNIGHT'
                  ? 'status-overnight'
                  : 'status-closed'
              }`}
            >
              ● {sessionInfo.displayStatus}
            </span>
          </div>

          <div className="session-badges-group" id="session-badges-group">
            <span
              className={`session-pill pill-${sessionInfo.session.toLowerCase().replace('_', '-')}`}
              id="session-badge-pill"
              title={`Market Session: ${sessionInfo.sessionBadge}`}
            >
              {sessionInfo.sessionBadge}
            </span>

            <span
              className={`feed-pill ${status.connected ? 'pill-connected' : 'pill-offline'}`}
              id="feed-badge-pill"
              title={sessionInfo.feedDescription}
            >
              {sessionInfo.feedBadge}
            </span>
          </div>

          <div className="clock-timing-details" id="market-clock-timing">
            <span className="et-clock" title="Current Eastern Time">
              <Clock size={11} /> {currentEtTime || sessionInfo.currentEtTime}
            </span>
            <span className="next-transition" title="Next Session Transition">
              Next: <b>{sessionInfo.nextTransition.targetBadge}</b>{' '}
              {sessionInfo.nextTransition.countdownFormatted} ({sessionInfo.nextTransition.targetTimeEt})
            </span>
          </div>
        </div>

        <div className="feed-status-wrapper" id="feed-status-wrapper">
          <span
            className={`feed-live-indicator ${status.connected ? 'green' : 'muted'}`}
            title={`Alpaca Feed: ${sessionInfo.feedDescription}`}
          >
            {status.connected ? <Wifi size={13} /> : <WifiOff size={13} />}{' '}
            {status.connected ? 'FEED CONNECTED' : 'OFFLINE'}
          </span>
        </div>
      </header>

      <main id="app-main">
        <section className="bar" id="scanner-toolbar">
          <div>
            <h2>
              <Activity size={17} /> Momentum Scanner
            </h2>
            <nav id="category-nav">
              {CATEGORIES.map((c) => {
                const isNews = c.id === 'news';
                const breakingCount = isNews
                  ? newsArticles.filter(
                      (a) => Date.now() - new Date(a.createdAt).getTime() < 300000
                    ).length
                  : 0;

                return (
                  <button
                    key={c.id}
                    id={`btn-cat-${c.id}`}
                    className={cat === c.id ? 'on' : ''}
                    onClick={() => setCat(c.id)}
                  >
                    {c.label}
                    {isNews && breakingCount > 0 && (
                      <span
                        style={{
                          marginLeft: '6px',
                          background: '#ef4444',
                          color: '#fff',
                          padding: '1px 5px',
                          borderRadius: '10px',
                          fontSize: '8px',
                          fontWeight: 800,
                        }}
                      >
                        {breakingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="actions" id="scanner-actions">
            <label id="search-box">
              <Search size={14} />
              <input
                id="search-input"
                placeholder="Ticker"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
            <button
              id="filter-toggle"
              className={filters ? 'on' : ''}
              onClick={() => setFilters(!filters)}
            >
              Filters {filters ? 'ON' : 'OFF'}
            </button>
            <button
              id="settings-modal-btn"
              onClick={() => setShowSettings(true)}
              title="Configure Liquidity & Price Thresholds"
            >
              <SlidersHorizontal size={14} /> Settings
            </button>
            <button id="export-csv-btn" onClick={exportCSV}>
              <Download size={14} /> Export
            </button>
            <button
              id="refresh-btn"
              title="Refresh"
              onClick={() => location.reload()}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </section>

        <section className="stats" id="stats-summary">
          <div>
            <b>{(status.universeSize || 0).toLocaleString()}</b>
            <small>COMMON STOCKS</small>
          </div>
          <div>
            <b>{(status.stocksTracked || 0).toLocaleString()}</b>
            <small>TRACKED</small>
          </div>
          <div>
            <b>{rows.length}</b>
            <small>QUALIFIED (LIQUID)</small>
          </div>
          <div>
            <b>{rows[0]?.dailyChange !== null && rows[0]?.dailyChange !== undefined ? pct(rows[0].dailyChange) : '—'}</b>
            <small>TOP MOVE</small>
          </div>
          <div>
            <b>{rows[0]?.relativeVolume !== null && rows[0]?.relativeVolume !== undefined ? rvolFormat(rows[0].relativeVolume) : '—'}</b>
            <small>TOP RVOL</small>
          </div>
          <div>
            <b>{rows[0]?.score ?? 0}</b>
            <small>TOP SCORE</small>
          </div>
        </section>

        <div className="scan" id="scan-progress-bar">
          {status.scanProgress?.scanning ? (
            <>
              <RefreshCw className="spin" size={12} /> SCANNING{' '}
              {(status.scanProgress.processed || 0).toLocaleString()} /{' '}
              {(status.scanProgress.universeSize || 0).toLocaleString()} US Common Stocks
            </>
          ) : (
            <>● Scanner ready ({(status.universeSize || 0).toLocaleString()} Common Stocks loaded)</>
          )}
          <span>
            Live monitoring {status.monitoredSymbols || 0} {sessionInfo.feedBadge} WebSocket streams
          </span>
        </div>

        {cat === 'news' ? (
          <NewsPanel
            articles={newsArticles}
            newsStatus={newsStatus}
            stocks={stocks}
            onSelectStock={(sym) => setSelectedStockSymbol(sym)}
            getSignalClass={getSignalClass}
            getFreshnessConfig={getFreshnessConfig}
          />
        ) : (
          <section className="table" id="scanner-table-section">
            <div className="title">
              <b>
                {cat === 'momentum'
                  ? 'TOP MOMENTUM'
                  : cat === 'gainers'
                  ? 'TOP GAINERS'
                  : cat === 'rvol'
                  ? 'TOP RELATIVE VOLUME'
                  : 'BREAKOUT WATCHLIST'}
              </b>
              <small>
                {rows.length} stocks meeting min volume ({settings.minVolume.toLocaleString()}) & min $vol (${settings.minDollarVolume.toLocaleString()})
              </small>
            </div>
            <div className="scroll">
              <table id="scanner-results-table">
                <thead>
                  <tr>
                    {TABLE_HEADERS.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, i) => (
                    <tr key={s.symbol} id={`stock-row-${s.symbol}`}>
                      <td style={{ cursor: 'pointer' }} onClick={() => setSelectedStockSymbol(s.symbol)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <b title={s.name || s.symbol}>
                            #{i + 1} {s.symbol}
                          </b>
                          {s.hasRecentNews && (
                            <span
                              className="news-count-pill"
                              title={`${s.newsCount || 1} recent news article(s) detected`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedStockSymbol(s.symbol);
                              }}
                            >
                              📰 {s.newsCount || ''}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                          <span className={`signal-badge ${getSignalClass(s.signal)}`}>
                            {s.signal || '👀 WATCH'}
                          </span>
                          {(() => {
                            const fc = getFreshnessConfig(s.freshness);
                            return (
                              <span className={`freshness-badge ${fc.className}`} title={fc.title}>
                                <span className="freshness-dot">{fc.icon}</span> {fc.label}
                              </span>
                            );
                          })()}
                        </div>
                      </td>
                      <td>{money(s.price)}</td>
                      <td
                        className={
                          s.dailyChange === null
                            ? 'muted'
                            : s.dailyChange > 0
                            ? 'green'
                            : s.dailyChange < 0
                            ? 'red'
                            : ''
                        }
                      >
                        {pct(s.dailyChange)}
                      </td>
                      <td
                        className={
                          s.fiveMinuteChange === null
                            ? 'muted'
                            : s.fiveMinuteChange > 0
                            ? 'green'
                            : s.fiveMinuteChange < 0
                            ? 'red'
                            : ''
                        }
                      >
                        {pct(s.fiveMinuteChange)}
                      </td>
                      <td
                        className={
                          s.oneMinuteChange === null
                            ? 'muted'
                            : s.oneMinuteChange > 0
                            ? 'green'
                            : s.oneMinuteChange < 0
                            ? 'red'
                            : ''
                        }
                      >
                        {pct(s.oneMinuteChange)}
                      </td>
                      <td
                        className={
                          s.relativeVolume === null
                            ? 'muted'
                            : s.relativeVolume >= 2
                            ? 'green'
                            : ''
                        }
                      >
                        {rvolFormat(s.relativeVolume)}
                      </td>
                      <td>{volumeFormat(s.volume)}</td>
                      <td>{dollarVolFormat(s.dollarVolume)}</td>
                      <td>{money(s.dayHigh)}</td>
                      <td>
                        {s.distanceFromHigh === null
                          ? '—'
                          : s.distanceFromHigh < 0.05
                          ? 'NEW HIGH'
                          : `-${s.distanceFromHigh.toFixed(2)}%`}
                      </td>
                      <td>
                        <strong className={`score-badge ${s.score >= 70 ? 'score-hot' : s.score >= 50 ? 'score-warm' : ''}`}>
                          {s.score}
                        </strong>
                      </td>
                      <td>
                        <div className="triggers-container">
                          {s.triggers.map((trigger) => (
                            <em key={trigger} className={`trigger-tag ${getTriggerClass(trigger)}`}>
                              {trigger}
                            </em>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={13} className="empty">
                        <Activity /> Scanning Alpaca market data...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="news" id="scanner-info-notice">
          <Bell size={14} /> Real market data only — no demo stocks. Security universe filtered strictly to genuine US common stocks. Liquidity threshold: {settings.minVolume.toLocaleString()} shares & ${settings.minDollarVolume.toLocaleString()} dollar volume.
        </section>
      </main>

      <SettingsPanel
        settings={settings}
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onApply={handleApplySettings}
      />

      <StockDetailDrawer
        symbol={selectedStockSymbol}
        onClose={() => setSelectedStockSymbol(null)}
        stock={selectedStockSymbol ? stocks.find((s) => s.symbol === selectedStockSymbol) || null : null}
        newsArticles={
          selectedStockSymbol
            ? newsArticles.filter((a) =>
                a.symbols?.some((s) => s.toUpperCase() === selectedStockSymbol.toUpperCase())
              )
            : []
        }
        getSignalClass={getSignalClass}
        getFreshnessConfig={getFreshnessConfig}
        getTriggerClass={getTriggerClass}
      />
    </div>
  );
}
