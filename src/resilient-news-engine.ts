import WebSocket from 'ws';
import { NewsEngine, type StockSnapshotForNews } from './news-engine';

/**
 * NewsEngine wrapper that preserves the existing news parsing/reaction logic
 * while preventing Alpaca 406 connection-limit errors from causing a 5s retry loop.
 */
export class ResilientNewsEngine extends NewsEngine {
  private resilientWs: WebSocket | null = null;
  private resilientReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private resilientBlocked = false;
  private resilientAttempt = 0;
  private resilientStopping = false;
  private resilientReactionTimer: ReturnType<typeof setInterval> | null = null;

  public override async start() {
    this.resilientStopping = false;
    this.resilientBlocked = false;
    this.connectResilient();
    void (this as any).seedRecentNews();

    this.resilientReactionTimer = setInterval(() => {
      (this as any).updatePriceReactions();
    }, 15000);
  }

  public override stop() {
    this.resilientStopping = true;
    if (this.resilientReconnectTimer) {
      clearTimeout(this.resilientReconnectTimer);
      this.resilientReconnectTimer = null;
    }
    if (this.resilientReactionTimer) {
      clearInterval(this.resilientReactionTimer);
      this.resilientReactionTimer = null;
    }

    try {
      this.resilientWs?.close();
    } catch {}
    this.resilientWs = null;
    (this as any).ws = null;

    super.stop();
  }

  private connectResilient() {
    if (this.resilientStopping || this.resilientBlocked) return;

    if (this.resilientWs) {
      try {
        this.resilientWs.close();
      } catch {}
      this.resilientWs = null;
    }

    const wsUrl = 'wss://stream.data.alpaca.markets/v1beta1/news';
    console.log(`[JFIRE NEWS] Connecting to Alpaca News stream: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    this.resilientWs = ws;
    (this as any).ws = ws;

    ws.on('open', () => {
      console.log('[JFIRE NEWS] News WebSocket connected, authenticating...');
      ws.send(
        JSON.stringify({
          action: 'auth',
          key: (this as any).key,
          secret: (this as any).secret,
        })
      );
    });

    ws.on('message', (raw) => {
      try {
        const messages = JSON.parse(raw.toString());
        const list = Array.isArray(messages) ? messages : [messages];

        for (const message of list) {
          if (message?.T === 'error' && Number(message.code) === 406) {
            (this as any).handleMessage(message);
            this.handleConnectionLimit(ws);
            continue;
          }

          (this as any).handleMessage(message);

          if (message?.T === 'success' && message.msg === 'authenticated') {
            this.resilientBlocked = false;
            this.resilientAttempt = 0;
          }
        }
      } catch (err: any) {
        console.error('[JFIRE NEWS] Message parse error:', err?.message || err);
      }
    });

    ws.on('error', (err: any) => {
      console.error('[JFIRE NEWS] WebSocket error:', err?.message || err);
      (this as any).lastError = err?.message || String(err);
    });

    ws.on('close', (code, reason) => {
      if (this.resilientWs !== ws) return;
      this.resilientWs = null;
      (this as any).ws = null;
      (this as any).isConnected = false;
      (this as any).emitNewsStatus();

      if (this.resilientStopping || this.resilientBlocked) return;

      console.warn(
        `[JFIRE NEWS] WebSocket closed (${code}: ${reason.toString()}). Reconnecting in 5s...`
      );
      this.resilientReconnectTimer = setTimeout(() => {
        this.resilientReconnectTimer = null;
        this.connectResilient();
      }, 5000);
    });
  }

  private handleConnectionLimit(ws: WebSocket) {
    if (this.resilientStopping) return;

    this.resilientBlocked = true;
    if (this.resilientReconnectTimer) {
      clearTimeout(this.resilientReconnectTimer);
      this.resilientReconnectTimer = null;
    }

    const delayMs = Math.min(300000, 60000 * 2 ** this.resilientAttempt);
    this.resilientAttempt += 1;

    console.warn(
      `[JFIRE NEWS] Alpaca connection limit (406). ` +
        `Reconnect paused for ${Math.round(delayMs / 1000)}s.`
    );

    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Alpaca connection limit');
      }
    } catch {}

    this.resilientReconnectTimer = setTimeout(() => {
      this.resilientReconnectTimer = null;
      if (this.resilientStopping) return;
      this.resilientBlocked = false;
      this.connectResilient();
    }, delayMs);
  }
}
