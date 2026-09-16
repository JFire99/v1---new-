import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type {
  StockMetrics,
  AlertEvent,
  MarketStatus,
  ConnectionStatus,
  ScannerSettings,
  ClientMessage,
} from '@/types/scanner';
import { DEFAULT_SETTINGS } from '@/types/scanner';

export interface ScannerState {
  stocks: StockMetrics[];
  filteredStocks: StockMetrics[];
  alerts: AlertEvent[];
  marketStatus: MarketStatus;
  connectionStatus: ConnectionStatus;
  settings: ScannerSettings;
  totalScanned: number;
  totalAlerts: number;
  lastUpdate: number;
  error: string | null;
  universeSize: number;
  stocksWithData: number;
  filtersEnabled: boolean;
}

export function useScanner(): ScannerState & {
  updateSettings: (settings: Partial<ScannerSettings>) => Promise<void>;
  clearAlerts: () => void;
  setFiltersEnabled: (enabled: boolean) => void;
} {
  const [stocks, setStocks] = useState<StockMetrics[]>([]);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [marketStatus, setMarketStatus] = useState<MarketStatus>('CLOSED');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('CONNECTING');
  const [settings, setSettings] = useState<ScannerSettings>(DEFAULT_SETTINGS);
  const [totalScanned, setTotalScanned] = useState(0);
  const [totalAlerts, setTotalAlerts] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [universeSize, setUniverseSize] = useState(0);
  const [stocksWithData, setStocksWithData] = useState(0);
  const [filtersEnabled, setFiltersEnabled] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const msg: ClientMessage = JSON.parse(event.data);
        switch (msg.type) {
          case 'snapshot':
            setStocks(msg.data.stocks);
            setMarketStatus(msg.data.marketStatus);
            setConnectionStatus(msg.data.connectionStatus);
            setTotalScanned(msg.data.totalScanned);
            setTotalAlerts(msg.data.totalAlerts);
            setLastUpdate(msg.data.timestamp);
            setUniverseSize(msg.data.universeSize);
            setStocksWithData(msg.data.stocksWithData);
            break;
          case 'alert':
            setAlerts((prev) => {
              const updated = [msg.data, ...prev];
              return updated.slice(0, 200);
            });
            break;
          case 'market_status':
            setMarketStatus(msg.data);
            break;
          case 'connection_status':
            setConnectionStatus(msg.data);
            break;
          case 'settings':
            setSettings(msg.data);
            break;
          case 'error':
            setError(msg.data.message);
            break;
        }
      } catch (err) {
        console.error('[useScanner] Parse error:', err);
      }
    };

    es.onerror = () => {
      setConnectionStatus('ERROR');
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  const filteredStocks = useMemo(() => {
    if (!filtersEnabled) return stocks;
    const s = settings;
    return stocks.filter((m) => {
      if (m.price < s.minPrice) return false;
      if (m.price > s.maxPrice) return false;
      if (m.dailyChangePct < s.minDailyChangePct) return false;
      if (m.change1mPct < s.min1mChangePct) return false;
      if (m.change5mPct < s.min5mChangePct) return false;
      if (m.volume < s.minVolume) return false;
      if (m.relVolume < s.minRelVolume) return false;
      if (m.momentumScore < s.minMomentumScore) return false;
      if (s.maxFloat !== null && m.float !== null && m.float > s.maxFloat) return false;
      if (s.minMarketCap !== null && m.marketCap !== null && m.marketCap < s.minMarketCap) return false;
      return true;
    });
  }, [stocks, filtersEnabled, settings]);

  const updateSettings = useCallback(async (newSettings: Partial<ScannerSettings>) => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
    } catch (err) {
      console.error('[useScanner] Settings update error:', err);
    }
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  return {
    stocks,
    filteredStocks,
    alerts,
    marketStatus,
    connectionStatus,
    settings,
    totalScanned,
    totalAlerts,
    lastUpdate,
    error,
    universeSize,
    stocksWithData,
    filtersEnabled,
    updateSettings,
    clearAlerts,
    setFiltersEnabled,
  };
}
