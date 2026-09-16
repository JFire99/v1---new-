import React from 'react';
import type { NewsArticle, PriceReaction } from '../types/news';
import type { StockData } from '../types/scanner';
import { getRecency, formatTimeET } from '../utils/news-format';

interface PriceReactionDisplayProps {
  reaction?: PriceReaction;
}

export const PriceReactionDisplay: React.FC<PriceReactionDisplayProps> = ({ reaction }) => {
  if (!reaction) {
    return null;
  }

  const status = reaction.status || (reaction.priceAtNews > 0 ? 'TRACKING' : 'NO DATA');
  const direction = reaction.direction || 'NEWS ONLY';

  const formatDiff = (val?: number | null) => {
    if (val === undefined || val === null || !Number.isFinite(val)) return '—';
    const sign = val >= 0 ? '+' : '';
    const colorClass = val > 0 ? 'green' : val < 0 ? 'red' : 'muted';
    return <span className={colorClass}>{sign}{val.toFixed(1)}%</span>;
  };

  const getStatusClass = (st: string) => {
    if (st === 'WAITING FOR DATA') return 'status-waiting';
    if (st === 'TRACKING') return 'status-tracking';
    if (st === 'REACTION AVAILABLE') return 'status-available';
    return 'status-nodata';
  };

  const getDirectionClass = (dir: string) => {
    if (dir === 'NEWS → MOMENTUM') return 'direction-momentum';
    if (dir === 'NEWS → SELLING PRESSURE') return 'direction-selling';
    return 'direction-neutral';
  };

  return (
    <div className="reaction-wrapper-block" style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #1a2533' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {/* Reaction Status Pill */}
          <span className={`reaction-status-pill ${getStatusClass(status)}`} title={`Reaction Status: ${status}`}>
            {status}
          </span>

          {/* Directional Signal Pill */}
          <span className={`news-direction-badge ${getDirectionClass(direction)}`}>
            {direction === 'NEWS → MOMENTUM' ? '🔥 ' : direction === 'NEWS → SELLING PRESSURE' ? '📉 ' : '📰 '}
            {direction}
          </span>
        </div>

        {/* 30-stream WebSocket Limitation Note */}
        <span
          className="stream-limit-pill"
          title={
            reaction.inActiveWsStream
              ? 'Active IEX real-time stream'
              : 'Outside 30 active IEX WebSocket streams; price updates via rotation'
          }
        >
          {reaction.inActiveWsStream ? (
            <span style={{ color: '#4ade80' }}>● LIVE (IEX Stream)</span>
          ) : reaction.dataStatus === 'SEEDED' ? (
            <span style={{ color: '#60a5fa' }}>◐ SEEDED (1M Bars)</span>
          ) : (
            <span style={{ color: '#94a3b8' }}>○ STALE (Outside 30 active streams)</span>
          )}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ fontSize: '10px', color: '#cbd5e1' }}>
          Price at news:{' '}
          <b style={{ color: reaction.priceAtNews > 0 ? '#f8fafc' : '#64748b' }}>
            {reaction.priceAtNews > 0
              ? `$${reaction.priceAtNews < 1 ? reaction.priceAtNews.toFixed(4) : reaction.priceAtNews.toFixed(2)}`
              : '—'}
          </b>
        </div>

        {/* Interval cells */}
        <div className="reaction-grid">
          <div className="reaction-cell" title="+30 seconds price reaction">
            <span className="reaction-interval">30 sec</span>
            <span className="reaction-value">{formatDiff(reaction.reaction30s)}</span>
          </div>
          <div className="reaction-cell" title="+1 minute price reaction">
            <span className="reaction-interval">1 min</span>
            <span className="reaction-value">{formatDiff(reaction.reaction1m)}</span>
          </div>
          <div className="reaction-cell" title="+5 minutes price reaction">
            <span className="reaction-interval">5 min</span>
            <span className="reaction-value">{formatDiff(reaction.reaction5m)}</span>
          </div>
          <div className="reaction-cell" title="+10 minutes price reaction">
            <span className="reaction-interval">10 min</span>
            <span className="reaction-value">{formatDiff(reaction.reaction10m)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

interface NewsCardProps {
  article: NewsArticle;
  onSelectStock: (symbol: string) => void;
  getSignalClass: (signal?: string) => string;
  getFreshnessConfig: (freshness?: string) => { label: string; icon: string; className: string; title: string };
  stockLookup: Map<string, StockData>;
}

export const NewsCard: React.FC<NewsCardProps> = ({
  article,
  onSelectStock,
  getSignalClass,
  getFreshnessConfig,
  stockLookup,
}) => {
  const recency = getRecency(article.createdAt);
  const timeET = formatTimeET(article.createdAt);

  const isBreaking = recency.label === 'BREAKING';
  const isHighImpact = article.catalystType === 'HIGH IMPACT';

  const catalystClass =
    article.catalystType === 'HIGH IMPACT'
      ? 'catalyst-high'
      : article.catalystType === 'CATALYST'
      ? 'catalyst-general'
      : 'catalyst-standard';

  return (
    <div
      className={`news-card ${isBreaking ? 'news-card-breaking' : ''} ${
        isHighImpact ? 'news-card-high-impact' : ''
      }`}
      id={`news-card-${article.id}`}
    >
      {/* Header */}
      <div className="news-card-header">
        <div className="news-card-meta-left">
          <span className={`recency-badge ${recency.className}`}>{recency.label} · {recency.ageText}</span>
          <span className={`catalyst-badge ${catalystClass}`}>{article.catalystType}</span>
          {article.catalystKeywords.length > 0 && (
            <span style={{ fontSize: '8px', color: '#94a3b8', fontStyle: 'italic' }}>
              [{article.catalystKeywords.join(', ')}]
            </span>
          )}
        </div>
        <div className="news-card-meta-right">
          <span className="news-time">{timeET}</span>
          {article.source && <span className="news-source">{article.source}</span>}
          {article.url ? (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#38bdf8', fontSize: '9px', textDecoration: 'none', fontWeight: 600 }}
              id={`read-article-${article.id}`}
            >
              [Read Article ↗]
            </a>
          ) : null}
        </div>
      </div>

      {/* Headline */}
      <div className="news-headline">
        {article.url ? (
          <a href={article.url} target="_blank" rel="noopener noreferrer">
            {article.headline}
          </a>
        ) : (
          article.headline
        )}
      </div>

      {/* Summary */}
      {article.summary && (
        <div className="news-summary">
          {article.summary.length > 320 ? `${article.summary.slice(0, 320)}...` : article.summary}
        </div>
      )}

      {/* Associated Tickers & Price Reactions */}
      {article.symbols && article.symbols.length > 0 && (
        <div className="news-tickers-container">
          {article.symbols.map((sym) => {
            const stock = stockLookup.get(sym);
            const rx = article.reactions ? article.reactions[sym] : undefined;
            const snap = article.stockSnapshots ? article.stockSnapshots[sym] : undefined;

            const currentPrice = stock?.price ?? snap?.price;
            const daily = stock?.dailyChange ?? snap?.dailyChange;
            const m1 = stock?.oneMinuteChange ?? snap?.oneMinuteChange;
            const m5 = stock?.fiveMinuteChange ?? snap?.fiveMinuteChange;
            const rvol = stock?.relativeVolume ?? snap?.relativeVolume;
            const signal = stock?.signal ?? snap?.signal;
            const freshness = stock?.freshness ?? snap?.freshness;
            const score = stock?.score ?? snap?.score;
            const fc = getFreshnessConfig(freshness);

            return (
              <div
                key={sym}
                className="news-ticker-row"
                id={`news-ticker-${sym}`}
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}
              >
                <div className="news-ticker-left" style={{ justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span
                      className="news-ticker-sym"
                      onClick={() => onSelectStock(sym)}
                      title={`Click to inspect ${sym} full details`}
                      style={{ fontSize: '13px', fontWeight: 800, color: '#38bdf8' }}
                    >
                      📰 {sym}
                    </span>

                    {currentPrice ? (
                      <span className="news-ticker-price" style={{ fontSize: '12px' }}>
                        ${currentPrice < 1 ? currentPrice.toFixed(4) : currentPrice.toFixed(2)}
                      </span>
                    ) : (
                      <span className="muted" style={{ fontSize: '10px' }}>—</span>
                    )}

                    {daily !== undefined && daily !== null && (
                      <span className={`news-metric-pill ${daily >= 0 ? 'green' : 'red'}`}>
                        Daily {daily >= 0 ? '+' : ''}{daily.toFixed(2)}%
                      </span>
                    )}

                    {m1 !== undefined && m1 !== null && (
                      <span className={`news-metric-pill ${m1 >= 0 ? 'green' : 'red'}`}>
                        1M {m1 >= 0 ? '+' : ''}{m1.toFixed(2)}%
                      </span>
                    )}

                    {m5 !== undefined && m5 !== null && (
                      <span className={`news-metric-pill ${m5 >= 0 ? 'green' : 'red'}`}>
                        5M {m5 >= 0 ? '+' : ''}{m5.toFixed(2)}%
                      </span>
                    )}

                    {rvol !== undefined && rvol !== null && rvol > 0 && (
                      <span className="news-metric-pill" style={{ color: '#7dd3fc' }}>
                        RVOL {rvol.toFixed(1)}x
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {signal && (
                      <span className={`signal-badge ${getSignalClass(signal)}`}>
                        {signal}
                      </span>
                    )}

                    {freshness && (
                      <span className={`freshness-badge ${fc.className}`} title={fc.title}>
                        <span className="freshness-dot">{fc.icon}</span> {fc.label}
                      </span>
                    )}

                    {score !== undefined && score > 0 && (
                      <span className="score-badge" style={{ fontSize: '9px' }}>
                        {score}
                      </span>
                    )}
                  </div>
                </div>

                {/* Price Reaction Tracking Component */}
                <PriceReactionDisplay reaction={rx} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
