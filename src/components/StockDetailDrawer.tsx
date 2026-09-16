import React, { useEffect, useMemo, useState } from 'react';
import type { StockData, StockLiveDetail } from '../types/scanner';
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

const fmtShares = (value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString();
};

const LiveChart: React.FC<{ detail: StockLiveDetail | null }> = ({ detail }) => {
  const points = detail?.history || [];
  const chart = useMemo(() => {
    if (points.length < 2) return null;
    const width = 700;
    const height = 210;
    const pad = 12;
    const prices = points.map((p) => p.p).filter((p) => Number.isFinite(p));
    const vols = points.map((p) => p.v || 0);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = Math.max(maxP - minP, Math.max(maxP * 0.002, 0.0001));
    const maxV = Math.max(...vols, 1);
    const line = points.map((p, i) => {
      const x = pad + (i / Math.max(points.length - 1, 1)) * (width - pad * 2);
      const y = pad + (1 - (p.p - minP) / range) * (height - pad * 2 - 45);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const bars = points.map((p, i) => {
      const x = pad + (i / Math.max(points.length - 1, 1)) * (width - pad * 2);
      const barWidth = Math.max(2, (width - pad * 2) / Math.max(points.length, 1) - 2);
      const h = ((p.v || 0) / maxV) * 42;
      return { x, y: height - h - pad, h, w: barWidth };
    });
    return { width, height, line, bars, minP, maxP };
  }, [points]);

  if (!chart) {
    return <div className="live-chart-empty">Waiting for live candle history…</div>;
  }

  return (
    <div className="live-chart-wrap">
      <div className="live-chart-labels"><span>HIGH {chart.maxP.toFixed(4)}</span><span>LOW {chart.minP.toFixed(4)}</span></div>
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="live-chart" role="img" aria-label="Live price and volume chart">
        <line x1="0" x2="700" y1="165" y2="165" className="chart-grid-line" />
        {chart.bars.map((b, i) => <rect key={`v-${i}`} x={b.x - b.w / 2} y={b.y} width={b.w} height={b.h} rx="1" className="volume-bar" />)}
        <polyline points={chart.line} fill="none" className="price-line" />
      </svg>
      <div className="chart-legend"><span>PRICE</span><span>VOLUME / MINUTE</span></div>
    </div>
  );
};

export const StockDetailDrawer: React.FC<StockDetailDrawerProps> = ({
  symbol,
  onClose,
  stock,
  newsArticles,
  getSignalClass,
  getFreshnessConfig,
  getTriggerClass,
}) => {
  const [liveDetail, setLiveDetail] = useState<StockLiveDetail | null>(null);

  useEffect(() => {
    if (!symbol) {
      setLiveDetail(null);
      return;
    }

    let cancelled = false;
    const load = () => {
      fetch(`/api/stocks?symbol=${encodeURIComponent(symbol)}`)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled && data?.detail) setLiveDetail(data.detail);
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [symbol]);

  if (!symbol) return null;
  const fc = getFreshnessConfig(stock?.freshness);
  const currentMinuteVolume = liveDetail?.minuteVolume ?? stock?.minuteVolume ?? null;
  const acceleration = liveDetail?.volumeAcceleration ?? stock?.volumeAcceleration ?? null;
  const live = liveDetail?.live ?? stock?.freshness === 'LIVE';

  return (
    <div className="modal-overlay" onClick={onClose} id="stock-detail-overlay">
      <div className="modal-drawer" onClick={(e) => e.stopPropagation()} id="stock-detail-drawer">
        <div className="drawer-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#f8fafc' }}>{symbol}</h2>
              {stock?.signal && <span className={`signal-badge ${getSignalClass(stock.signal)}`}>{stock.signal}</span>}
              <span className={`freshness-badge ${live ? 'freshness-live' : fc.className}`}>{live ? '● LIVE' : `${fc.icon} ${fc.label}`}</span>
            </div>
            {stock?.name && <small style={{ color: '#64748b', fontSize: '10px' }}>{stock.name}</small>}
          </div>
          <button className="drawer-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          <div>
            <div className="drawer-section-title">MOMENTUM & LIQUIDITY SNAPSHOT</div>
            <div className="drawer-metrics">
              <div><small>PRICE</small><b>{stock?.price ? (stock.price < 1 ? `$${stock.price.toFixed(4)}` : `$${stock.price.toFixed(2)}`) : '—'}</b></div>
              <div><small>DAILY %</small><b className={stock?.dailyChange !== null && stock?.dailyChange !== undefined ? (stock.dailyChange >= 0 ? 'green' : 'red') : 'muted'}>{stock?.dailyChange !== null && stock?.dailyChange !== undefined ? `${stock.dailyChange >= 0 ? '+' : ''}${stock.dailyChange.toFixed(2)}%` : '—'}</b></div>
              <div><small>SCORE</small><strong className="score-badge">{stock?.score ?? 0}</strong></div>
              <div><small>1M MOMENTUM</small><b className={stock?.oneMinuteChange !== null && stock?.oneMinuteChange !== undefined ? (stock.oneMinuteChange >= 0 ? 'green' : 'red') : 'muted'}>{stock?.oneMinuteChange !== null && stock?.oneMinuteChange !== undefined ? `${stock.oneMinuteChange >= 0 ? '+' : ''}${stock.oneMinuteChange.toFixed(2)}%` : '—'}</b></div>
              <div><small>5M MOMENTUM</small><b className={stock?.fiveMinuteChange !== null && stock?.fiveMinuteChange !== undefined ? (stock.fiveMinuteChange >= 0 ? 'green' : 'red') : 'muted'}>{stock?.fiveMinuteChange !== null && stock?.fiveMinuteChange !== undefined ? `${stock.fiveMinuteChange >= 0 ? '+' : ''}${stock.fiveMinuteChange.toFixed(2)}%` : '—'}</b></div>
              <div><small>RVOL</small><b>{stock?.relativeVolume ? `${stock.relativeVolume.toFixed(2)}x` : '—'}</b></div>
              <div><small>DAY VOLUME</small><b>{stock?.volume ? stock.volume.toLocaleString() : '0'}</b></div>
              <div><small>LIVE MIN VOLUME</small><b>{fmtShares(currentMinuteVolume)}</b></div>
              <div><small>VOLUME SPEED</small><b>{acceleration ? `${acceleration.toFixed(2)}x` : '—'}</b></div>
              <div><small>DAY HIGH</small><b>{stock?.dayHigh ? `$${stock.dayHigh.toFixed(2)}` : '—'}</b></div>
              <div><small>FROM HIGH</small><b>{stock?.distanceFromHigh !== null && stock?.distanceFromHigh !== undefined ? (stock.distanceFromHigh < 0.05 ? 'NEW HIGH' : `-${stock.distanceFromHigh.toFixed(2)}%`) : '—'}</b></div>
            </div>

            <div className="live-flow-panel">
              <div><span>LIVE TRADE ACTIVITY</span><b>{live ? 'STREAMING' : 'REST / SEEDED'}</b></div>
              <div><span>SHARES IN CURRENT MINUTE</span><b>{fmtShares(currentMinuteVolume)}</b></div>
              <div><span>VOLUME VS BASELINE</span><b>{acceleration ? `${acceleration.toFixed(2)}×` : '—'}</b></div>
            </div>

            <LiveChart detail={liveDetail} />

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
