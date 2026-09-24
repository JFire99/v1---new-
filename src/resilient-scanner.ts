import WebSocket from 'ws';
import { getMarketSession } from './market-session';
import { Scanner } from './scanner-engine';

/**
 * Scanner wrapper that keeps REST snapshot scanning alive when Alpaca refuses
 * the market-data WebSocket with 406 (connection limit exceeded).
 *
 * REST snapshots remain the scanner's primary fallback data source. The
 * WebSocket is an enhancement for lower-latency updates, not a prerequisite
 * for the scanner to operate.
 */
export class ResilientScanner extends Scanner {
  private resilientWs: WebSocket | null = null;
  private resilientReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private resilientBlocked = false;
  private resilientAttempt = 0;
  private resilientStopping = false;
  private resilientScanTimer: ReturnType<typeof setInterval> | null = null;
  private resilientClockTimer: ReturnType<typeof setInterval> | null = null;
  private resilientRotateTimer: ReturnType<typeof setInterval> | null = null;
  private resilientDiagnosticTimer: ReturnType<typeof setInterval> | null = null;

  public override async start() {
    this.resilientStopping = false;
    this.resilientBlocked = false;
    this.resilientAttempt = 0;

    try {
      await this.updateClock();
    } catch (err: any) {
      console.error('[JFIRE] Initial clock error:', err?.message || err);
    }

    try {
      await (this as any).loadUniverse();
    } catch (err: any) {
      console.error('[JFIRE] Universe load error:', err?.message || err);
    }

    this.connectResilientWs();
    void this.scan();
    this.resilientScanTimer = setInterval(() => void this.scan(), 30000);
    this.resilientClockTimer = setInterval(() => void this.updateClock(), 30000);
    this.resilientRotateTimer = setInterval(() => (this as any).rotate(), 30000);
    this.resilientDiagnosticTimer = setInterval(() => (this as any).logDiagnostics(), 15000);
  }

  public override stop() {
    this.resilientStopping = true;
    if (this.resilientReconnectTimer) {
      clearTimeout(this.resilientReconnectTimer);
      this.resilientReconnectTimer = null;
    }
    if (this.resilientScanTimer) clearInterval(this.resilientScanTimer);
    if (this.resilientClockTimer) clearInterval(this.resilientClockTimer);
    if (this.resilientRotateTimer) clearInterval(this.resilientRotateTimer);
    if (this.resilientDiagnosticTimer) clearInterval(this.resilientDiagnosticTimer);
    this.resilientScanTimer = null;
    this.resilientClockTimer = null;
    this.resilientRotateTimer = null;
    this.resilientDiagnosticTimer = null;

    try {
      this.resilientWs?.close();
    } catch {}
    this.resilientWs = null;
    (this as any).ws = null;
    (this as any).auth = false;

    super.stop();
  }

  /** Return the selected stock's rolling price/minute-volume history. */
  public getStockLiveDetail(symbol: string) {
    const sym = String(symbol || '').toUpperCase();
    const stocks = (this as any).stocks as Map<string, any> | undefined;
    const s = stocks?.get(sym);
    if (!s) return null;

    const history = Array.isArray(s.history)
      ? s.history.slice(-60).map((pt: any) => ({ t: pt.t, p: pt.p, v: pt.v }))
      : [];

    return {
      symbol: sym,
      history,
      minuteVolume: typeof s.minuteVolume === 'number' ? s.minuteVolume : null,
      volumeAcceleration: typeof s.volumeAcceleration === 'number' ? s.volumeAcceleration : null,
      lastWsTime: typeof s.lastWsTime === 'number' ? s.lastWsTime : null,
      live: typeof s.lastWsTime === 'number' && Date.now() - s.lastWsTime <= 90000,
    };
  }

