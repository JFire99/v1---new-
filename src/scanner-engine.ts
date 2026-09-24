import WebSocket from 'ws';
import type {
  ScannerSettings,
  StockData,
  MarketClock,
  ScannerProgress,
  ScannerStatus,
  MarketSessionInfo,
  ScannerDiagnostics,
  TimestampSpanSample,
  MomentumSignal,
  DataFreshness,
} from './types/scanner';
import { DEFAULT_SETTINGS } from './types/scanner';
import { getMarketSession } from './market-session';
import type { NewsEngine, StockSnapshotForNews } from './news-engine';

interface PricePoint {
  t: number;
  p: number;
  v?: number;
}

interface StockInternal {
  symbol: string;
  name: string;
  price: number;
  previousClose: number | null;
  dailyChange: number | null;
  oneMinuteChange: number | null;
  twoMinuteChange: number | null;
  fiveMinuteChange: number | null;
  volume: number;
  dollarVolume: number;
  previousDailyVolume: number | null;
  relativeVolume: number | null;
  volumeAcceleration: number | null;
  minuteVolume: number | null;
  dayOpen?: number | null;
  dayHigh: number;
  distanceFromHigh: number | null;
  score: number;
  signal: MomentumSignal;
  triggers: string[];
  lastUpdate: string;
  history: PricePoint[];
  lastWsTime?: number;
  lastSeedTime?: number;
  alertSent: boolean;
  isValid: boolean;
}

export class Scanner {
  private key: string;
  private secret: string;
  private feed: string;
  private emit: (msg: any) => void;

  public sessionInfo: MarketSessionInfo;
  public calendarHolidays = new Set<string>();
  private lastCalendarFetch = 0;
  private currentWsUrl = '';
  private extendedHoursEvents = 0;
  private lastExtendedHoursEventTime = 0;

  private universe: string[] = [];
  private assetNames = new Map<string, string>();
  private stocks = new Map<string, StockInternal>();
  private ws: WebSocket | null = null;
  private auth = false;
  private sub = new Set<string>();
  private scanTimer: any = null;
  private clockTimer: any = null;
  private rotateTimer: any = null;
  private diagnosticTimer: any = null;
  private busy = false;
  private alerts = 0;

  public diagnostics = {
    liveTradeEvents: 0,
    liveBarEvents: 0,
    liveUpdatedBarEvents: 0,
    wsMessagesTotal: 0,
    wsLastMessageTime: null as string | null,
    wsLastError: null as string | null,
    subscribedSymbols: [] as string[],
    symbolsWith1mHistory: 0,
    symbolsWith5mHistory: 0,
    sampleSymbolHistory: null as TimestampSpanSample | null,
  };

  private clock: MarketClock = {
    isOpen: false,
    timestamp: '',
    nextOpen: '',
    nextClose: '',
  };

  private progress: ScannerProgress = {
    processed: 0,
    received: 0,
    universeSize: 0,
    scanning: false,
  };

  public settings: ScannerSettings = { ...DEFAULT_SETTINGS };
  private isSeeding = false;
  private seededSymbols = new Map<string, number>();
  private newsEngine: NewsEngine | null = null;

  constructor(key: string, secret: string, feed: string, emit: (msg: any) => void) {
    this.key = key;
    this.secret = secret;
    this.feed = feed || 'iex';
    this.emit = emit;
    this.sessionInfo = getMarketSession(new Date(), undefined, this.feed);
  }

  public setNewsEngine(engine: NewsEngine) {
    this.newsEngine = engine;
  }

  public getSnapshotForNews(symbol: string): StockSnapshotForNews | null {
    const s = this.stocks.get(symbol.toUpperCase());
    if (!s) return null;
    return {
      price: s.price,
      dailyChange: s.dailyChange,
      oneMinuteChange: s.oneMinuteChange,
      fiveMinuteChange: s.fiveMinuteChange,
      relativeVolume: s.relativeVolume,
      score: s.score,
      signal: s.signal,
      freshness: this.getFreshness(s),
      triggers: s.triggers,
      history: s.history,
      lastWsTime: s.lastWsTime,
      lastSeedTime: s.lastSeedTime,
    };
  }

  private headers() {
    return {
      'APCA-API-KEY-ID': this.key,
      'APCA-API-SECRET-KEY': this.secret,
    };
  }

