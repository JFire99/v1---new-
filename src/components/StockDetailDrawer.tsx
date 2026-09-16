import React from 'react';
import { ExternalLink } from 'lucide-react';
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

const trading212Url = (symbol: string) => `https://www.trading212.com/trading-instruments/invest/${encodeURIComponent(symbol.toUpperCase())}.US`;

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
        <div className="drawer-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#f8fafc' }}>{symbol}</h2>
              {stock?.signal && <span className={`signal-badge ${getSignalClass(stock.signal)}`}>{stock.signal}</span>}
              {stock?.freshness && <span className={`freshness-badge ${fc.className}`} title={fc.title}>{fc.icon} {fc.label}</span>}
            </div>
            {stock?.name && <small style={{ color: '#64748b', fontSize: '10px' }}>{stock.name}</small>}
          </div>
          <button className="drawer-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          <div className="drawer-trade-panel">
            <div>
              <b>Ready to view {symbol}?</b>
              <span>Open the instrument in Trading 212 for manual review and order placement.</span>
            </div>
            <a href={trading212Url(symbol)} target="_blank" rel="noopener noreferrer" className="drawer-trade-button">
              <ExternalLink size={14} /> Trading 212
            </a>
          </div>

          <div>
            <div className="drawer-section-title">MOMENTUM & LIQUIDITY SNAPSHOT</div>
            <div className="drawer-metrics">
              <div><small>PRICE</small><b>{stock?.price ? (stock.price < 1 ? `$${stock.price.toFixed(4)}` : `$${stock.price.toFixed(2)}`) : '—'}</b></div>
              <div><small>DAILY %</small><b className={stock?.dailyChange !== null && stock?.dailyChange !== undefined ? (stock.dailyChange >= 0 ? 'green' : 'red') : 'muted'}>{stock?.dailyChange !== null && stock?.dailyChange !== undefined ? `${stock.dailyChange >= 0 ? '+' : ''}${stock.dailyChange.toFixed(2)}%` : '—'}</b></div>
              <div><small>SCORE</small><strong className="score-badge">{stock?.score ?? 0}</strong></div>
              <div><small>1M MOMENTUM</small><b className={stock?.oneMinuteChange !== null && stock?.oneMinuteChange !== undefined ? (stock.oneMinuteChange >= 0 ? 'green' : 'red') : 'muted'}>{stock?.oneMinuteChange !== null && stock?.oneMinuteChange !== undefined ? `${stock.oneMinuteChange >= 0 ? '+' : ''}${stock.oneMinuteChange.toFixed(2)}%` : '—'}</b></div>
              <div><small>5M MOMENTUM</small><b className={stock?.fiveMinuteChange !== null && stock?.fiveMinuteChange !== undefined ? (stock.fiveMinuteChange >= 0 ? 'green' : 'red') : 'muted'}>{stock?.fiveMinuteChange !== null && stock?.fiveMinuteChange !== undefined ? `${stock.fiveMinuteChange >= 0 ? '+' : ''}${stock.fiveMinuteChange.toFixed(2)}%` : '—'}</b></div>
              <div><small>RVOL</small><b>{stock?.relativeVolume ? `${stock.relativeVolume.toFixed(2)}x` : '—'}</b></div>
              <div><small>VOLUME</small><b>{stock?.volume ? stock.volume.toLocaleString() : '0'}</b></div>
              <div><small>DAY HIGH</small><b>{stock?.dayHigh ? `$${stock.dayHigh.toFixed(2)}` : '—'}</b></div>
              <div><small>FROM HIGH</small><b>{stock?.distanceFromHigh !== null && stock?.distanceFromHigh !== undefined ? (stock.distanceFromHigh < 0.05 ? 'NEW HIGH' : `-${stock.distanceFromHigh.toFixed(2)}%`) : '—'}</b></div>
            </div>

            {stock?.triggers?.length ? (
              <div style={{ marginTop: '10px' }}>
                <small className="drawer-label">ACTIVE TRIGGERS</small>
                <div className="triggers-container">
                  {stock.triggers.map((tr) => <span key={tr} className={`trigger-tag ${getTriggerClass(tr)}`}>{tr}</span>)}
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <div className="drawer-section-title">RECENT NEWS & CATALYSTS ({newsArticles.length})</div>
            {newsArticles.length === 0 ? (
              <div className="drawer-empty">No recent news articles logged for {symbol} within the active window.</div>
            ) : (
              <div className="drawer-news-list">
                {newsArticles.map((art) => {
                  const rec = getRecency(art.createdAt);
                  const rx = art.reactions ? art.reactions[symbol] : undefined;
                  return (
                    <div key={art.id} className="drawer-news-card">
                      <div className="drawer-news-meta">
                        <div><span className={`recency-badge ${rec.className}`}>{rec.label}</span><span className="catalyst-badge catalyst-high">{art.catalystType}</span><span className="news-time">{formatTimeET(art.createdAt)} ET</span></div>
                        {art.url && <a href={art.url} target="_blank" rel="noopener noreferrer">Read article ↗</a>}
                      </div>
                      <div className="drawer-news-headline">{art.headline}</div>
                      {art.summary && <div className="drawer-news-summary">{art.summary.slice(0, 240)}{art.summary.length > 240 ? '…' : ''}</div>}
                      <div className="drawer-reaction-title">NEWS REACTION — {symbol}</div>
                      <PriceReactionDisplay reaction={rx} />
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
