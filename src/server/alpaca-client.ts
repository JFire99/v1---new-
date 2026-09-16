import WebSocket from 'ws';

export interface AlpacaCredentials {
  apiKey: string;
  apiSecret: string;
  feed: string;
  historicalFeed?: string;
}

export interface AlpacaTrade {
  p: number;
  s: number;
  t: string;
  x?: string;
}

export interface AlpacaBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: string;
  vw?: number;
  n?: number;
}

export interface AlpacaSnapshot {
  latestTrade?: AlpacaTrade;

  latestQuote?: {
    ap: number;
    as: number;
    bp: number;
    bs: number;
    t: string;
  };

  minuteBar?: AlpacaBar;
  dailyBar?: AlpacaBar;
  prevDailyBar?: AlpacaBar;
}

export interface AlpacaAsset {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  status: string;
  tradable: boolean;
  marginable: boolean;
  shortable: boolean;
  easy_to_borrow: boolean;
}

interface AlpacaHistoricalResponse {
  bars?: Record<string, any[]>;
  next_page_token?: string | null;
}

const DATA_BASE =
  'https://data.alpaca.markets/v2';

const TRADING_BASE =
  'https://paper-api.alpaca.markets/v2';

const SNAPSHOT_CHUNK_SIZE = 100;
const SNAPSHOT_DELAY_MS = 400;

const HISTORY_CHUNK_SIZE = 25;
const HISTORY_DELAY_MS = 350;

const MAX_RETRIES = 4;

const HISTORY_MAX_MINUTES = 30;

const MAX_HISTORY_BARS = 60;

const MAX_HISTORY_PAGES = 10;

const RETRYABLE_STATUS_CODES =
  new Set([
    429,
    500,
    502,
    503,
    504,
  ]);

export class AlpacaClient {
  private creds: AlpacaCredentials;

  /*
   * Historical feed is deliberately separate
   * from the live feed.
   *
   * Example:
   *
   * live        = iex
   * historical  = sip
   */
  private historicalFeed: string;

  /*
   * Once SIP explicitly fails because the
   * subscription does not allow it, we don't
   * keep hammering SIP on every request.
   */
  private historicalFeedFallbackActive =
    false;

  constructor(
    creds: AlpacaCredentials,
  ) {
    this.creds = creds;

    this.historicalFeed =
      (
        creds.historicalFeed ??
        'iex'
      )
        .trim()
        .toLowerCase();

    if (
      ![
        'iex',
        'sip',
        'delayed_sip',
      ].includes(
        this.historicalFeed,
      )
    ) {
      console.warn(
        `[AlpacaClient] Unsupported historical feed "${this.historicalFeed}". Falling back to IEX.`,
      );

      this.historicalFeed =
        'iex';
    }

    console.log(
      `[AlpacaClient] Live feed: ${this.creds.feed}`,
    );

    console.log(
      `[AlpacaClient] Historical feed: ${this.historicalFeed}`,
    );
  }

  private getHeaders() {
    return {
      'APCA-API-KEY-ID':
        this.creds.apiKey,

      'APCA-API-SECRET-KEY':
        this.creds.apiSecret,

      Accept:
        'application/json',
    };
  }

  private async fetchFrom(
    url: string,
    label: string,
  ): Promise<any> {
    const response =
      await fetch(url, {
        method: 'GET',
        headers:
          this.getHeaders(),
      });

    const text =
      await response.text();

    if (!response.ok) {
      throw new Error(
        `${label} failed (${response.status}): ${text}`,
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `${label} returned invalid JSON`,
      );
    }
  }

  private async fetchData(
    path: string,
    label = 'Market data request',
  ): Promise<any> {
    return this.fetchFrom(
      `${DATA_BASE}${path}`,
      label,
    );
  }

  private async fetchTrading(
    path: string,
    label = 'Trading API request',
  ): Promise<any> {
    return this.fetchFrom(
      `${TRADING_BASE}${path}`,
      label,
    );
  }

  private getErrorStatus(
    error: any,
  ): number | null {
    const message =
      String(
        error?.message ??
          error ??
          '',
      );

    const match =
      message.match(
        /\((\d{3})\)/,
      );

    if (!match) {
      return null;
    }

    const status =
      Number(match[1]);

    return Number.isFinite(status)
      ? status
      : null;
  }