  private async get(url: string) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(url, { headers: this.headers() });
        if (res.ok) {
          return await res.json();
        }
        if (![429, 500, 502, 503, 504].includes(res.status) || attempt === 3) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
      } catch (err: any) {
        if (attempt === 3) throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  public async start() {
    try {
      await this.updateClock();
    } catch (err: any) {
      console.error('[JFIRE] Initial clock error:', err.message);
    }

    try {
      await this.loadUniverse();
    } catch (err: any) {
      console.error('[JFIRE] Universe load error:', err.message);
    }

    this.connectWs();

    void this.scan();

    this.scanTimer = setInterval(() => void this.scan(), 60000);
    this.clockTimer = setInterval(() => void this.updateClock(), 30000);
    this.rotateTimer = setInterval(() => this.rotate(), 30000);
    this.diagnosticTimer = setInterval(() => this.logDiagnostics(), 15000);
  }

  public stop() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.clockTimer) clearInterval(this.clockTimer);
    if (this.rotateTimer) clearInterval(this.rotateTimer);
    if (this.diagnosticTimer) clearInterval(this.diagnosticTimer);
    try {
      this.ws?.close();
    } catch {}
  }

  public updateSettings(newSettings: Partial<ScannerSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    // Recalculate validity for all stocks
    for (const stock of this.stocks.values()) {
      this.evaluate(stock);
    }
    this.broadcast();
    this.emitStatus();
  }

  public async updateClock() {
    try {
      const data = await this.get('https://paper-api.alpaca.markets/v2/clock');
      if (data && typeof data.is_open === 'boolean') {
        this.clock = {
          isOpen: data.is_open,
          timestamp: data.timestamp || new Date().toISOString(),
          nextOpen: data.next_open || '',
          nextClose: data.next_close || '',
        };
      }
    } catch (err: any) {
      console.error('[JFIRE] Clock update error:', err.message);
    }

    // Periodically refresh calendar holidays (every 6 hours)
    if (Date.now() - this.lastCalendarFetch > 6 * 3600 * 1000) {
      await this.refreshCalendarHolidays();
    }

    const prevSession = this.sessionInfo.session;
    this.sessionInfo = getMarketSession(new Date(), this.calendarHolidays, this.feed);

    if (this.sessionInfo.session !== prevSession) {
      console.log(`[JFIRE] Market session changed: ${prevSession} -> ${this.sessionInfo.session}`);
      this.connectWs();
      void this.scan();
    }

    this.emitStatus();
  }

  private async refreshCalendarHolidays() {
    try {
      const now = new Date();
      const start = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
      const end = new Date(now.getTime() + 30 * 86400000).toISOString().slice(0, 10);
      const days = await this.get(
        `https://paper-api.alpaca.markets/v2/calendar?start=${start}&end=${end}`
      );
      if (Array.isArray(days)) {
        this.calendarHolidays.clear();
        // Days absent from the trading calendar during weekdays are holidays
        const openDates = new Set<string>(days.map((d: any) => d.date));
        // Check surrounding dates
        for (let i = -7; i <= 30; i++) {
          const d = new Date(now.getTime() + i * 86400000);
          const dayOfWeek = d.getUTCDay();
          const iso = d.toISOString().slice(0, 10);
          if (dayOfWeek >= 1 && dayOfWeek <= 5 && !openDates.has(iso)) {
            this.calendarHolidays.add(iso);
          }
        }
        this.lastCalendarFetch = Date.now();
      }
    } catch (err: any) {
      console.warn('[JFIRE] Calendar fetch notice:', err.message);
    }
  }

  private isGenuineCommonStock(a: any): boolean {
    if (!a || !a.tradable || a.status !== 'active' || a.class !== 'us_equity') {
      return false;
    }

    const ex = String(a.exchange || '').toUpperCase();
    if (!['NASDAQ', 'NYSE', 'AMEX', 'NYSEAMERICAN'].includes(ex)) {
      return false; // Exclude OTC, ARCA (ETFs), BATS (ETFs)
    }

    const sym = String(a.symbol || '').toUpperCase();
    const name = String(a.name || '').toLowerCase();

    // Exclude test symbols
    if (
      sym.startsWith('TEST') ||
      ['ZVZZT', 'ZWZZT', 'ZXZZT', 'NTEST'].includes(sym) ||
      name.includes('test security') ||
      name.includes('test symbol')
    ) {
      return false;
    }

    // Exclude symbols with structural non-common share tags
    if (sym.includes('.PR') || sym.includes('-PR') || sym.includes('/PR')) return false;
    if (sym.includes('.WS') || sym.includes('-WS') || sym.includes('/WS')) return false;
    if (sym.includes('.RT') || sym.includes('-RT') || sym.includes('/RT')) return false;
    if (sym.includes('.U') || sym.includes('-U') || sym.includes('/U')) return false;
    if (sym.includes('.W') || sym.includes('-W') || sym.includes('/W')) return false;
    if (sym.includes('.R') || sym.includes('-R') || sym.includes('/R')) return false;
    if (/[+*^]/.test(sym)) return false;

    // NASDAQ 5th letter convention for non-common shares
    if (sym.length === 5 && ['W', 'R', 'U', 'Z', 'P'].includes(sym[4])) {
      return false;
    }

    // Keyword filtering from asset metadata (name)
    const excludePatterns = [
      /\bwarrants?\b/i,
      /\bwt\b/i,
      /\bwts\b/i,
      /\bwt exp\b/i,
      /\brights?\b/i,
      /\brts?\b/i,
      /\bunits?\b/i,
      /\bpreferred\b/i,
      /\bpfd\b/i,
      /\bpr\s+shs\b/i,
      /\bdepositary\b/i,
      /\badr\b/i,
      /\badrs\b/i,
      /\bads\b/i,
      /\bamerican depositary\b/i,
      /\betf\b/i,
      /\betfs\b/i,
      /\betn\b/i,
      /\betns\b/i,
      /\bfund\b/i,
      /\bfunds\b/i,
      /\btrust\b/i,
      /\btrusts\b/i,
      /\bnotes?\b/i,
      /\bdebentures?\b/i,
      /\bbond\b/i,
      /\bbonds\b/i,
      /\bindex\b/i,
      /\bportfolio\b/i,
      /\bacquisition corp/i,
      /\bblank check\b/i,
      /\bspac\b/i,
      /\bseries\s+[a-z0-9]/i,
      /\bshares of beneficial interest\b/i,
      /\bperpetual\b/i,
    ];

    for (const pat of excludePatterns) {
      if (pat.test(name)) return false;
    }

    return true;
  }

  private async loadUniverse() {
    const assets = await this.get(
      'https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity'
    );
    if (!Array.isArray(assets)) return;

    this.universe = [];
    this.assetNames.clear();

    for (const a of assets) {
      if (this.isGenuineCommonStock(a)) {
        this.universe.push(a.symbol);
        if (a.name) {
          this.assetNames.set(a.symbol, a.name);
        }
      }
    }

    this.progress.universeSize = this.universe.length;
    this.emitStatus();
  }

  private getMarketMinutesElapsed(): number {
    try {
      // Calculate minutes elapsed since 9:30 AM Eastern
      const now = new Date();
      const nyTimeStr = now.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      });
      const [h, m] = nyTimeStr.split(':').map(Number);
      const minutesSinceMidnight = h * 60 + m;
      const openMinutes = 9 * 60 + 30; // 9:30 AM = 570
      return minutesSinceMidnight - openMinutes;
    } catch {
      return 180;
    }
  }

  public async scan() {
    if (this.busy || !this.universe.length) return;
    this.busy = true;

    this.progress = {
      processed: 0,
      received: 0,
      universeSize: this.universe.length,
      scanning: true,
    };
    this.emit({ type: 'scanProgress', data: { ...this.progress } });

    const batchSize = 100;
    const snapshotFeed = this.sessionInfo.session === 'OVERNIGHT' ? 'overnight' : this.feed;
    for (let i = 0; i < this.universe.length; i += batchSize) {
      const chunk = this.universe.slice(i, i + batchSize);
      try {
        const snapshots = await this.get(
          `https://data.alpaca.markets/v2/stocks/snapshots?symbols=${encodeURIComponent(
            chunk.join(',')
          )}&feed=${snapshotFeed}`
        );

        if (snapshots && typeof snapshots === 'object') {
          const keys = Object.keys(snapshots);
          for (const sym of keys) {
            this.applySnapshot(sym, snapshots[sym]);
          }
          this.progress.received += keys.length;
        }
      } catch (err: any) {
        console.error(`[JFIRE] Scan batch error at index ${i}:`, err.message);
      }

      this.progress.processed = Math.min(i + chunk.length, this.universe.length);
      this.emit({ type: 'scanProgress', data: { ...this.progress } });

      // Periodically broadcast updates every 500 stocks to keep UI lively
      if ((i + chunk.length) % 500 === 0 || this.progress.processed >= this.universe.length) {
        this.rotate();
        this.broadcast();
      }
    }

    this.progress.scanning = false;
    this.busy = false;
    this.emit({ type: 'scanProgress', data: { ...this.progress } });
    this.rotate();
    this.broadcast();
  }

  private applySnapshot(sym: string, v: any) {
    if (!v) return;

    // 1. Current Price resolution
    let p: number | null = null;
    if (typeof v.latestTrade?.p === 'number' && Number.isFinite(v.latestTrade.p) && v.latestTrade.p > 0) {
      p = v.latestTrade.p;
    } else if (typeof v.minuteBar?.c === 'number' && Number.isFinite(v.minuteBar.c) && v.minuteBar.c > 0) {
      p = v.minuteBar.c;
    } else if (typeof v.dailyBar?.c === 'number' && Number.isFinite(v.dailyBar.c) && v.dailyBar.c > 0) {
      p = v.dailyBar.c;
    }

    if (!p || p <= 0) return;

    // 2. Previous Close resolution strictly from prevDailyBar.c
    let prevClose: number | null = null;
    if (
      typeof v.prevDailyBar?.c === 'number' &&
      Number.isFinite(v.prevDailyBar.c) &&
      v.prevDailyBar.c > 0.0001
    ) {
      prevClose = v.prevDailyBar.c;
    }

    // 3. Daily Change %
    let dailyChange: number | null = null;
    if (prevClose !== null) {
      const rawPct = ((p - prevClose) / prevClose) * 100;
      // Filter out obviously corrupted or unadjusted reverse split data
      if (Number.isFinite(rawPct) && rawPct > -99.9 && rawPct < 3000) {
        dailyChange = Number(rawPct.toFixed(2));
      }
    }

    // 4. Volume & Dollar Volume
    const volume =
      typeof v.dailyBar?.v === 'number' && Number.isFinite(v.dailyBar.v) && v.dailyBar.v >= 0
        ? v.dailyBar.v
        : 0;
    const dollarVolume = Number((p * volume).toFixed(2));

    // 5. Day High & Proximity
    const reportedHigh =
      typeof v.dailyBar?.h === 'number' && Number.isFinite(v.dailyBar.h) ? v.dailyBar.h : p;
    const dayHigh = Math.max(reportedHigh, p);
    const distanceFromHigh =
      dayHigh > 0 ? Number((((dayHigh - p) / dayHigh) * 100).toFixed(2)) : null;

    // 6. RVOL calculation from prevDailyBar.v
    // Session-aware: Only compute during REGULAR session (09:30–16:00 ET).
    // Pre-market, after-hours, and overnight volume cannot be compared to a regular-session expected-volume curve,
    // so return null rather than creating misleading RVOL values.
    let relativeVolume: number | null = null;
    let prevDailyVolume: number | null = null;
    if (
      typeof v.prevDailyBar?.v === 'number' &&
      Number.isFinite(v.prevDailyBar.v) &&
      v.prevDailyBar.v >= 10000
    ) {
      prevDailyVolume = v.prevDailyBar.v;
    }

    if (this.sessionInfo.session === 'REGULAR') {
      if (prevDailyVolume !== null && prevDailyVolume > 0 && volume > 0) {
        let expectedVolume = prevDailyVolume;
        const elapsed = this.getMarketMinutesElapsed();
        if (elapsed > 0 && elapsed < 390) {
          const fraction = Math.max(0.05, Math.min(1.0, elapsed / 390));
          expectedVolume = prevDailyVolume * fraction;
        }
        // Require expectedVolume to be at least 5,000 shares for a valid baseline
        if (expectedVolume >= 5000) {
          const rawRvol = volume / expectedVolume;
          if (Number.isFinite(rawRvol) && rawRvol > 0) {
            relativeVolume = Number(rawRvol.toFixed(2));
          }
        }
      }
    }

    // Existing or new stock record
    const existing = this.stocks.get(sym);
    const now = Date.now();
    const history: PricePoint[] = existing ? [...existing.history] : [];
    const dayOpen = typeof v.dailyBar?.o === 'number' && Number.isFinite(v.dailyBar.o) && v.dailyBar.o > 0 ? v.dailyBar.o : (existing?.dayOpen ?? null);

    const minuteVol =
      typeof v.minuteBar?.v === 'number' && Number.isFinite(v.minuteBar.v) && v.minuteBar.v > 0
        ? v.minuteBar.v
        : null;

    // Incorporate genuine timestamped minute bar AND trade from snapshot
    if (v.minuteBar?.t && typeof v.minuteBar.c === 'number' && v.minuteBar.c > 0) {
      const barTime = new Date(v.minuteBar.t).getTime();
      if (Number.isFinite(barTime)) {
        if (!history.some((pt) => Math.abs(pt.t - barTime) < 1000)) {
          history.push({ t: barTime, p: v.minuteBar.c, v: minuteVol ?? undefined });
        }
      }
    }
    if (v.latestTrade?.t && typeof v.latestTrade.p === 'number' && v.latestTrade.p > 0) {
      const tradeTime = new Date(v.latestTrade.t).getTime();
      if (Number.isFinite(tradeTime)) {
        if (!history.some((pt) => Math.abs(pt.t - tradeTime) < 1000)) {
          history.push({ t: tradeTime, p: v.latestTrade.p });
        }
      }
    }

    history.sort((a, b) => a.t - b.t);
    // Retain up to 60 most recent price points (preserving session history)
    const trimmedHistory = history.length > 60 ? history.slice(history.length - 60) : history;

    // Use latest price point timestamp as reference time for momentum, or now
    const latestPt = trimmedHistory.length > 0 ? trimmedHistory[trimmedHistory.length - 1] : null;
    const refTime = latestPt ? latestPt.t : now;

    let oneMinuteChange = this.calcMomentum(trimmedHistory, refTime, 55000, 180000, p);
    let twoMinuteChange = this.calcMomentum(trimmedHistory, refTime, 115000, 300000, p);
    let fiveMinuteChange = this.calcMomentum(trimmedHistory, refTime, 270000, 600000, p);

    // If existing had valid momentum and no newer points were added, preserve it
    if (oneMinuteChange === null && existing?.oneMinuteChange !== null && existing?.oneMinuteChange !== undefined) {
      oneMinuteChange = existing.oneMinuteChange;
    }
    if (twoMinuteChange === null && existing?.twoMinuteChange !== null && existing?.twoMinuteChange !== undefined) {
      twoMinuteChange = existing.twoMinuteChange;
    }
    if (fiveMinuteChange === null && existing?.fiveMinuteChange !== null && existing?.fiveMinuteChange !== undefined) {
      fiveMinuteChange = existing.fiveMinuteChange;
    }

    const stock: StockInternal = {
      symbol: sym,
      name: this.assetNames.get(sym) || '',
      price: p,
      previousClose: prevClose,
      dailyChange,
      oneMinuteChange,
      twoMinuteChange,
      fiveMinuteChange,
      volume,
      dollarVolume,
      previousDailyVolume: prevDailyVolume,
      relativeVolume,
      volumeAcceleration: null,
      minuteVolume: minuteVol,
      dayOpen,
      dayHigh,
      distanceFromHigh,
      score: 0,
      signal: '👀 WATCH',
      triggers: [],
      lastUpdate: new Date().toISOString(),
      history: trimmedHistory,
      lastWsTime: existing?.lastWsTime,
      lastSeedTime: existing?.lastSeedTime,
      alertSent: existing ? existing.alertSent : false,
      isValid: false,
    };

    stock.volumeAcceleration = this.calcVolumeAcceleration(stock, minuteVol ?? undefined);
    this.evaluate(stock);
    this.stocks.set(sym, stock);
  }

  private calcMomentum(
    history: PricePoint[],
    currentTime: number,
    minAgeMs: number,
    maxAgeMs: number,
    currentPrice: number
  ): number | null {
    if (!history || history.length < 2 || !currentPrice || currentPrice <= 0) {
      return null;
    }

    // Find the most recent valid price point that is at least minAgeMs old (up to maxAgeMs)
    let bestPoint: PricePoint | null = null;
    for (let i = history.length - 1; i >= 0; i--) {
      const pt = history[i];
      const age = currentTime - pt.t;
      if (age >= minAgeMs && age <= maxAgeMs) {
        if (!bestPoint || pt.t > bestPoint.t) {
          bestPoint = pt;
        }
      }
    }

    if (!bestPoint || typeof bestPoint.p !== 'number' || bestPoint.p <= 0) {
      return null;
    }

    const pct = ((currentPrice - bestPoint.p) / bestPoint.p) * 100;
    if (!Number.isFinite(pct)) return null;
    return Number(pct.toFixed(2));
  }

  private calcVolumeAcceleration(s: StockInternal, currentMinuteVol?: number): number | null {
    const pastVols = s.history
      .map((pt) => pt.v)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);

    const latestVol =
      typeof currentMinuteVol === 'number' && currentMinuteVol > 0
        ? currentMinuteVol
        : pastVols.length > 0
        ? pastVols[pastVols.length - 1]
        : null;

    if (latestVol === null || latestVol <= 0) return null;

    if (pastVols.length >= 2) {
      const priorVols =
        pastVols[pastVols.length - 1] === latestVol
          ? pastVols.slice(0, pastVols.length - 1)
          : pastVols;
      if (priorVols.length > 0) {
        const avgPrior = priorVols.reduce((sum, v) => sum + v, 0) / priorVols.length;
        if (avgPrior >= 50) {
          const ratio = latestVol / avgPrior;
          return Number(ratio.toFixed(2));
        }
      }
    }

    if (this.sessionInfo.session === 'REGULAR') {
      const elapsed = this.getMarketMinutesElapsed();
      if (elapsed >= 5 && s.volume > 0) {
        const avgSessionMinVol = s.volume / elapsed;
        if (avgSessionMinVol >= 50) {
          const ratio = latestVol / avgSessionMinVol;
          return Number(ratio.toFixed(2));
        }
      }
    }

    return null;
  }

  private async seedHistoricalBars(symbols: string[]) {
    if (!symbols.length || this.isSeeding) return;
    this.isSeeding = true;
    const feedToUse = this.feed || 'iex';
    const now = Date.now();

    // Filter to symbols that actually need seeding (not seeded within 3 min or lacking history)
    const toFetch = symbols.filter((sym) => {
      const lastSeed = this.seededSymbols.get(sym) || 0;
      const s = this.stocks.get(sym);
      if (!s) return false;
      return now - lastSeed > 180000 || s.history.length < 2;
    });

    if (!toFetch.length) {
      this.isSeeding = false;
      return;
    }

    try {
      const batchSize = 5;
      for (let i = 0; i < toFetch.length; i += batchSize) {
        const batch = toFetch.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (sym) => {
            const s = this.stocks.get(sym);
            if (!s) return;
            try {
              const data = await this.get(
                `https://data.alpaca.markets/v2/stocks/${encodeURIComponent(
                  sym
                )}/bars?timeframe=1Min&limit=15&sort=desc&feed=${feedToUse}`
              );
              this.seededSymbols.set(sym, Date.now());

              if (Array.isArray(data?.bars) && data.bars.length > 0) {
                s.lastSeedTime = Date.now();
                // Bars are newest first due to sort=desc, reverse to chronological order
                const chronological = [...data.bars].reverse();
                for (const b of chronological) {
                  if (typeof b?.c === 'number' && b.c > 0 && b.t) {
                    const barTime = new Date(b.t).getTime();
                    const barVol = typeof b.v === 'number' && b.v >= 0 ? b.v : undefined;
                    if (Number.isFinite(barTime)) {
                      if (!s.history.some((pt) => Math.abs(pt.t - barTime) < 1000)) {
                        s.history.push({ t: barTime, p: b.c, v: barVol });
                      }
                    }
                  }
                }

                s.history.sort((a, b) => a.t - b.t);
                if (s.history.length > 60) {
                  s.history = s.history.slice(s.history.length - 60);
                }

                const latestPt = s.history[s.history.length - 1];
                const refTime = latestPt ? latestPt.t : Date.now();

                s.oneMinuteChange = this.calcMomentum(s.history, refTime, 55000, 180000, s.price);
                s.twoMinuteChange = this.calcMomentum(s.history, refTime, 115000, 300000, s.price);
                s.fiveMinuteChange = this.calcMomentum(s.history, refTime, 270000, 600000, s.price);
                s.volumeAcceleration = this.calcVolumeAcceleration(s);
                this.evaluate(s);
                this.emit({ type: 'stockUpdate', stock: this.toPublicStock(s) });
              }
            } catch {
              // Ignore individual ticker errors
            }
          })
        );
      }
      this.broadcast();
    } catch (err: any) {
      console.warn('[JFIRE] Seeding bars notice:', err.message);
    } finally {
      this.isSeeding = false;
    }
  }

  private evaluate(s: StockInternal) {
    // 1. Check validity & liquidity:
    const hasValidPrice = s.price >= this.settings.minPrice && s.price <= this.settings.maxPrice;
    const hasValidDaily = s.dailyChange !== null && Number.isFinite(s.dailyChange);
    const hasLiquidity =
      s.volume >= this.settings.minVolume && s.dollarVolume >= this.settings.minDollarVolume;

    s.isValid = hasValidPrice && hasValidDaily && hasLiquidity;

    if (!s.isValid) {
      s.score = 0;
      s.signal = '⚪ STALE';
      s.triggers = [];
      return;
    }

    // 2. Normalization functions (output: 0 - 100)
    const norm5m = (pct: number): number => {
      if (pct <= 0) return 0;
      if (pct >= 6.0) return 100;
      if (pct >= 3.0) return 70 + ((pct - 3.0) / 3.0) * 30;
      if (pct >= 1.0) return 30 + ((pct - 1.0) / 2.0) * 40;
      return (pct / 1.0) * 30;
    };

    const norm1m = (pct: number): number => {
      if (pct <= 0) return 0;
      if (pct >= 3.0) return 100;
      if (pct >= 1.5) return 70 + ((pct - 1.5) / 1.5) * 30;
      if (pct >= 0.5) return 30 + ((pct - 0.5) / 1.0) * 40;
      return (pct / 0.5) * 30;
    };

    const normRvol = (rvol: number): number => {
      if (rvol <= 1.0) return 0;
      if (rvol >= 6.0) return 100;
      if (rvol >= 3.0) return 65 + ((rvol - 3.0) / 3.0) * 35;
      if (rvol >= 1.5) return 25 + ((rvol - 1.5) / 1.5) * 40;
      return ((rvol - 1.0) / 0.5) * 25;
    };

    const normDaily = (pct: number): number => {
      if (pct <= 0) return 0;
      if (pct >= 50.0) return 100;
      if (pct >= 20.0) return 60 + ((pct - 20.0) / 30.0) * 40;
      if (pct >= 5.0) return 25 + ((pct - 5.0) / 15.0) * 35;
      return (pct / 5.0) * 25;
    };

    const normAccel = (accel: number): number => {
      if (accel <= 1.0) return 0;
      if (accel >= 5.0) return 100;
      if (accel >= 2.5) return 65 + ((accel - 2.5) / 2.5) * 35;
      if (accel >= 1.5) return 30 + ((accel - 1.5) / 1.0) * 35;
      return ((accel - 1.0) / 0.5) * 30;
    };

    // Breakout and Distance from day high
    let breakoutScore = 0;
    let distScore = 0;
    if (s.distanceFromHigh !== null && Number.isFinite(s.distanceFromHigh)) {
      if (s.distanceFromHigh <= 0.05) breakoutScore = 100;
      else if (s.distanceFromHigh <= 0.5) breakoutScore = 80;
      else if (s.distanceFromHigh <= 1.5) breakoutScore = 50;
      else if (s.distanceFromHigh <= 3.0) breakoutScore = 25;

      distScore = Math.max(0, Math.min(100, 100 - s.distanceFromHigh * 10));
    }

    // Dynamic weight redistribution
    // Baseline model weights:
    // 1. 5-minute momentum: 25%
    // 2. 1-minute momentum: 25%
    // 3. Relative volume: 20%
    // 4. Daily percentage change: 10%
    // 5. Volume acceleration: 10%
    // 6. New high / breakout: 5%
    // 7. Distance from day high: 5%
    // When RVOL or Volume Acceleration are unavailable, unallocated weight is strictly
    // redirected to active momentum metrics (5M/1M) and breakout rather than daily gain,
    // ensuring daily gain alone can never produce a high score.
    const hasRvol = s.relativeVolume !== null && Number.isFinite(s.relativeVolume) && s.relativeVolume > 0;
    const hasAccel = s.volumeAcceleration !== null && Number.isFinite(s.volumeAcceleration) && s.volumeAcceleration > 0;

    let unallocated = 0;
    if (!hasRvol) unallocated += 0.20;
    if (!hasAccel) unallocated += 0.10;

    const w5m = 0.25 + unallocated * 0.45;
    const w1m = 0.25 + unallocated * 0.45;
    const wDaily = 0.10;
    const wRvol = hasRvol ? 0.20 : 0;
    const wAccel = hasAccel ? 0.10 : 0;
    const wBreakout = 0.05 + unallocated * 0.05;
    const wDist = 0.05 + unallocated * 0.05;

    const sub5m = s.fiveMinuteChange !== null && Number.isFinite(s.fiveMinuteChange) ? norm5m(s.fiveMinuteChange) : 0;
    const sub1m = s.oneMinuteChange !== null && Number.isFinite(s.oneMinuteChange) ? norm1m(s.oneMinuteChange) : 0;
    const subDaily = s.dailyChange !== null && Number.isFinite(s.dailyChange) ? normDaily(s.dailyChange) : 0;
    const subRvol = hasRvol ? normRvol(s.relativeVolume!) : 0;
    const subAccel = hasAccel ? normAccel(s.volumeAcceleration!) : 0;

    const rawScore =
      w5m * sub5m +
      w1m * sub1m +
      wDaily * subDaily +
      wRvol * subRvol +
      wAccel * subAccel +
      wBreakout * breakoutScore +
      wDist * distScore;

    s.score = Math.round(Math.max(0, Math.min(100, rawScore)));

    // 3. Signal Classifications:
    // 🔥 EXPLOSIVE, 🚀 STRONG MOMENTUM, 🟢 BUILDING, 👀 WATCH, ⚪ STALE
    const m1 = s.oneMinuteChange;
    const m5 = s.fiveMinuteChange;
    const daily = s.dailyChange ?? 0;
    const rvol = s.relativeVolume;
    const accel = s.volumeAcceleration;

    // Tolerance of 0.05% around zero to prevent tiny +/-0.01% noise from flapping states
    const EPSILON = 0.05;

    // Has valid recent momentum data
    const hasMomentumData = m1 !== null || m5 !== null;

    // ⚪ STALE:
    // - Recent momentum is flat/negative (both <= EPSILON)
    // - OR 1M <= 0 AND/OR 5M <= 0 with insufficient positive confirmation
    // - OR large daily gain (>= 5%) but current momentum is flat/fading
    // - OR no valid momentum history
    const isStale =
      !hasMomentumData ||
      // High daily runner that is flat or retreating intraday
      (daily >= 5.0 && ((m1 !== null && m1 <= EPSILON) || (m5 !== null && m5 <= EPSILON))) ||
      // Both timeframes flat or negative
      ((m1 === null || m1 <= EPSILON) && (m5 === null || m5 <= EPSILON)) ||
      // 5M materially negative (<= -0.5%) and 1M without strong breakout confirmation (< 1.5%)
      (m5 !== null && m5 <= -0.5 && (m1 === null || m1 < 1.5)) ||
      // 1M negative and 5M flat/negative
      (m1 !== null && m1 <= -EPSILON && (m5 === null || m5 <= EPSILON));

    // 🔥 EXPLOSIVE:
    // - 1M >= +3% OR 5M >= +5%
    // - preferably positive confirmation from the other momentum timeframe (not materially negative)
    // - volume/RVOL confirmation strengthens the signal
    const isExplosive =
      !isStale &&
      // Core criteria: 1M >= 3% or 5M >= 5%
      (((m1 !== null && m1 >= 3.0 && (m5 === null || m5 > -EPSILON)) ||
        (m5 !== null && m5 >= 5.0 && (m1 === null || m1 > -EPSILON))) ||
        // Multi-timeframe surge with active volume/RVOL confirmation
        (m5 !== null &&
          m5 >= 3.5 &&
          m1 !== null &&
          m1 >= 2.0 &&
          (rvol !== null && rvol >= 1.5 || accel !== null && accel >= 1.5 || s.volume >= 50_000)));

    // 🚀 STRONG MOMENTUM:
    // - 1M >= +1% OR 5M >= +2%
    // - preferably both positive (not materially negative)
    const isStrong =
      !isStale &&
      !isExplosive &&
      (((m1 !== null && m1 >= 1.0 && (m5 === null || m5 > -EPSILON)) ||
        (m5 !== null && m5 >= 2.0 && (m1 === null || m1 > -EPSILON))) &&
        // Do not classify as STRONG if either timeframe is materially negative
        (m1 === null || m1 > -0.5) &&
        (m5 === null || m5 > -0.5));

    // 🟢 BUILDING:
    // - 1M > 0 AND 5M > 0 (using sensible tolerance > EPSILON)
    // - below STRONG thresholds
    // - strictly do not classify as BUILDING when 5M is materially negative (< -EPSILON)
    const isBuilding =
      !isStale &&
      !isExplosive &&
      !isStrong &&
      (m1 !== null && m1 > EPSILON && m5 !== null && m5 > EPSILON);

    // 👀 WATCH:
    // - mild/partial positive momentum, incomplete confirmation, or weak volume confirmation
    if (isStale) {
      s.signal = '⚪ STALE';
    } else if (isExplosive) {
      s.signal = '🔥 EXPLOSIVE';
    } else if (isStrong) {
      s.signal = '🚀 STRONG MOMENTUM';
    } else if (isBuilding) {
      s.signal = '🟢 BUILDING';
    } else {
      s.signal = '👀 WATCH';
    }

    // 4. Triggers:
    // 1M SURGE, 5M SURGE, VOLUME SURGE, HIGH RVOL, NEW HIGH, BREAKOUT, RUNNER, DAILY GAIN, 📰 NEWS, 🔥 NEWS + MOMENTUM
    const triggers: string[] = [];
    if (s.oneMinuteChange !== null && s.oneMinuteChange >= 1.5) triggers.push('1M SURGE');
    if (s.fiveMinuteChange !== null && s.fiveMinuteChange >= 3.0) triggers.push('5M SURGE');
    if (s.volumeAcceleration !== null && s.volumeAcceleration >= 2.0) triggers.push('VOLUME SURGE');
    if (s.relativeVolume !== null && s.relativeVolume >= 2.0) triggers.push('HIGH RVOL');
    if (s.distanceFromHigh !== null && s.distanceFromHigh < 0.05) triggers.push('NEW HIGH');
    if (s.distanceFromHigh !== null && s.distanceFromHigh <= 0.5 && (s.oneMinuteChange ?? 0) >= 0.5)
      triggers.push('BREAKOUT');
    if (s.dailyChange !== null && s.dailyChange >= 25) triggers.push('RUNNER');
    if (s.dailyChange !== null && s.dailyChange >= 10 && s.dailyChange < 25) triggers.push('DAILY GAIN');

    // News catalyst triggers
    const hasNews = this.newsEngine ? this.newsEngine.hasRecentNews(s.symbol, 120) : false;
    if (hasNews) {
      // Stock receives 📰 NEWS when it has relevant recent news
      triggers.push('📰 NEWS');

      // NEWS + MOMENTUM:
      // Only occurs when:
      // 1. Recent relevant news exists
      // 2. AND current momentum is genuinely positive (5M >= +2% OR 1M >= +1%)
      // 3. AND no materially negative timeframe (1M > -0.5% and 5M > -0.5%)
      // 4. AND not classified as STALE
      const isPositiveMomentum =
        ((m1 !== null && m1 >= 1.0) || (m5 !== null && m5 >= 2.0)) &&
        (m1 === null || m1 > -0.5) &&
        (m5 === null || m5 > -0.5) &&
        s.signal !== '⚪ STALE';

      // NEWS + SELLING PRESSURE:
      // When recent news exists AND (5M <= -1% OR 1M <= -1%)
      const isSellingPressure =
        (m5 !== null && m5 <= -1.0) ||
        (m1 !== null && m1 <= -1.0);

      if (isPositiveMomentum) {
        triggers.push('🔥 NEWS + MOMENTUM');
      } else if (isSellingPressure) {
        triggers.push('📉 NEWS + SELLING PRESSURE');
      }
      // If momentum is neutral, only '📰 NEWS' is added (NEWS ONLY)
    }

    s.triggers = triggers;

    // Trigger alert event on high momentum or explosive signal
    if ((s.score >= 70 || s.signal === '🔥 EXPLOSIVE') && !s.alertSent) {
      s.alertSent = true;
      this.alerts++;
      this.emit({ type: 'alert', stock: this.toPublicStock(s) });
    } else if (s.score < 50 && s.signal !== '🔥 EXPLOSIVE') {
      s.alertSent = false;
    }
  }

  private connectWs() {
    const targetWsUrl =
      this.sessionInfo.session === 'OVERNIGHT'
        ? 'wss://stream.data.alpaca.markets/v1beta1/overnight'
        : `wss://stream.data.alpaca.markets/v2/${this.feed}`;

    if (this.ws) {
      if (this.currentWsUrl === targetWsUrl) {
        return;
      }
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
      this.auth = false;
    }

    this.currentWsUrl = targetWsUrl;
    console.log(`[JFIRE] Connecting WebSocket to ${targetWsUrl} (session: ${this.sessionInfo.session})`);
    const ws = new WebSocket(targetWsUrl);
    this.ws = ws;

    ws.on('open', () => {
      ws.send(JSON.stringify({ action: 'auth', key: this.key, secret: this.secret }));
    });

    ws.on('message', (data) => {
      try {
        const msgs = JSON.parse(data.toString());
        if (Array.isArray(msgs)) {
          for (const m of msgs) {
            this.handleWsMessage(m);
          }
        }
      } catch (err: any) {
        console.error('[JFIRE] WS parse error:', err.message);
      }
    });

    ws.on('close', () => {
      if (this.ws === ws) {
        this.ws = null;
        this.auth = false;
        setTimeout(() => this.connectWs(), 5000);
      }
    });

    ws.on('error', (err: any) => {
      console.error('[JFIRE] WS error:', err.message);
    });
  }

  private handleWsMessage(m: any) {
    this.diagnostics.wsMessagesTotal++;
    this.diagnostics.wsLastMessageTime = new Date().toISOString();

    if (m?.T === 'success' && m.msg === 'authenticated') {
      this.auth = true;
      console.log(`[JFIRE] Alpaca WebSocket authenticated successfully (${this.getActiveFeedName()})`);
      this.emitStatus();
      this.rotate();
      return;
    }

    if (m?.T === 'subscription') {
      console.log(
        `[JFIRE] WS subscription confirmed: ${m.trades?.length || 0} trades, ${m.bars?.length || 0} bars, ${m.updatedBars?.length || 0} updatedBars, ${m.statuses?.length || 0} statuses`
      );
      return;
    }

    if (m?.T === 'error') {
      console.error('[JFIRE] WS error message received:', m);
      this.diagnostics.wsLastError = `${m.code}: ${m.msg}`;
      return;
    }

    if (m?.T === 's') {
      const sym = m.S;
      const s = sym ? this.stocks.get(sym) : undefined;
      if (!s) return;
      const code = String(m.sc || '').toUpperCase();
      const message = String(m.sm || m.rm || '').toLowerCase();
      const resumed = ['3', 'Q', 'T'].includes(code) || /resume/.test(message);
      const halted = !resumed && (['H', 'P'].includes(code) || /halt|pause|luld/.test(message));
      s.halted = halted;
      s.haltReason = halted ? String(m.sm || m.rm || 'Trading halt') : null;
      s.haltUpdatedAt = m.t || new Date().toISOString();
      s.lastUpdate = new Date().toISOString();
      this.emit({ type: 'stockUpdate', stock: this.toPublicStock(s) });
      return;
    }

    if (m?.T !== 't' && m?.T !== 'b' && m?.T !== 'u') return;

    if (m.T === 't') {
      this.diagnostics.liveTradeEvents++;
    } else if (m.T === 'b') {
      this.diagnostics.liveBarEvents++;
    } else if (m.T === 'u') {
      this.diagnostics.liveUpdatedBarEvents++;
    }

    if (this.sessionInfo.isExtendedHours) {
      this.extendedHoursEvents++;
      this.lastExtendedHoursEventTime = Date.now();
    }

    const sym = m.S;
    if (!sym) return;

    const s = this.stocks.get(sym);
    if (!s) return;

    s.lastWsTime = Date.now();

    const p = Number(m.T === 't' ? m.p : m.c);
    if (!p || p <= 0 || !Number.isFinite(p)) return;

    s.price = p;
    if ((m.T === 'b' || m.T === 'u') && typeof m.v === 'number' && Number.isFinite(m.v)) {
      s.volume = Math.max(s.volume, m.v);
      s.dollarVolume = Number((p * s.volume).toFixed(2));
      s.minuteVolume = m.v;
    }
    s.dayHigh = Math.max(s.dayHigh, p);
    s.distanceFromHigh =
      s.dayHigh > 0 ? Number((((s.dayHigh - p) / s.dayHigh) * 100).toFixed(2)) : null;

    if (s.previousClose !== null && s.previousClose > 0) {
      s.dailyChange = Number((((p - s.previousClose) / s.previousClose) * 100).toFixed(2));
    }

    let eventTime = m.t ? new Date(m.t).getTime() : Date.now();
    if (!Number.isFinite(eventTime) || eventTime <= 0) {
      eventTime = Date.now();
    }

    const lastPt = s.history.length > 0 ? s.history[s.history.length - 1] : null;
    const ptVol = (m.T === 'b' || m.T === 'u') && typeof m.v === 'number' ? m.v : undefined;
    if (!lastPt || Math.abs(eventTime - lastPt.t) >= 1000 || lastPt.p !== p) {
      s.history.push({ t: eventTime, p, v: ptVol });
    }
    if (s.history.length > 60) {
      s.history = s.history.slice(s.history.length - 60);
    }

    s.oneMinuteChange = this.calcMomentum(s.history, eventTime, 55000, 180000, p);
    s.twoMinuteChange = this.calcMomentum(s.history, eventTime, 115000, 300000, p);
    s.fiveMinuteChange = this.calcMomentum(s.history, eventTime, 270000, 600000, p);
    s.volumeAcceleration = this.calcVolumeAcceleration(s, s.minuteVolume ?? undefined);

    s.lastUpdate = new Date().toISOString();
    this.evaluate(s);

    this.emit({ type: 'stockUpdate', stock: this.toPublicStock(s) });
  }

  private rotate() {
    if (!this.auth || !this.ws) return;

    // Pick top 30 valid liquid stocks with highest momentum scores
    const candidateSymbols = [...this.stocks.values()]
      .filter((s) => s.isValid)
      .sort((a, b) => b.score - a.score || (b.dailyChange || 0) - (a.dailyChange || 0))
      .slice(0, 30)
      .map((s) => s.symbol);

    if (!candidateSymbols.length) return;

    const newSet = new Set(candidateSymbols);
    const toUnsub = [...this.sub].filter((s) => !newSet.has(s));
    const toSub = candidateSymbols.filter((s) => !this.sub.has(s));

    if (toUnsub.length > 0) {
      try {
        this.ws.send(
          JSON.stringify({
            action: 'unsubscribe',
            trades: toUnsub,
            bars: toUnsub,
            updatedBars: toUnsub,
            statuses: toUnsub,
          })
        );
      } catch (err: any) {
        console.error('[JFIRE] WS unsubscribe error:', err.message);
      }
    }

    if (toSub.length > 0) {
      try {
        this.ws.send(
          JSON.stringify({
            action: 'subscribe',
            trades: toSub,
            bars: toSub,
            updatedBars: toSub,
            statuses: toSub,
          })
        );
        void this.seedHistoricalBars(toSub);
      } catch (err: any) {
        console.error('[JFIRE] WS subscribe error:', err.message);
      }
    }

    this.sub = newSet;

    // Seed bars for any candidate symbols needing history
    const needSeed = candidateSymbols.filter((sym) => {
      const s = this.stocks.get(sym);
      return !s || s.history.length < 2 || s.oneMinuteChange === null || s.fiveMinuteChange === null;
    });
    if (needSeed.length > 0) {
      void this.seedHistoricalBars(needSeed);
    }

    this.emitStatus();
  }

  public getActiveFeedName(): string {
    if (this.sessionInfo.session === 'OVERNIGHT') {
      return 'overnight';
    }
    return this.feed || 'iex';
  }

  public getDiagnostics(): ScannerDiagnostics {
    let with1m = 0;
    let with5m = 0;
    let sample: TimestampSpanSample | null = null;
    const activeSamples: TimestampSpanSample[] = [];

    for (const [sym, s] of this.stocks.entries()) {
      if (s.oneMinuteChange !== null) with1m++;
      if (s.fiveMinuteChange !== null) with5m++;

      if (s.history.length >= 2) {
        const oldest = s.history[0];
        const newest = s.history[s.history.length - 1];
        const sp: TimestampSpanSample = {
          symbol: sym,
          pointsCount: s.history.length,
          oldestTimestamp: new Date(oldest.t).toISOString(),
          newestTimestamp: new Date(newest.t).toISOString(),
          timeSpanSeconds: Math.round((newest.t - oldest.t) / 1000),
          currentPrice: s.price,
          oneMinuteChange: s.oneMinuteChange,
          fiveMinuteChange: s.fiveMinuteChange,
        };
        if (!sample) sample = sp;
        if (activeSamples.length < 5) activeSamples.push(sp);
      }
    }

    this.diagnostics.symbolsWith1mHistory = with1m;
    this.diagnostics.symbolsWith5mHistory = with5m;
    this.diagnostics.sampleSymbolHistory = sample;
    this.diagnostics.subscribedSymbols = [...this.sub];

    const isExt = this.sessionInfo.isExtendedHours;
    const isReceivingExtended =
      isExt &&
      (this.extendedHoursEvents > 0 ||
        (this.lastExtendedHoursEventTime > 0 && Date.now() - this.lastExtendedHoursEventTime < 120000));

    return {
      currentSession: this.sessionInfo.session,
      currentFeed: this.getActiveFeedName(),
      activeFeed: this.getActiveFeedName(),
      isExtendedHours: isExt,
      extendedHoursDataReceiving: isReceivingExtended,
      liveTradeEvents: this.diagnostics.liveTradeEvents,
      liveBarEvents: this.diagnostics.liveBarEvents,
      liveUpdatedBarEvents: this.diagnostics.liveUpdatedBarEvents,
      wsMessagesTotal: this.diagnostics.wsMessagesTotal,
      wsLastMessageTime: this.diagnostics.wsLastMessageTime,
      wsLastError: this.diagnostics.wsLastError,
      subscribedSymbols: [...this.sub],
      symbolsWith1mHistory: with1m,
      symbolsWith5mHistory: with5m,
      timestampSpanSamples: sample,
      activeSamples,
    };
  }

  public logDiagnostics() {
    const diag = this.getDiagnostics();
    const s = diag.timestampSpanSamples;
    const sampleStr = s
      ? `${s.symbol} (${s.pointsCount} pts, span: ${s.timeSpanSeconds}s, oldest: ${s.oldestTimestamp}, newest: ${s.newestTimestamp}, 1m: ${s.oneMinuteChange !== null ? s.oneMinuteChange + '%' : 'null'}, 5m: ${s.fiveMinuteChange !== null ? s.fiveMinuteChange + '%' : 'null'})`
      : 'none';
    console.log(
      `[JFIRE DIAGNOSTICS] Session: ${diag.currentSession} | Feed: ${diag.currentFeed} | ExtRecv: ${diag.extendedHoursDataReceiving} | Live Trades: ${diag.liveTradeEvents} | Live Bars: ${diag.liveBarEvents} | 1M: ${diag.symbolsWith1mHistory} | 5M: ${diag.symbolsWith5mHistory} | Sample: ${sampleStr}`
    );
  }

  private getFreshness(s: StockInternal): DataFreshness {
    const now = Date.now();
    // 1. LIVE: Stock has recent live WebSocket trade or bar activity (within last 90s)
    if (s.lastWsTime && now - s.lastWsTime <= 90000) {
      return 'LIVE';
    }

    // 2. SEEDED: Momentum values are based on REST historical bars (or recent trade snapshot)
    // and are recent enough (within last 10 minutes) to represent meaningful momentum
    const hasMomentum = s.oneMinuteChange !== null || s.fiveMinuteChange !== null;
    const lastHistoryPt = s.history.length > 0 ? s.history[s.history.length - 1] : null;
    const mostRecentDataAge = lastHistoryPt ? now - lastHistoryPt.t : Infinity;
    const seedAge = s.lastSeedTime ? now - s.lastSeedTime : Infinity;

    if (hasMomentum && (seedAge <= 600000 || mostRecentDataAge <= 600000)) {
      return 'SEEDED';
    }

    // 3. STALE: Momentum data is missing or too old (> 10 minutes) to represent current momentum
    return 'STALE';
  }

  private toPublicStock(s: StockInternal): StockData {
    const newsCount = this.newsEngine ? this.newsEngine.getRecentArticleCountForSymbol(s.symbol, 120) : 0;
    return {
      symbol: s.symbol,
      name: s.name,
      price: s.price,
      previousClose: s.previousClose,
      dailyChange: s.dailyChange,
      oneMinuteChange: s.oneMinuteChange,
      twoMinuteChange: s.twoMinuteChange,
      fiveMinuteChange: s.fiveMinuteChange,
      dayOpen: s.dayOpen,
      volume: s.volume,
      dollarVolume: s.dollarVolume,
      previousDailyVolume: s.previousDailyVolume,
      relativeVolume: s.relativeVolume,
      volumeAcceleration: s.volumeAcceleration,
      dayHigh: s.dayHigh,
      distanceFromHigh: s.distanceFromHigh,
      score: s.score,
      signal: s.signal,
      freshness: this.getFreshness(s),
      triggers: s.triggers,
      newsCount: newsCount > 0 ? newsCount : undefined,
      hasRecentNews: newsCount > 0,
      lastUpdate: s.lastUpdate,
      halted: !!s.halted,
      haltReason: s.haltReason || null,
      haltUpdatedAt: s.haltUpdatedAt || null,
    };
  }

  public payload() {
    // Only return stocks that pass validity & liquidity for rankings
    const rankedStocks = [...this.stocks.values()]
      .filter((s) => s.isValid)
      .sort((a, b) => b.score - a.score)
      .slice(0, 500)
      .map((s) => this.toPublicStock(s));

    return {
      stocks: rankedStocks,
      universeSize: this.universe.length,
      stocksTracked: this.stocks.size,
    };
  }

  public status(): ScannerStatus {
    return {
      connected: !!this.ws && this.auth,
      marketOpen: this.sessionInfo.isOpen,
      clock: this.clock,
      sessionInfo: this.sessionInfo,
      feed: this.feed,
      activeFeed: this.getActiveFeedName(),
      universeSize: this.universe.length,
      stocksTracked: this.stocks.size,
      monitoredSymbols: this.sub.size,
      scanProgress: this.progress,
      alertCount: this.alerts,
      settings: this.settings,
      diagnostics: this.getDiagnostics(),
    };
  }

  public emitStatus() {
    this.emit({ type: 'connection_status', ...this.status() });
  }

  public broadcast() {
    this.emit({ type: 'stocks', ...this.payload() });
  }
}
