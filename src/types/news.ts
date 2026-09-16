import type { DataFreshness, MomentumSignal } from './scanner';

export type CatalystType = 'HIGH IMPACT' | 'CATALYST' | 'GENERAL';

export type RecencyCategory = 'BREAKING' | 'RECENT' | 'OLDER' | 'ARCHIVED';

export type ReactionStatus = 'WAITING FOR DATA' | 'TRACKING' | 'REACTION AVAILABLE' | 'NO DATA';

export type NewsDirectionSignal = 'NEWS → MOMENTUM' | 'NEWS → SELLING PRESSURE' | 'NEWS ONLY';

export interface PriceReaction {
  priceAtNews: number;
  newsTime: number;
  reaction30s?: number | null; // % change
  reaction1m?: number | null;  // % change
  reaction5m?: number | null;  // % change
  reaction10m?: number | null; // % change
  dataStatus: DataFreshness;   // LIVE, SEEDED, STALE
  status: ReactionStatus;
  direction: NewsDirectionSignal;
  inActiveWsStream?: boolean;
}

export interface NewsAlert {
  type: 'news_alert';
  alertType: 'NEWS_MOMENTUM' | 'NEWS_SELLING';
  title: string;
  symbol: string;
  headline: string;
  articleId: string;
  m1?: number | null;
  m5?: number | null;
  rvol?: number | null;
  signal?: MomentumSignal;
  price?: number;
  createdAt: string;
}

export interface NewsArticle {
  id: string;
  headline: string;
  summary: string;
  author?: string;
  source?: string;
  url: string;
  createdAt: string; // ISO string
  updatedAt?: string;
  symbols: string[];
  catalystType: CatalystType;
  catalystKeywords: string[];
  // Price reactions mapped by symbol
  reactions?: Record<string, PriceReaction>;
  // Associated stock snapshot for prominent display
  stockSnapshots?: Record<
    string,
    {
      price: number;
      dailyChange: number | null;
      oneMinuteChange: number | null;
      fiveMinuteChange: number | null;
      relativeVolume: number | null;
      score: number;
      signal?: MomentumSignal;
      freshness?: DataFreshness;
      triggers: string[];
    }
  >;
}

export interface NewsEngineStatus {
  connected: boolean;
  totalArticles: number;
  trackedSymbolsWithNews: number;
  lastArticleTime: string | null;
  error?: string | null;
}
