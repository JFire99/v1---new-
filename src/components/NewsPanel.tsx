import React, { useState, useMemo } from 'react';
import type { NewsArticle, NewsEngineStatus } from '../types/news';
import type { StockData } from '../types/scanner';
import { NewsCard } from './NewsCard';
import { Search, Radio, RefreshCw } from 'lucide-react';

interface NewsPanelProps {
  articles: NewsArticle[];
  newsStatus: NewsEngineStatus;
  stocks: StockData[];
  onSelectStock: (symbol: string) => void;
  getSignalClass: (signal?: string) => string;
  getFreshnessConfig: (freshness?: string) => { label: string; icon: string; className: string; title: string };
}

export type NewsViewFilter =
  | 'ALL NEWS'
  | 'CATALYSTS'
  | 'BREAKING'
  | 'NEWS → MOMENTUM'
  | 'NEWS → SELLING'
  | 'WATCHLIST';

export const NewsPanel: React.FC<NewsPanelProps> = ({
  articles,
  newsStatus,
  stocks,
  onSelectStock,
  getSignalClass,
  getFreshnessConfig,
}) => {
  const [viewFilter, setViewFilter] = useState<NewsViewFilter>('ALL NEWS');
  const [tickerQuery, setTickerQuery] = useState('');
  const [keywordQuery, setKeywordQuery] = useState('');
  const [hasReactionOnly, setHasReactionOnly] = useState(false);

  // Map symbols to stock data for instant O(1) lookup
  const stockLookup = useMemo(() => {
    const map = new Map<string, StockData>();
    for (const s of stocks) {
      map.set(s.symbol.toUpperCase(), s);
    }
    return map;
  }, [stocks]);

  // Precompute counts for high-value filter tabs
  const { momentumCount, sellingCount, breakingCount, catalystCount, watchlistCount } = useMemo(() => {
    const now = Date.now();
    let mom = 0;
    let sell = 0;
    let brk = 0;
    let cat = 0;
    let wch = 0;

    for (const art of articles) {
      const ageMs = now - new Date(art.createdAt).getTime();
      if (ageMs < 300000) brk++;
      if (art.catalystType === 'HIGH IMPACT' || art.catalystType === 'CATALYST') cat++;

      let hasMom = false;
      let hasSell = false;
      let hasWch = false;

      for (const sym of art.symbols || []) {
        const upper = sym.toUpperCase();
        const stock = stockLookup.get(upper);
        if (stock) hasWch = true;

        const rx = art.reactions ? art.reactions[sym] : undefined;
        const snap = art.stockSnapshots ? art.stockSnapshots[sym] : undefined;
        const m1 = stock?.oneMinuteChange ?? snap?.oneMinuteChange;
        const m5 = stock?.fiveMinuteChange ?? snap?.fiveMinuteChange;
        const sig = stock?.signal ?? snap?.signal;

        if (
          rx?.direction === 'NEWS → MOMENTUM' ||
          (rx?.reaction30s && rx.reaction30s >= 1.0) ||
          (rx?.reaction1m && rx.reaction1m >= 1.0) ||
          (rx?.reaction5m && rx.reaction5m >= 2.0) ||
          (((m1 !== null && m1 !== undefined && m1 >= 1.0) || (m5 !== null && m5 !== undefined && m5 >= 2.0)) &&
            (m1 === null || m1 === undefined || m1 > -0.5) &&
            (m5 === null || m5 === undefined || m5 > -0.5) &&
            sig !== '⚪ STALE')
        ) {
          hasMom = true;
        }

        if (
          rx?.direction === 'NEWS → SELLING PRESSURE' ||
          (rx?.reaction30s && rx.reaction30s <= -1.0) ||
          (rx?.reaction1m && rx.reaction1m <= -1.0) ||
          (rx?.reaction5m && rx.reaction5m <= -1.0) ||
          ((m5 !== null && m5 !== undefined && m5 <= -1.0) || (m1 !== null && m1 !== undefined && m1 <= -1.0))
        ) {
          hasSell = true;
        }
      }

      if (hasMom) mom++;
      if (hasSell) sell++;
      if (hasWch) wch++;
    }

    return { momentumCount: mom, sellingCount: sell, breakingCount: brk, catalystCount: cat, watchlistCount: wch };
  }, [articles, stockLookup]);

  // Filter articles according to active filter and queries
  const filteredArticles = useMemo(() => {
    const now = Date.now();
    return articles.filter((art) => {
      // 1. Ticker search
      if (tickerQuery.trim()) {
        const query = tickerQuery.trim().toUpperCase();
        const matchesSym = art.symbols?.some((s) => s.toUpperCase().includes(query));
        if (!matchesSym) return false;
      }

      // 2. Keyword search in headline & summary
      if (keywordQuery.trim()) {
        const kq = keywordQuery.trim().toLowerCase();
        const text = `${art.headline} ${art.summary} ${art.catalystKeywords.join(' ')}`.toLowerCase();
        if (!text.includes(kq)) return false;
      }

      // 3. Primary Filter Categories
      if (viewFilter === 'CATALYSTS') {
        if (art.catalystType !== 'HIGH IMPACT' && art.catalystType !== 'CATALYST') return false;
      } else if (viewFilter === 'BREAKING') {
        const ageMs = now - new Date(art.createdAt).getTime();
        if (ageMs >= 300000) return false; // within 5m
      } else if (viewFilter === 'NEWS → MOMENTUM') {
        const hasPositiveReaction = art.symbols?.some((sym) => {
          const upper = sym.toUpperCase();
          const stock = stockLookup.get(upper);
          const rx = art.reactions ? art.reactions[sym] : undefined;
          const snap = art.stockSnapshots ? art.stockSnapshots[sym] : undefined;

          if (rx?.direction === 'NEWS → MOMENTUM') return true;
          if (rx?.reaction30s && rx.reaction30s >= 1.0) return true;
          if (rx?.reaction1m && rx.reaction1m >= 1.0) return true;
          if (rx?.reaction5m && rx.reaction5m >= 2.0) return true;

          const m1 = stock?.oneMinuteChange ?? snap?.oneMinuteChange;
          const m5 = stock?.fiveMinuteChange ?? snap?.fiveMinuteChange;
          const sig = stock?.signal ?? snap?.signal;

          return (
            ((m1 !== null && m1 !== undefined && m1 >= 1.0) || (m5 !== null && m5 !== undefined && m5 >= 2.0)) &&
            (m1 === null || m1 === undefined || m1 > -0.5) &&
            (m5 === null || m5 === undefined || m5 > -0.5) &&
            sig !== '⚪ STALE'
          );
        });
        if (!hasPositiveReaction) return false;
      } else if (viewFilter === 'NEWS → SELLING') {
        const hasNegativeReaction = art.symbols?.some((sym) => {
          const upper = sym.toUpperCase();
          const stock = stockLookup.get(upper);
          const rx = art.reactions ? art.reactions[sym] : undefined;
          const snap = art.stockSnapshots ? art.stockSnapshots[sym] : undefined;

          if (rx?.direction === 'NEWS → SELLING PRESSURE') return true;
          if (rx?.reaction30s && rx.reaction30s <= -1.0) return true;
          if (rx?.reaction1m && rx.reaction1m <= -1.0) return true;
          if (rx?.reaction5m && rx.reaction5m <= -1.0) return true;

          const m1 = stock?.oneMinuteChange ?? snap?.oneMinuteChange;
          const m5 = stock?.fiveMinuteChange ?? snap?.fiveMinuteChange;

          return (
            (m5 !== null && m5 !== undefined && m5 <= -1.0) ||
            (m1 !== null && m1 !== undefined && m1 <= -1.0)
          );
        });
        if (!hasNegativeReaction) return false;
      } else if (viewFilter === 'WATCHLIST') {
        const hasTrackedStock = art.symbols?.some((sym) => stockLookup.has(sym.toUpperCase()));
        if (!hasTrackedStock) return false;
      }

      // 4. Has reaction only
      if (hasReactionOnly) {
        if (!art.reactions || Object.keys(art.reactions).length === 0) return false;
      }

      return true;
    });
  }, [articles, tickerQuery, keywordQuery, viewFilter, hasReactionOnly, stockLookup]);

  return (
    <div className="news-layout" id="news-panel-layout">
      {/* Primary Category Filters Toolbar */}
      <div className="news-filter-bar" id="news-filter-bar">
        {/* Main View Filters: ALL NEWS, CATALYSTS, BREAKING, NEWS → MOMENTUM, NEWS → SELLING, WATCHLIST */}
        <div className="news-filter-group" id="news-main-filters">
          <span>Views:</span>
          {(
            [
              { id: 'ALL NEWS', label: 'All News', count: articles.length },
              { id: 'CATALYSTS', label: '⚡ Catalysts', count: catalystCount },
              { id: 'BREAKING', label: '🚨 Breaking', count: breakingCount, isHot: breakingCount > 0 },
              { id: 'NEWS → MOMENTUM', label: '🔥 News → Momentum', count: momentumCount, isHot: momentumCount > 0 },
              { id: 'NEWS → SELLING', label: '📉 News → Selling', count: sellingCount },
              { id: 'WATCHLIST', label: '⭐ Watchlist', count: watchlistCount },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              id={`view-filter-${tab.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
              className={`news-filter-btn ${viewFilter === tab.id ? 'active' : ''}`}
              onClick={() => setViewFilter(tab.id as NewsViewFilter)}
              style={
                tab.id === 'NEWS → MOMENTUM' && viewFilter === tab.id
                  ? { background: '#052e16', borderColor: '#166534', color: '#4ade80' }
                  : tab.id === 'NEWS → SELLING' && viewFilter === tab.id
                  ? { background: '#450a0a', borderColor: '#ef4444', color: '#fca5a5' }
                  : {}
              }
            >
              {tab.label}
              {tab.count > 0 && (
                <span
                  style={{
                    marginLeft: '5px',
                    padding: '1px 5px',
                    borderRadius: '8px',
                    fontSize: '8px',
                    background:
                      tab.id === 'NEWS → MOMENTUM'
                        ? '#15803d'
                        : tab.id === 'NEWS → SELLING'
                        ? '#b91c1c'
                        : tab.isHot
                        ? '#ef4444'
                        : '#1e293b',
                    color: '#fff',
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search & Toggles */}
        <div className="news-filter-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Search size={12} color="#687789" />
            <input
              type="text"
              placeholder="Ticker (e.g. IPW)"
              value={tickerQuery}
              onChange={(e) => setTickerQuery(e.target.value)}
              className="news-search-input"
              id="news-ticker-search"
            />
          </label>

          <input
            type="text"
            placeholder="Search headline..."
            value={keywordQuery}
            onChange={(e) => setKeywordQuery(e.target.value)}
            className="news-search-input"
            style={{ width: '130px' }}
            id="news-keyword-search"
          />

          <button
            id="reaction-filter-toggle"
            className={`news-filter-btn ${hasReactionOnly ? 'active' : ''}`}
            onClick={() => setHasReactionOnly(!hasReactionOnly)}
            title="Show only articles with calculated stock price reactions"
          >
            With Reaction {hasReactionOnly ? '✓' : ''}
          </button>
        </div>
      </div>

      {/* Stream Status Info */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '9px',
          color: '#687789',
          padding: '0 4px',
          flexWrap: 'wrap',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Radio size={12} color={newsStatus.connected ? '#4ade80' : '#f87171'} />
            Alpaca News Stream:{' '}
            <b style={{ color: newsStatus.connected ? '#4ade80' : '#f87171' }}>
              {newsStatus.connected ? 'CONNECTED (REAL-TIME)' : 'CONNECTING...'}
            </b>
          </span>
          <span>·</span>
          <span>Cached: {articles.length} articles</span>
          <span>·</span>
          <span>Showing: {filteredArticles.length}</span>
          <span>·</span>
          <span style={{ color: '#64748b' }}>
            Rotation limit: Top 30 tickers live; others update on rotation
          </span>
        </div>

        {newsStatus.lastArticleTime && (
          <div>
            Last article received:{' '}
            <b style={{ color: '#cbd5e1' }}>
              {new Date(newsStatus.lastArticleTime).toLocaleTimeString('en-US', {
                timeZone: 'America/New_York',
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}{' '}
              ET
            </b>
          </div>
        )}
      </div>

      {/* Articles Feed */}
      <div className="news-cards-container" id="news-articles-list">
        {filteredArticles.map((article) => (
          <NewsCard
            key={article.id}
            article={article}
            onSelectStock={onSelectStock}
            getSignalClass={getSignalClass}
            getFreshnessConfig={getFreshnessConfig}
            stockLookup={stockLookup}
          />
        ))}

        {filteredArticles.length === 0 && (
          <div
            style={{
              padding: '60px 20px',
              textAlign: 'center',
              background: '#0b1118',
              border: '1px solid #202a35',
              borderRadius: '5px',
              color: '#64748b',
            }}
            id="news-empty-state"
          >
            <RefreshCw size={24} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.5 }} />
            <b style={{ display: 'block', fontSize: '13px', color: '#94a3b8', marginBottom: '4px' }}>
              {articles.length === 0 ? 'Connecting to Alpaca Live News Stream...' : 'No articles match the active filter criteria'}
            </b>
            <span style={{ fontSize: '10px' }}>
              {articles.length === 0
                ? 'Streaming real-time breaking news directly from Alpaca Markets data feed.'
                : 'Try adjusting your view tab or search keyword filters.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