  private isSIPPermissionError(
    error: any,
  ): boolean {
    const message =
      String(
        error?.message ??
          error ??
          '',
      ).toLowerCase();

    return (
      message.includes(
        'subscription does not permit',
      ) ||
      message.includes(
        'subscription',
      ) &&
        message.includes(
          'sip',
        ) ||
      message.includes(
        'not entitled',
      ) ||
      message.includes(
        'permission',
      ) &&
        message.includes(
          'sip',
        )
    );
  }

  private sleep(
    milliseconds: number,
  ): Promise<void> {
    return new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          milliseconds,
        ),
    );
  }

  private getRetryDelay(
    attempt: number,
  ): number {
    return (
      2000 *
      Math.pow(
        2,
        Math.max(
          0,
          attempt - 1,
        ),
      )
    );
  }

  private isRetryableStatus(
    status: number | null,
  ): boolean {
    if (status === null) {
      return false;
    }

    return RETRYABLE_STATUS_CODES.has(
      status,
    );
  }

  async getSnapshots(
    symbols: string[],
  ): Promise<
    Map<string, AlpacaSnapshot>
  > {
    const results =
      new Map<
        string,
        AlpacaSnapshot
      >();

    if (!symbols.length) {
      return results;
    }

    const uniqueSymbols =
      Array.from(
        new Set(
          symbols
            .map(
              (symbol) =>
                String(symbol)
                  .trim()
                  .toUpperCase(),
            )
            .filter(Boolean),
        ),
      );

    for (
      let i = 0;
      i < uniqueSymbols.length;
      i += SNAPSHOT_CHUNK_SIZE
    ) {
      const chunk =
        uniqueSymbols.slice(
          i,
          i + SNAPSHOT_CHUNK_SIZE,
        );

      const symbolsParam =
        chunk.join(',');

      const url =
        `/stocks/snapshots?symbols=${encodeURIComponent(
          symbolsParam,
        )}` +
        `&feed=${encodeURIComponent(
          this.creds.feed,
        )}`;

      let attempts = 0;
      let completed = false;

      while (
        attempts < MAX_RETRIES &&
        !completed
      ) {
        attempts++;

        try {
          const data =
            await this.fetchData(
              url,
              `Snapshots (${chunk
                .slice(0, 5)
                .join(', ')})`,
            );

          if (
            data &&
            typeof data ===
              'object'
          ) {
            for (
              const symbol of Object.keys(
                data,
              )
            ) {
              const snapshot =
                data[symbol];

              if (!snapshot) {
                continue;
              }

              results.set(
                symbol,
                {
                  latestTrade:
                    snapshot.latestTrade,

                  latestQuote:
                    snapshot.latestQuote,

                  minuteBar:
                    snapshot.minuteBar,

                  dailyBar:
                    snapshot.dailyBar,

                  prevDailyBar:
                    snapshot.prevDailyBar,
                },
              );
            }
          }

          completed = true;
        } catch (error: any) {
          const status =
            this.getErrorStatus(
              error,
            );

          if (
            this.isRetryableStatus(
              status,
            ) &&
            attempts < MAX_RETRIES
          ) {
            const backoff =
              this.getRetryDelay(
                attempts,
              );

            console.warn(
              `[AlpacaClient] Snapshot request returned ${status}. Waiting ${backoff}ms before retry ${attempts}/${MAX_RETRIES}...`,
            );

            await this.sleep(
              backoff,
            );

            continue;
          }

          console.error(
            '[AlpacaClient] Snapshot request error:',
            error,
          );

          completed = true;
        }
      }

      if (
        i + SNAPSHOT_CHUNK_SIZE <
        uniqueSymbols.length
      ) {
        await this.sleep(
          SNAPSHOT_DELAY_MS,
        );
      }
    }

    console.log(
      `[AlpacaClient] Total snapshots received: ${results.size}`,
    );

    return results;
  }

  async getRecentMinuteBars(
    symbols: string[],
    minutes = 7,
  ): Promise<
    Map<string, AlpacaBar[]>
  > {
    const requestedSymbols =
      Array.from(
        new Set(
          symbols
            .map(
              (symbol) =>
                String(symbol)
                  .trim()
                  .toUpperCase(),
            )
            .filter(Boolean),
        ),
      );

    const empty =
      new Map<
        string,
        AlpacaBar[]
      >();

    if (!requestedSymbols.length) {
      return empty;
    }

    const requestedMinutes =
      Number.isFinite(minutes)
        ? Number(minutes)
        : 7;

    const safeMinutes =
      Math.max(
        2,
        Math.min(
          requestedMinutes,
          HISTORY_MAX_MINUTES,
        ),
      );

    /*
     * For SIP, the current account may not have
     * permission to query the most recent data.
     *
     * We deliberately request the current window
     * first because this is what we need for
     * real-time momentum.
     *
     * If SIP rejects it, we fall back to IEX.
     */
    const end =
      new Date();

    const endTime =
      new Date(
        end.getTime() -
          2_000,
      );

    const startTime =
      new Date(
        endTime.getTime() -
          safeMinutes *
            60 *
            1000,
      );

    const startIso =
      startTime.toISOString();

    const endIso =
      endTime.toISOString();

    let activeHistoricalFeed =
      this.historicalFeed;

    if (
      this.historicalFeedFallbackActive
    ) {
      activeHistoricalFeed =
        'iex';
    }

    console.log(
      `[AlpacaClient] Loading ${safeMinutes} minutes of 1-minute bars for ${requestedSymbols.length} symbols using ${activeHistoricalFeed} feed...`,
    );

    console.log(
      `[AlpacaClient] Historical window: ${startIso} -> ${endIso}`,
    );

    let results =
      await this.loadHistoricalBars(
        requestedSymbols,
        startIso,
        endIso,
        safeMinutes,
        activeHistoricalFeed,
      );

    /*
     * SIP unavailable:
     *
     * Automatically retry using IEX.
     *
     * This is important because a Basic Alpaca
     * account may not have access to recent SIP.
     */
    if (
      results.permissionDenied &&
      activeHistoricalFeed ===
        'sip'
    ) {
      console.warn(
        '[AlpacaClient] Recent SIP historical data is not available for this subscription.',
      );

      console.warn(
        '[AlpacaClient] Falling back to IEX historical data.',
      );

      this.historicalFeedFallbackActive =
        true;

      results =
        await this.loadHistoricalBars(
          requestedSymbols,
          startIso,
          endIso,
          safeMinutes,
          'iex',
        );
    }

    const barsBySymbol =
      results.bars;

    const receivedSymbols =
      new Set(
        barsBySymbol.keys(),
      );

    const missingSymbols =
      requestedSymbols.filter(
        (symbol) =>
          !receivedSymbols.has(
            symbol,
          ),
      );

    if (
      missingSymbols.length
    ) {
      console.warn(
        `[AlpacaClient] Historical bars unavailable for ${missingSymbols.length}/${requestedSymbols.length} requested symbols on feed ${results.feedUsed}.`,
      );

      console.warn(
        `[AlpacaClient] Missing sample: ${missingSymbols
          .slice(0, 20)
          .join(', ')}${
          missingSymbols.length > 20
            ? ' ...'
            : ''
        }`,
      );
    }

    console.log(
      `[AlpacaClient] Historical bars received for ${barsBySymbol.size}/${requestedSymbols.length} symbols using ${results.feedUsed}`,
    );

    if (
      barsBySymbol.size > 0
    ) {
      let totalBars = 0;

      let symbolsWithFiveBars =
        0;

      let symbolsWithTwoBars =
        0;

      for (
        const bars of barsBySymbol.values()
      ) {
        totalBars +=
          bars.length;

        if (
          bars.length >= 5
        ) {
          symbolsWithFiveBars++;
        }

        if (
          bars.length >= 2
        ) {
          symbolsWithTwoBars++;
        }
      }

      console.log(
        `[AlpacaClient] Historical 1m bars loaded: ${totalBars} total bars across ${barsBySymbol.size} symbols`,
      );

      console.log(
        `[AlpacaClient] Historical quality: ${symbolsWithFiveBars} symbols with 5+ bars, ${symbolsWithTwoBars} symbols with 2+ bars`,
      );
    }

    return barsBySymbol;
  }

  private async loadHistoricalBars(
    symbols: string[],
    startIso: string,
    endIso: string,
    safeMinutes: number,
    feed: string,
  ): Promise<{
    bars: Map<
      string,
      AlpacaBar[]
    >;
    feedUsed: string;
    permissionDenied: boolean;
  }> {
    const results =
      new Map<
        string,
        AlpacaBar[]
      >();

    let permissionDenied =
      false;

    for (
      let i = 0;
      i < symbols.length;
      i += HISTORY_CHUNK_SIZE
    ) {
      const chunk =
        symbols.slice(
          i,
          i + HISTORY_CHUNK_SIZE,
        );

      const batchBars =
        new Map<
          string,
          AlpacaBar[]
        >();

      let pageToken:
        | string
        | undefined;

      let pageNumber = 0;

      let batchFailed = false;

      while (
        pageNumber <
        MAX_HISTORY_PAGES
      ) {
        pageNumber++;

        const symbolsParam =
          chunk.join(',');

        let url =
          `/stocks/bars?symbols=${encodeURIComponent(
            symbolsParam,
          )}` +
          `&timeframe=1Min` +
          `&start=${encodeURIComponent(
            startIso,
          )}` +
          `&end=${encodeURIComponent(
            endIso,
          )}` +
          `&limit=10000` +
          `&feed=${encodeURIComponent(
            feed,
          )}`;

        if (pageToken) {
          url +=
            `&page_token=${encodeURIComponent(
              pageToken,
            )}`;
        }

        let attempts = 0;
        let completed = false;

        while (
          attempts < MAX_RETRIES &&
          !completed
        ) {
          attempts++;

          try {
            const data =
              (await this.fetchData(
                url,
                `Historical 1-minute bars (${chunk
                  .slice(0, 5)
                  .join(', ')}) page ${pageNumber} [${feed}]`,
              )) as AlpacaHistoricalResponse;

            const bars =
              data?.bars;

            if (
              bars &&
              typeof bars ===
                'object' &&
              !Array.isArray(bars)
            ) {
              for (
                const symbol of Object.keys(
                  bars,
                )
              ) {
                const rawBars =
                  bars[symbol];

                if (
                  !Array.isArray(
                    rawBars,
                  )
                ) {
                  continue;
                }

                if (
                  !batchBars.has(
                    symbol,
                  )
                ) {
                  batchBars.set(
                    symbol,
                    [],
                  );
                }

                const symbolBars =
                  batchBars.get(
                    symbol,
                  )!;

                for (
                  const bar of rawBars
                ) {
                  if (
                    !bar ||
                    typeof bar.t !==
                      'string'
                  ) {
                    continue;
                  }

                  const timestamp =
                    new Date(
                      bar.t,
                    ).getTime();

                  if (
                    !Number.isFinite(
                      timestamp,
                    )
                  ) {
                    continue;
                  }

                  const close =
                    Number(
                      bar.c,
                    );

                  if (
                    !Number.isFinite(
                      close,
                    ) ||
                    close <= 0
                  ) {
                    continue;
                  }

                  const open =
                    Number(
                      bar.o,
                    );

                  const high =
                    Number(
                      bar.h,
                    );

                  const low =
                    Number(
                      bar.l,
                    );

                  const volume =
                    Number(
                      bar.v,
                    );

                  const vwap =
                    Number(
                      bar.vw,
                    );

                  const trades =
                    Number(
                      bar.n,
                    );

                  symbolBars.push({
                    o:
                      Number.isFinite(
                        open,
                      )
                        ? open
                        : close,

                    h:
                      Number.isFinite(
                        high,
                      )
                        ? high
                        : close,

                    l:
                      Number.isFinite(
                        low,
                      )
                        ? low
                        : close,

                    c:
                      close,

                    v:
                      Number.isFinite(
                        volume,
                      ) &&
                      volume >= 0
                        ? volume
                        : 0,

                    t:
                      new Date(
                        timestamp,
                      ).toISOString(),

                    vw:
                      Number.isFinite(
                        vwap,
                      )
                        ? vwap
                        : undefined,

                    n:
                      Number.isFinite(
                        trades,
                      )
                        ? trades
                        : undefined,
                  });
                }
              }
            }

            const nextToken =
              typeof data?.next_page_token ===
                'string' &&
              data.next_page_token.length >
                0
                ? data.next_page_token
                : undefined;

            if (!nextToken) {
              pageToken =
                undefined;

              completed = true;

              break;
            }

            if (
              nextToken ===
              pageToken
            ) {
              pageToken =
                undefined;

              completed = true;

              break;
            }

            pageToken =
              nextToken;

            completed = true;
          } catch (error: any) {
            if (
              feed === 'sip' &&
              this.isSIPPermissionError(
                error,
              )
            ) {
              permissionDenied =
                true;

              batchFailed =
                true;

              completed = true;

              break;
            }

            const status =
              this.getErrorStatus(
                error,
              );

            if (
              this.isRetryableStatus(
                status,
              ) &&
              attempts < MAX_RETRIES
            ) {
              const backoff =
                this.getRetryDelay(
                  attempts,
                );

              console.warn(
                `[AlpacaClient] Historical ${feed} request returned ${status}. Waiting ${backoff}ms before retry ${attempts}/${MAX_RETRIES}...`,
              );

              await this.sleep(
                backoff,
              );

              continue;
            }

            console.error(
              `[AlpacaClient] Historical ${feed} request failed for ${chunk
                .slice(0, 5)
                .join(', ')} page ${pageNumber}:`,
              error,
            );

            batchFailed =
              true;

            completed = true;
          }
        }

        if (
          permissionDenied ||
          batchFailed
        ) {
          break;
        }

        if (!pageToken) {
          break;
        }
      }

      if (
        permissionDenied
      ) {
        break;
      }

      for (
        const [
          symbol,
          bars,
        ] of batchBars.entries()
      ) {
        if (!bars.length) {
          continue;
        }

        const byTime =
          new Map<
            string,
            AlpacaBar
          >();

        for (
          const bar of bars
        ) {
          byTime.set(
            bar.t,
            bar,
          );
        }

        const deduplicatedBars =
          Array.from(
            byTime.values(),
          ).sort(
            (a, b) =>
              new Date(
                a.t,
              ).getTime() -
              new Date(
                b.t,
              ).getTime(),
          );

        const trimmedBars =
          deduplicatedBars.slice(
            -MAX_HISTORY_BARS,
          );

        if (
          trimmedBars.length
        ) {
          results.set(
            symbol,
            trimmedBars,
          );
        }
      }

      if (
        i + HISTORY_CHUNK_SIZE <
        symbols.length
      ) {
        await this.sleep(
          HISTORY_DELAY_MS,
        );
      }
    }

    return {
      bars: results,
      feedUsed: feed,
      permissionDenied,
    };
  }

  async testSnapshots(): Promise<void> {
    const symbols = [
      'AAPL',
      'MSFT',
      'NVDA',
      'TSLA',
      'AMD',
    ];

    console.log(
      '[AlpacaClient] Snapshot diagnostic test...',
    );

    try {
      const snapshots =
        await this.getSnapshots(
          symbols,
        );

      console.log(
        `[AlpacaClient] Diagnostic snapshots: ${snapshots.size}/${symbols.length}`,
      );

      for (
        const symbol of symbols
      ) {
        const snapshot =
          snapshots.get(
            symbol,
          );

        if (!snapshot) {
          console.log(
            `[AlpacaClient] ${symbol}: no data`,
          );

          continue;
        }

        console.log(
          `[AlpacaClient] ${symbol}: $${snapshot.latestTrade?.p ?? snapshot.dailyBar?.c ?? 'N/A'}`,
        );
      }
    } catch (error) {
      console.error(
        '[AlpacaClient] Diagnostic failed:',
        error,
      );
    }
  }

  async getActiveAssets(): Promise<string[]> {
    const data =
      await this.fetchTrading(
        '/assets?status=active&asset_class=us_equity',
        'Active assets',
      );

    const assets:
      AlpacaAsset[] =
      Array.isArray(data)
        ? data
        : [];

    const allowedExchanges =
      new Set([
        'NYSE',
        'NASDAQ',
        'AMEX',
        'ARCA',
        'BATS',
        'NYSEARCA',
      ]);

    const symbols =
      assets
        .filter(
          (asset) =>
            asset.status ===
              'active' &&
            asset.tradable &&
            allowedExchanges.has(
              asset.exchange,
            ),
        )
        .map(
          (asset) =>
            asset.symbol,
        )
        .filter(Boolean);

    console.log(
      `[AlpacaClient] Active assets: ${symbols.length} symbols`,
    );

    return symbols;
  }

  async getClock(): Promise<{
    timestamp: string;
    is_open: boolean;
    next_open: string;
    next_close: string;
  }> {
    return this.fetchTrading(
      '/clock',
      'Market clock',
    );
  }

  createStream(): WebSocket {
    const wsUrl =
      `wss://stream.data.alpaca.markets/v2/${this.creds.feed}`;

    console.log(
      `[AlpacaClient] Opening WebSocket: ${wsUrl}`,
    );

    return new WebSocket(
      wsUrl,
    );
  }
}