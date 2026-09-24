import { NewsEngine } from './news-engine';

/**
 * NewsEngine wrapper that deliberately uses Alpaca REST for news.
 *
 * Alpaca Basic accounts commonly allow only one active market-data WebSocket
 * connection. The scanner already needs that connection for live stock data,
 * so opening a second WebSocket for news causes error 406 (connection limit
 * exceeded). Keep the existing NewsEngine parsing/reaction logic, but seed and
 * refresh recent news through its REST path instead.
 */
export class ResilientNewsEngine extends NewsEngine {
  private newsRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private resilientReactionTimer: ReturnType<typeof setInterval> | null = null;
  private resilientStopping = false;
  private refreshInFlight = false;

  public override async start() {
    this.resilientStopping = false;

    // Initial REST seed. This does not create a market-data WebSocket.
    await this.refreshNewsFromRest();

    // Keep recent news reasonably fresh without consuming another WebSocket.
    this.newsRefreshTimer = setInterval(() => {
      void this.refreshNewsFromRest();
    }, 30000);

    // Preserve the existing price-reaction logic used by NewsEngine.
    this.resilientReactionTimer = setInterval(() => {
      (this as any).updatePriceReactions();
    }, 15000);
  }

  public override stop() {
    this.resilientStopping = true;

    if (this.newsRefreshTimer) {
      clearInterval(this.newsRefreshTimer);
      this.newsRefreshTimer = null;
    }

    if (this.resilientReactionTimer) {
      clearInterval(this.resilientReactionTimer);
      this.resilientReactionTimer = null;
    }

    // No news WebSocket is opened by this implementation.
    super.stop();
  }

  private async refreshNewsFromRest() {
    if (this.resilientStopping || this.refreshInFlight) return;

    this.refreshInFlight = true;
    try {
      // NewsEngine already contains the authenticated Alpaca REST request and
      // article parsing/merge logic. Reuse it rather than duplicating secrets
      // or API handling here.
      await (this as any).seedRecentNews();
    } catch (err: any) {
      console.error('[JFIRE NEWS] REST refresh failed:', err?.message || err);
    } finally {
      this.refreshInFlight = false;
    }
  }
}
