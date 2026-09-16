import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Clock,
  Filter,
  Newspaper,
  Search,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import './App.css';
import type { ScannerSettings, StockData, ScannerStatus } from './types/scanner';
import { DEFAULT_SETTINGS } from './types/scanner';
import type { NewsArticle, NewsEngineStatus } from './types/news';
import { NewsPanel } from './components/NewsPanel';
import { StockDetailDrawer } from './components/StockDetailDrawer';
import { getMarketSession } from './market-session';

type Category = 'momentum' | 'news';

type FilterState = {
  search: string;
  minPrice: number;
  maxPrice: number;
  minVolume: number;
  maxVolume: number | null;
  minDaily: number;
  min5m: number;
  min1m: number;
  minRvol: number;
  minScore: number;
};

const pct = (x: number | null | undefined) => {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  return `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;
};

const money = (x: number | null | undefined) => {
  if (x === null || x === undefined || !Number.isFinite(x) || x <= 0) return '—';
  return `$${x < 1 ? x.toFixed(4) : x.toFixed(2)}`;
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

const defaultFilters = (settings: ScannerSettings): FilterState => ({
  search: '',
  minPrice: settings.minPrice,
  maxPrice: settings.maxPrice,
  minVolume: settings.minVolume,
  maxVolume: null,
  minDaily: 0,
  min5m: 0,
  min1m: 0,
  minRvol: 0,
  minScore: 0,
});

const inputNumber = (value: string, fallback: number | null) => {
  if (value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const activeMomentumRank = (stock: StockData) => {
  const one = Math.max(stock.oneMinuteChange ?? 0, 0);
  const five = Math.max(stock.fiveMinuteChange ?? 0, 0);
  const rvol = Math.max(stock.relativeVolume ?? 0, 0);
  const daily = Math.min(Math.max(stock.dailyChange ?? 0, 0), 50);
  const volumeAcceleration = Math.min(Math.max(stock.volumeAcceleration ?? 0, 0), 20);
  const triggerBonus = stock.triggers.reduce((bonus, trigger) => {
    if (/SURGE|BREAKOUT|HIGH/i.test(trigger)) return bonus + 4;
    if (/RVOL|VOLUME/i.test(trigger)) return bonus + 2;
    return bonus;
  }, 0);

  // Short-term movement is deliberately weighted much more heavily than the daily move.
  return one * 8 + five * 5 + Math.min(rvol, 20) * 0.75 + volumeAcceleration * 0.5 + daily * 0.15 + triggerBonus;
};

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
  const [filters, setFilters] = useState<FilterState>(defaultFilters(DEFAULT_SETTINGS));
  const [cat, setCat] = useState<Category>('momentum');
  const [filtersOpen, setFiltersOpen] = useState(true);
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
      const fmt = (timeZone: string) => now.toLocaleTimeString('en-GB', {
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
          if (data.settings) {
            setSettings(data.settings);
            setFilters((prev) => ({
              ...prev,
              minPrice: data.settings.minPrice,
              maxPrice: data.settings.maxPrice,
              minVolume: data.settings.minVolume,
            }));
          }
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

  const rows = useMemo(() => {
    const query = filters.search.trim().toUpperCase();

    const candidates = stocks.filter((s) => {
      if (query && !s.symbol.toUpperCase().includes(query) && !(s.name || '').toUpperCase().includes(query)) return false;
      if (!Number.isFinite(s.price) || s.price < filters.minPrice || s.price > filters.maxPrice) return false;
      if (!Number.isFinite(s.volume) || s.volume < filters.minVolume) return false;
      if (filters.maxVolume !== null && s.volume > filters.maxVolume) return false;
      if (!Number.isFinite(s.dailyChange ?? NaN) || (s.dailyChange ?? 0) < filters.minDaily) return false;
      if ((s.relativeVolume ?? 0) < filters.minRvol) return false;
      if (s.score < filters.minScore) return false;

      const one = s.oneMinuteChange;
      const five = s.fiveMinuteChange;
      const hasPositiveShortTerm = (one !== null && one > filters.min1m) || (five !== null && five > filters.min5m);
      if (!hasPositiveShortTerm) return false;
      if (one !== null && one < 0) return false;
      if (s.freshness === 'STALE') return false;
      return true;
    });

    candidates.sort((a, b) => {
      const bRank = activeMomentumRank(b);
      const aRank = activeMomentumRank(a);
      if (bRank !== aRank) return bRank - aRank;
      const b1 = b.oneMinuteChange ?? -999;
      const a1 = a.oneMinuteChange ?? -999;
      if (b1 !== a1) return b1 - a1;
      const b5 = b.fiveMinuteChange ?? -999;
      const a5 = a.fiveMinuteChange ?? -999;
      if (b5 !== a5) return b5 - a5;
      const bRvol = b.relativeVolume ?? 0;
      const aRvol = a.relativeVolume ?? 0;
      if (bRvol !== aRvol) return bRvol - aRvol;
      return (b.dailyChange ?? 0) - (a.dailyChange ?? 0);
    });

    return candidates.slice(0, 10);
  }, [stocks, filters]);

  const selectedStock = useMemo(
    () => stocks.find((s) => s.symbol === selectedStockSymbol) || null,
    [stocks, selectedStockSymbol]
  );

  const selectedNews = useMemo(() => {
    if (!selectedStockSymbol) return [];
    return newsArticles.filter((article) => article.symbols?.some((s) => s.toUpperCase() === selectedStockSymbol.toUpperCase()));
  }, [newsArticles, selectedStockSymbol]);

  const openStock = (symbol: string) => setSelectedStockSymbol(symbol);

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => setFilters(defaultFilters(settings));

  return (
    <div className="app" id="app-container">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-line"><span className="brand-mark">JF</span><b>JFIRE MOMENTUM</b></div>
          <small>TOP 10 US EQUITY MOMENTUM SCANNER</small>
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
            <div className="hero-subtitle">Top 10 active upward movers first. Use the filters below to search the full tracked market.</div>
          </div>
          <div className="toolbar-actions">
            <button onClick={() => setCat('momentum')} className={cat === 'momentum' ? 'active' : ''}><Activity size={13} /> Top 10 Momentum</button>
            <button onClick={() => setCat('news')} className={cat === 'news' ? 'active' : ''}><Newspaper size={13} /> Live News</button>
            <button onClick={() => setFiltersOpen((open) => !open)} className={filtersOpen ? 'active' : ''}><Filter size={13} /> Filters</button>
          </div>
        </section>

        {filtersOpen && (
          <section className="scanner-filters">
            <div className="filter-title"><Filter size={14} /><b>STOCK FILTERS</b><span>Control what can appear in the leaderboard. Changes are instant and use the real tracked data.</span></div>
            <label className="filter-field search-field"><span>SEARCH</span><div><Search size={13} /><input value={filters.search} onChange={(e) => updateFilter('search', e.target.value)} placeholder="Ticker or company" /></div></label>
            <label className="filter-field"><span>MIN $ PRICE</span><input type="number" min="0" step="0.01" value={filters.minPrice} onChange={(e) => updateFilter('minPrice', inputNumber(e.target.value, 0) ?? 0)} /></label>
            <label className="filter-field"><span>MAX $ PRICE</span><input type="number" min="0" step="0.01" value={filters.maxPrice} onChange={(e) => updateFilter('maxPrice', inputNumber(e.target.value, 999999) ?? 999999)} /></label>
            <label className="filter-field"><span>MIN VOLUME</span><input type="number" min="0" step="1000" value={filters.minVolume} onChange={(e) => updateFilter('minVolume', inputNumber(e.target.value, 0) ?? 0)} /></label>
            <label className="filter-field"><span>MAX VOLUME</span><input type="number" min="0" step="1000" value={filters.maxVolume ?? ''} onChange={(e) => updateFilter('maxVolume', inputNumber(e.target.value, null))} placeholder="No max" /></label>
            <label className="filter-field"><span>MIN DAY %</span><input type="number" step="0.1" value={filters.minDaily} onChange={(e) => updateFilter('minDaily', inputNumber(e.target.value, 0) ?? 0)} /></label>
            <label className="filter-field"><span>MIN 5M %</span><input type="number" step="0.1" value={filters.min5m} onChange={(e) => updateFilter('min5m', inputNumber(e.target.value, 0) ?? 0)} /></label>
            <label className="filter-field"><span>MIN 1M %</span><input type="number" step="0.1" value={filters.min1m} onChange={(e) => updateFilter('min1m', inputNumber(e.target.value, 0) ?? 0)} /></label>
            <label className="filter-field"><span>MIN RVOL</span><input type="number" min="0" step="0.1" value={filters.minRvol} onChange={(e) => updateFilter('minRvol', inputNumber(e.target.value, 0) ?? 0)} /></label>
            <label className="filter-field"><span>MIN SCORE</span><input type="number" min="0" step="1" value={filters.minScore} onChange={(e) => updateFilter('minScore', inputNumber(e.target.value, 0) ?? 0)} /></label>
            <button className="filter-reset" onClick={resetFilters}>Reset</button>
          </section>
        )}

        <section className="status-strip">
          <div className={`data-mode ${status.connected ? 'live' : restFallbackActive ? 'rest' : 'offline'}`}>
            {status.connected ? <Wifi size={13} /> : restFallbackActive ? <Activity size={13} /> : <WifiOff size={13} />}
            <b>{status.connected ? 'LIVE — IEX WEBSOCKET' : restFallbackActive ? 'LIVE — REST SNAPSHOT' : 'OFFLINE'}</b>
          </div>
          <span>{status.universeSize.toLocaleString()} common stocks</span>
          <span>{status.stocksTracked.toLocaleString()} tracked</span>
          <span>{rows.length}/10 momentum leaders</span>
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
              <div><b>TOP 10 MOMENTUM</b><span>Active short-term movement · volume/RVOL · daily momentum · real data only</span></div>
              <span className="leader-count">{rows.length} / 10</span>
            </div>

            {rows.length === 0 ? (
              <div className="empty-state"><Activity size={28} /><b>No stocks match the current filters</b><span>Lower the price, volume, short-term momentum, RVOL or score filters, or wait for fresh upward movement.</span></div>
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
          <span>Click a stock to open its live JFire detail/news drawer.</span>
          <span>Trading 212 native stock deep-linking is not used because Trading 212 does not document a supported public instrument deep-link scheme.</span>
        </div>
      </main>

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
