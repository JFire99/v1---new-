// Shared types between server and client

export interface ScannerSettings {
  minPrice: number;
  maxPrice: number;
  minDailyChangePct: number;
  min1mChangePct: number;
  min5mChangePct: number;
  minVolume: number;
  minDollarVolume: number;
  minRelVolume: number;
  minMomentumScore: number;
  maxFloat: number | null;
  minMarketCap: number | null;
}

export type MomentumSignal =
  | '🔥 EXPLOSIVE'
  | '🚀 STRONG MOMENTUM'
  | '🟢 BUILDING'
  | '👀 WATCH'
  | '⚪ STALE';

export type DataFreshness = 'LIVE' | 'SEEDED' | 'STALE';

export interface StockData {
  symbol: string;
  name?: string;
  price: number;
  previousClose: number | null;
  dailyChange: number | null;
  oneMinuteChange: number | null;
  twoMinuteChange: number | null;
  fiveMinuteChange: number | null;
  volume: number;
  dollarVolume: number;
  previousDailyVolume?: number | null;
  relativeVolume: number | null;
  volumeAcceleration?: number | null;
  minuteVolume?: number | null;
  dayOpen: number | null;
  dayHigh: number;
  distanceFromHigh: number | null;
  score: number;
  signal?: MomentumSignal;
  freshness?: DataFreshness;
  triggers: string[];
  newsCount?: number;
  hasRecentNews?: boolean;
  lastUpdate: string;
  halted?: boolean;
  haltReason?: string | null;
  haltUpdatedAt?: string | null;
}

export interface LivePricePoint {
  t: number;
  p: number;
  v?: number;
}

export interface StockLiveDetail {
  symbol: string;
  history: LivePricePoint[];
  minuteVolume: number | null;
  volumeAcceleration: number | null;
  lastWsTime: number | null;
  live: boolean;
}

export interface MarketClock {
  isOpen: boolean;
  timestamp: string;
  nextOpen: string;
  nextClose: string;
}

export interface ScannerProgress {
  processed: number;
  received: number;
  universeSize: number;
  scanning: boolean;
}

export type MarketSessionType = 'PRE_MARKET' | 'REGULAR' | 'AFTER_HOURS' | 'OVERNIGHT' | 'CLOSED';

export interface MarketSessionTransition {
  targetSession: MarketSessionType;
  targetBadge: string;
  targetTimeEt: string;
  targetTimeIso: string;
  countdownMinutes: number;
  countdownFormatted: string;
}

export interface MarketSessionInfo {
  session: MarketSessionType;
  sessionBadge: string;
  displayStatus: string;
  feedBadge: string;
  feedDescription: string;
  isExtendedHours: boolean;
  isOpen: boolean;
  currentEtTime: string;
  currentEtDate: string;
  isHoliday: boolean;
  holidayName?: string | null;
  nextTransition: MarketSessionTransition;
}

export interface TimestampSpanSample {
  symbol: string;
  pointsCount: number;
  oldestTimestamp: string;
  newestTimestamp: string;
  timeSpanSeconds: number;
  currentPrice: number;
  oneMinuteChange: number | null;
  fiveMinuteChange: number | null;
}

export interface ScannerDiagnostics {
  currentSession: MarketSessionType;
  currentFeed: string;
  activeFeed?: string;
  isExtendedHours: boolean;
  extendedHoursDataReceiving: boolean;
  liveTradeEvents: number;
  liveBarEvents: number;
  liveUpdatedBarEvents: number;
  wsMessagesTotal: number;
  wsLastMessageTime: string | null;
  wsLastError: string | null;
  subscribedSymbols: string[];
  symbolsWith1mHistory: number;
  symbolsWith5mHistory: number;
  timestampSpanSamples: TimestampSpanSample | null;
  activeSamples?: TimestampSpanSample[];
}

export interface ScannerStatus {
  connected: boolean;
  marketOpen: boolean;
  clock?: MarketClock;
  sessionInfo?: MarketSessionInfo;
  feed: string;
  activeFeed?: string;
  universeSize: number;
  stocksTracked: number;
  monitoredSymbols: number;
  scanProgress: ScannerProgress;
  alertCount: number;
  settings?: ScannerSettings;
  diagnostics?: ScannerDiagnostics;
  error?: string;
}

export const DEFAULT_SETTINGS: ScannerSettings = {
  minPrice: 0.5,
  maxPrice: 50.0,
  minDailyChangePct: 4,
  min1mChangePct: 0,
  min5mChangePct: 2,
  minVolume: 10_000,
  minDollarVolume: 50_000,
  minRelVolume: 1.5,
  minMomentumScore: 40,
  maxFloat: null,
  minMarketCap: null,
};

// Legacy compatibility types
export interface StockMetrics {
  ticker: string;
  price: number;
  dailyChangePct: number;
  change1mPct: number;
  change5mPct: number;
  volume: number;
  relVolume: number;
  dayHigh: number;
  distanceFromHighPct: number;
  momentumScore: number;
  triggers: string[];
  vwap: number | null;
  marketCap: number | null;
  float: number | null;
  updatedAt: number;
}

export interface AlertEvent {
  id: string;
  time: number;
  ticker: string;
  price: number;
  changePct: number;
  volume: number;
  relVolume: number;
  momentumScore: number;
  reasons: string[];
}

export type MarketStatus = 'PREMARKET' | 'OPEN' | 'AFTER_HOURS' | 'CLOSED';
export type ConnectionStatus = 'LIVE' | 'CONNECTING' | 'ERROR' | 'NO_API_KEY';

export interface SnapshotMessage {
  type: 'snapshot';
  data: {
    stocks: StockMetrics[];
    marketStatus: MarketStatus;
    connectionStatus: ConnectionStatus;
    timestamp: number;
    totalScanned: number;
    totalAlerts: number;
    universeSize: number;
    stocksWithData: number;
  };
}

export interface AlertMessage {
  type: 'alert';
  data: AlertEvent;
}

export interface MarketStatusMessage {
  type: 'market_status';
  data: MarketStatus;
}

export interface ConnectionStatusMessage {
  type: 'connection_status';
  data: ConnectionStatus;
}

export interface ErrorMessage {
  type: 'error';
  data: { message: string };
}

export interface SettingsMessage {
  type: 'settings';
  data: ScannerSettings;
}

export type ClientMessage =
  | SnapshotMessage
  | AlertMessage
  | MarketStatusMessage
  | ConnectionStatusMessage
  | ErrorMessage
  | SettingsMessage;