  public override async updateClock() {
    try {
      const data = await (this as any).get('https://paper-api.alpaca.markets/v2/clock');
      if (data && typeof data.is_open === 'boolean') {
        (this as any).clock = {
          isOpen: data.is_open,
          timestamp: data.timestamp || new Date().toISOString(),
          nextOpen: data.next_open || '',
          nextClose: data.next_close || '',
        };
      }
    } catch (err: any) {
      console.error('[JFIRE] Clock update error:', err?.message || err);
    }

    if (Date.now() - (this as any).lastCalendarFetch > 6 * 3600 * 1000) {
      await (this as any).refreshCalendarHolidays();
    }

    const previousSession = this.sessionInfo.session;
    this.sessionInfo = getMarketSession(
      new Date(),
      (this as any).calendarHolidays,
      (this as any).feed
    );

    if (this.sessionInfo.session !== previousSession) {
      console.log(`[JFIRE] Market session changed: ${previousSession} -> ${this.sessionInfo.session}`);
      this.resilientBlocked = false;
      this.resilientAttempt = 0;
      this.connectResilientWs();
      void this.scan();
    }

    (this as any).emitStatus();
  }

  private connectResilientWs() {
    if (this.resilientStopping || this.resilientBlocked) return;

    const feed = (this as any).feed || 'iex';
    const targetUrl =
      this.sessionInfo.session === 'OVERNIGHT'
        ? 'wss://stream.data.alpaca.markets/v1beta1/overnight'
        : `wss://stream.data.alpaca.markets/v2/${feed}`;

    if (this.resilientWs) {
      try { this.resilientWs.close(); } catch {}
      this.resilientWs = null;
    }

    if (this.resilientReconnectTimer) {
      clearTimeout(this.resilientReconnectTimer);
      this.resilientReconnectTimer = null;
    }

    console.log(`[JFIRE] Connecting WebSocket to ${targetUrl} (session: ${this.sessionInfo.session})`);

    const ws = new WebSocket(targetUrl);
    this.resilientWs = ws;
    (this as any).ws = ws;

    ws.on('open', () => {
      ws.send(JSON.stringify({ action: 'auth', key: (this as any).key, secret: (this as any).secret }));
    });

    ws.on('message', (data) => {
      try {
        const messages = JSON.parse(data.toString());
        const list = Array.isArray(messages) ? messages : [messages];
        for (const message of list) {
          if (message?.T === 'error' && Number(message.code) === 406) {
            (this as any).handleWsMessage(message);
            this.handleConnectionLimit(ws, 'stock');
            continue;
          }
          (this as any).handleWsMessage(message);
          if (message?.T === 'success' && message.msg === 'authenticated') {
            this.resilientBlocked = false;
            this.resilientAttempt = 0;
            console.log('[JFIRE] Stock WebSocket authenticated; using WS + REST data.');
          }
        }
      } catch (err: any) {
        console.error('[JFIRE] WS parse error:', err?.message || err);
      }
    });

    ws.on('error', (err: any) => {
      console.error('[JFIRE] WS error:', err?.message || err);
    });

    ws.on('close', () => {
      if (this.resilientWs !== ws) return;
      this.resilientWs = null;
      (this as any).ws = null;
      (this as any).auth = false;
      if (this.resilientStopping || this.resilientBlocked) return;
      this.resilientReconnectTimer = setTimeout(() => {
        this.resilientReconnectTimer = null;
        this.connectResilientWs();
      }, 5000);
    });
  }

  private handleConnectionLimit(ws: WebSocket, stream: 'stock') {
    if (this.resilientStopping) return;
    this.resilientBlocked = true;
    if (this.resilientReconnectTimer) {
      clearTimeout(this.resilientReconnectTimer);
      this.resilientReconnectTimer = null;
    }
    const delayMs = Math.min(300000, 60000 * 2 ** this.resilientAttempt);
    this.resilientAttempt += 1;
    console.warn(`[JFIRE] Alpaca ${stream} WebSocket connection limit (406). REST snapshot scanning remains active. WS retry in ${Math.round(delayMs / 1000)}s.`);
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Alpaca connection limit');
      }
    } catch {}
    this.resilientReconnectTimer = setTimeout(() => {
      this.resilientReconnectTimer = null;
      if (this.resilientStopping) return;
      this.resilientBlocked = false;
      this.connectResilientWs();
    }, delayMs);
  }
}
