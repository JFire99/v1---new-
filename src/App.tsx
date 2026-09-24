import { useEffect, useState } from 'react';
import './App.css';
import type { NewsArticle } from './types/news';
import type { ScannerStatus, StockData } from './types/scanner';
import { MultiScannerDashboard } from './components/MultiScannerDashboard';

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
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([]);
  const [newsStatus, setNewsStatus] = useState<any>({ connected: false, totalArticles: 0, trackedSymbolsWithNews: 0, lastArticleTime: null });
  const [ukTime, setUkTime] = useState('');
  const [etTime, setEtTime] = useState('');
  const [newsRefreshing, setNewsRefreshing] = useState(false);
  const [lastNewsRefresh, setLastNewsRefresh] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const fmt = (zone: string) => now.toLocaleTimeString('en-GB', { timeZone: zone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setUkTime(fmt('Europe/London') + ' UK');
      setEtTime(fmt('America/New_York') + ' ET');
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const refreshNews = async () => {
      setNewsRefreshing(true);
      try {
        const response = await fetch('/api/news?limit=200&refresh=1', { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          const articles = Array.isArray(data?.articles) ? data.articles : Array.isArray(data) ? data : null;
          if (articles) setNewsArticles(articles);
        }
      } catch {}
      setLastNewsRefresh(new Date());
      window.setTimeout(() => setNewsRefreshing(false), 900);
    };
    refreshNews();
    const newsTimer = window.setInterval(refreshNews, 180000);

    fetch('/api/status').then(r => r.json()).then(data => {
      if (data && typeof data === 'object') setStatus(prev => ({ ...prev, ...data }));
    }).catch(() => {});

    fetch('/api/stocks').then(r => r.json()).then(data => {
      if (Array.isArray(data?.stocks)) setStocks(data.stocks);
    }).catch(() => {});

    const stream = new EventSource('/api/stream');
    stream.onmessage = event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'stocks') {
          setStocks(Array.isArray(msg.stocks) ? msg.stocks : []);
          setStatus(prev => ({ ...prev, universeSize: msg.universeSize ?? prev.universeSize, stocksTracked: msg.stocksTracked ?? prev.stocksTracked }));
        } else if (msg.type === 'connection_status') {
          setStatus(prev => ({ ...prev, ...msg }));
        } else if (msg.type === 'news_init') {
          setNewsArticles(Array.isArray(msg.articles) ? msg.articles : []);
        } else if (msg.type === 'news_article' && msg.article) {
          setNewsArticles(prev => prev.some(a => a.id === msg.article.id) ? prev : [msg.article, ...prev.slice(0, 799)]);
        } else if (msg.type === 'news_status') {
          setNewsStatus((prev: any) => ({ ...prev, ...msg }));
        } else if (msg.type === 'stockUpdate' && msg.stock) {
          setStocks(prev => {
            const i = prev.findIndex(s => s.symbol === msg.stock.symbol);
            if (i < 0) return prev;
            const next = prev.slice();
            next[i] = msg.stock;
            return next;
          });
        }
      } catch {}
    };
    return () => { stream.close(); window.clearInterval(newsTimer); };
  }, []);

  return <MultiScannerDashboard stocks={stocks} status={status} newsArticles={newsArticles} newsStatus={newsStatus} ukTime={ukTime} etTime={etTime} newsRefreshing={newsRefreshing} lastNewsRefresh={lastNewsRefresh} />;
}
