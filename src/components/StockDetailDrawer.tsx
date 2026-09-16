import React from 'react';
import type { StockData } from '../types/scanner';
import type { NewsArticle } from '../types/news';
import { PriceReactionDisplay } from './NewsCard';
import { getRecency, formatTimeET } from '../utils/news-format';

interface StockDetailDrawerProps {
  symbol: string | null;
  onClose: () => void;
  stock: StockData | null;
  newsArticles: NewsArticle[];
  getSignalClass: (signal?: string) => string;
  getFreshnessConfig: (freshness?: string) => { label: string; icon: string; className: string; title: string };
  getTriggerClass: (trigger: string) => string;
}

export const StockDetailDrawer: React.FC<StockDetailDrawerProps> = ({
  symbol,
  onClose,
  stock,
  newsArticles,
  getSignalClass,
  getFreshnessConfig,
  getTriggerClass,
}) => {
  if (!symbol) return null;

  const fc = getFreshnessConfig(stock?.freshness);

  return (
    <div className="modal-overlay" onClick={onClose} id="stock-detail-overlay">
      <div className="modal-drawer" onClick={(e) => e.stopPropagation()} id="stock-detail-drawer">
        {/* Header */}
        <div className="drawer-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#f8fafc' }}>
                {symbol}
              </h2>
              {stock?.signal && (
                <span className={`signal-badge ${getSignalClass(stock.signal)}`}>
                  {stock.signal}
                </span>
              )}
              {stock?.freshness && (
                <span className={`freshness-badge ${fc.className}`} title={fc.title}>
                  <span className="freshness-dot">{fc.icon}</span> {fc.label}
                </span>
              )}
            </div>
            {stock?.name && (
              <small style={{ color: '#64748b', fontSize: '10px' }}>{stock.name}</small>
            )}
          </div>
          <button className="drawer-close-btn" onClick={onClose} id="drawer-close-btn">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="drawer-body">
          {/* Metrics Grid */}
          <div>
            <div className="drawer-section-title">MOMENTUM & LIQUIDITY SNAPSHOT</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                background: '#0e151f',
                padding: '12px',
                borderRadius: '4px',
                border: '1px solid #1f2c3b',
              }}
            >
              <div>
                <small style={{ display: 'block', color: '#64748b', fontSize: '8px' }}>PRICE</small>
                <b style={{ fontSize: '14px', color: '#f8fafc' }}>
                  {stock?.price ? (stock.price < 1 ? `$${stock.price.toFixed(4)}` : `$${stock.price.toFixed(2)}`) : '—'}
                </b>
              </div>
              <div>
                <small style={{ display: 'block', color: '#64748b', fontSize: '8px' }}>DAILY %</small>
                <b
                  style={{ fontSize: '14px' }}
                  className={
                    stock?.dailyChange === null || stock?.dailyChange === undefined
                      ? 'muted'
                      : stock.dailyChange >= 0
                      ? 'green'
                      : 'red'
                  }
                >
                  {stock?.dailyChange !== null && stock?.dailyChange !== undefined
                    ? `${stock.dailyChange >= 0 ? '+' : ''}${stock.dailyChange.toFixed(2)}%`
                    : '—'}
                </b>
              </div>
              <div>
                <small style={{ display: 'block', color: '#64748b', fontSize: '8px' }}>SCORE</small>
                <strong className={`score-badge ${stock && stock.score >= 70 ? 'score-hot' : stock && stock.score >= 50 ? 'score-warm' : ''}`}>
                  {stock?.score ?? 0}
                </strong>
              </div>

              <div>
                <small style={{ display: 'block', color: '#64748b', fontSize: '8px' }}>1M MOMENTUM</small>
                <span
                  style={{ fontSize: '12px', fontWeight: 700 }}
                  className={
                    stock?.oneMinuteChange === null || stock?.oneMinuteChange === undefined
                      ? 'muted'
                      : stock.oneMinuteChange >= 0
                      ? 'green'
                      : 'red'
                  }
                >
                  {stock?.oneMinuteChange !== null && stock?.oneMinuteChange !== undefined
                    ? `${stock.oneMinuteChange >= 0 ? '+' : ''}${stock.oneMinuteChange.toFixed(2)}%`
                    : '—'}
                </span>
              </div>
              <div>
                <small style={{ display: 'block', color: '#64748b', fontSize: '8px' }}>5M MOMENTUM</small>
                <span
                  style={{ fontSize: '12px', fontWeight: 700 }}
                  className={
                    stock?.fiveMinuteChange === null || stock?.fiveMinuteChange === undefined
                      ? 'muted'
                      : stock.fiveMinuteChange >= 0
                      ? 'green'
                      : 'red'
                  }
                >
                  {stock?.fiveMinuteChange !== null && stock?.fiveMinuteChange !== undefined
                    ? `${stock.fiveMinuteChange >= 0 ? '+' : ''}${stock.fiveMinuteChange.toFixed(2)}%`
                    : '—'}
                </span>
              </div>
              <div>
                <small style={{ display: 'block', color: '#64748b', fontSize: '8px' }}>RVOL</small>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#7dd3fc' }}>
                  {stock?.relativeVolume ? `${stock.relativeVolume.toFixed(2)}x` : '—'}
                </span>
              </div>

              <div>
                <small style={{ display: 'block', color: '#64748b', fontSize: '8px' }}>VOLUME</small>
                <span style={{ fontSize: '11px', color: '#cbd5e1' }}>
                  {stock?.volume ? stock.volume.toLocaleString() : '0'}
                </span>
              </div>
              <div>
                <small style={{ display: 'block', color: '#64748b', fontSize: '8px' }}>DAY HIGH</small>
                <span style={{ fontSize: '11px', color: '#cbd5e1' }}>
                  ${stock?.dayHigh ? stock.dayHigh.toFixed(2) : '—'}
                </span>
              </div>
              <div>
                <small style={{ display: 'block', color: '#64748b', fontSize: '8px' }}>FROM HIGH</small>
                <span style={{ fontSize: '11px', color: '#cbd5e1' }}>
                  {stock?.distanceFromHigh !== null && stock?.distanceFromHigh !== undefined
                    ? stock.distanceFromHigh < 0.05
                      ? 'NEW HIGH'
                      : `-${stock.distanceFromHigh.toFixed(2)}%`
                    : '—'}
                </span>
              </div>
            </div>

            {/* Triggers */}
            {stock?.triggers && stock.triggers.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <small style={{ display: 'block', color: '#64748b', fontSize: '8px', marginBottom: '4px' }}>
                  ACTIVE TRIGGERS
                </small>
                <div className="triggers-container">
                  {stock.triggers.map((tr) => (
                    <span key={tr} className={`trigger-tag ${getTriggerClass(tr)}`}>
                      {tr}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Recent News Articles & Price Reaction Breakdown */}
          <div>
            <div className="drawer-section-title">
              <span>RECENT NEWS & CATALYSTS ({newsArticles.length})</span>
            </div>

            {newsArticles.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', background: '#0e151f', borderRadius: '4px', color: '#64748b', fontSize: '10px' }}>
                No recent news articles logged for {symbol} within the active window.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {newsArticles.map((art) => {
                  const rec = getRecency(art.createdAt);
                  const rx = art.reactions ? art.reactions[symbol] : undefined;
                  return (
                    <div
                      key={art.id}
                      style={{
                        background: '#0e151f',
                        border: '1px solid #1f2c3b',
                        borderRadius: '4px',
                        padding: '12px 14px',
                      }}
                    >
                      {/* Headline & Metadata */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <span className={`recency-badge ${rec.className}`}>{rec.label}</span>
                          <span className="catalyst-badge catalyst-high" style={{ fontSize: '7px' }}>
                            {art.catalystType}
                          </span>
                          <span style={{ fontSize: '9px', color: '#94a3b8', fontFamily: 'monospace' }}>
                            {formatTimeET(art.createdAt)} ET
                          </span>
                        </div>
                        {art.url && (
                          <a
                            href={art.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#38bdf8', fontSize: '9px', textDecoration: 'none', fontWeight: 600 }}
                          >
                            [Read Article ↗]
                          </a>
                        )}
                      </div>

                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#f1f5f9', marginBottom: '6px', lineHeight: 1.4 }}>
                        {art.headline}
                      </div>

                      {art.summary && (
                        <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '10px', lineHeight: 1.4 }}>
                          {art.summary.slice(0, 200)}...
                        </div>
                      )}

                      {/* Explicit News Reaction Section */}
                      <div style={{ marginTop: '6px' }}>
                        <div style={{ fontSize: '9px', fontWeight: 700, color: '#64748b', letterSpacing: '0.5px', marginBottom: '4px' }}>
                          NEWS REACTION (WHY {symbol} IS MOVING)
                        </div>
                        <PriceReactionDisplay reaction={rx} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
