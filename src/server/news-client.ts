import type { AlpacaCredentials } from './alpaca-client';

export interface AlpacaNewsArticle {
  T?: string;
  id: number;
  headline: string;
  summary?: string;
  author?: string;
  created_at: string;
  updated_at?: string;
  url?: string;
  content?: string;
  symbols?: string[];
  source?: string;
}

export interface ClassifiedNewsArticle
  extends AlpacaNewsArticle {
  catalyst: string;
  catalystScore: number;
}

const NEWS_BASE =
  'https://data.alpaca.markets/v1beta1/news';

export class NewsClient {
  private credentials: AlpacaCredentials;

  private timer:
    | ReturnType<typeof setInterval>
    | null = null;

  private running = false;

  private seenIds = new Set<number>();

  private articles = new Map<
    number,
    ClassifiedNewsArticle
  >();

  private readonly pollIntervalMs = 30_000;

  private onNews:
    | ((
        article: ClassifiedNewsArticle,
      ) => void)
    | null = null;

  constructor(
    credentials: AlpacaCredentials,
  ) {
    this.credentials =
      credentials;
  }

  on(
    event: 'news',
    listener: (
      article: ClassifiedNewsArticle,
    ) => void,
  ) {
    if (event === 'news') {
      this.onNews = listener;
    }
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    console.log(
      '[NewsClient] Starting news polling...',
    );

    await this.poll();

    this.timer =
      setInterval(
        () => {
          void this.poll();
        },
        this.pollIntervalMs,
      );

    console.log(
      '[NewsClient] News polling started',
    );
  }

  stop(): void {
    this.running = false;

    if (this.timer) {
      clearInterval(
        this.timer,
      );

      this.timer = null;
    }

    console.log(
      '[NewsClient] News polling stopped',
    );
  }

  getLatest(
    limit = 50,
  ): ClassifiedNewsArticle[] {
    return Array.from(
      this.articles.values(),
    )
      .sort(
        (a, b) =>
          new Date(
            b.created_at,
          ).getTime() -
          new Date(
            a.created_at,
          ).getTime(),
      )
      .slice(
        0,
        limit,
      );
  }

  private async poll(): Promise<void> {
    try {
      const url =
        `${NEWS_BASE}` +
        `?limit=50` +
        `&sort=desc` +
        `&include_content=false`;

      const response =
        await fetch(
          url,
          {
            method: 'GET',
            headers: {
              'APCA-API-KEY-ID':
                this.credentials.apiKey,
              'APCA-API-SECRET-KEY':
                this.credentials.apiSecret,
              Accept:
                'application/json',
            },
          },
        );

      const text =
        await response.text();

      if (!response.ok) {
        console.warn(
          `[NewsClient] News request failed (${response.status}): ${text}`,
        );

        return;
      }

      let data: any;

      try {
        data =
          JSON.parse(text);
      } catch {
        console.warn(
          '[NewsClient] News API returned invalid JSON',
        );

        return;
      }

      const articles =
        Array.isArray(data)
          ? data
          : Array.isArray(
                data?.news,
              )
            ? data.news
            : [];

      let newCount = 0;

      for (
        const rawArticle of articles
      ) {
        if (
          !rawArticle ||
          typeof rawArticle.id !==
            'number' ||
          !rawArticle.headline
        ) {
          continue;
        }

        const article =
          this.normalizeArticle(
            rawArticle,
          );

        const classified =
          this.classifyArticle(
            article,
          );

        const wasSeen =
          this.seenIds.has(
            classified.id,
          );

        /*
         * Always keep the article in the
         * global news collection.
         *
         * The vite plugin decides whether
         * it belongs to a particular stock.
         */
        this.articles.set(
          classified.id,
          classified,
        );

        this.seenIds.add(
          classified.id,
        );

        if (!wasSeen) {
          newCount++;

          this.onNews?.(
            classified,
          );
        }
      }

      this.cleanup();

      if (newCount > 0) {
        console.log(
          `[NewsClient] Received ${newCount} new article(s)`,
        );
      }
    } catch (error) {
      console.warn(
        '[NewsClient] Poll failed:',
        error,
      );
    }
  }

  private normalizeArticle(
    article: AlpacaNewsArticle,
  ): AlpacaNewsArticle {
    const symbols =
      Array.isArray(
        article.symbols,
      )
        ? article.symbols
            .map(
              (symbol) =>
                String(
                  symbol,
                )
                  .trim()
                  .toUpperCase(),
            )
            .filter(
              (symbol) =>
                /^[A-Z][A-Z0-9.-]{0,9}$/.test(
                  symbol,
                ),
            )
        : [];

    return {
      ...article,

      symbols:
        Array.from(
          new Set(
            symbols,
          ),
        ),
    };
  }

  private classifyArticle(
    article: AlpacaNewsArticle,
  ): ClassifiedNewsArticle {
    const headline =
      article.headline ??
      '';

    const summary =
      article.summary ??
      '';

    const text =
      [
        headline,
        summary,
      ]
        .join(' ')
        .toLowerCase();

    /*
     * Generic article detection.
     *
     * These articles are still shown in the
     * global news feed but receive almost no
     * catalyst weight.
     */
    const genericListicle =
      this.isGenericMarketArticle(
        headline,
        summary,
      );

    if (
      genericListicle
    ) {
      return {
        ...article,

        catalyst:
          'NEWS',

        catalystScore: 1,
      };
    }

    /*
     * Catalyst rules.
     *
     * Strong catalysts are checked first.
     */
    const rules: Array<{
      keywords: string[];
      catalyst: string;
      score: number;
    }> = [
      {
        keywords: [
          'fda',
          'food and drug administration',
          'approval',
          'approved',
          'clinical trial',
          'phase 1',
          'phase 2',
          'phase 3',
          'pdufa',
        ],

        catalyst:
          'FDA / BIOTECH',

        score: 20,
      },

      {
        keywords: [
          'earnings',
          'quarterly results',
          'quarterly earnings',
          'revenue',
          'profit',
          'eps',
          'guidance',
          'outlook',
          'sales beat',
          'earnings beat',
        ],

        catalyst:
          'EARNINGS',

        score: 15,
      },

      {
        keywords: [
          'contract',
          'contracts',
          'contract win',
          'contract award',
          'award',
          'awarded',
          'order',
          'orders',
          'purchase agreement',
          'purchase order',
        ],

        catalyst:
          'CONTRACT',

        score: 15,
      },

      {
        keywords: [
          'partnership',
          'partnered',
          'collaboration',
          'agreement',
          'strategic alliance',
          'strategic partnership',
        ],

        catalyst:
          'PARTNERSHIP',

        score: 12,
      },

      {
        keywords: [
          'acquisition',
          'acquires',
          'acquired',
          'merger',
          'merges',
          'merged',
          'takeover',
        ],

        catalyst:
          'M&A',

        score: 15,
      },

      {
        keywords: [
          'upgrade',
          'upgraded',
          'price target raised',
          'raises price target',
          'buy rating',
          'overweight',
          'outperform',
        ],

        catalyst:
          'ANALYST UPGRADE',

        score: 8,
      },

      {
        keywords: [
          'ai',
          'artificial intelligence',
          'artificial-intelligence',
          'data center',
          'datacenter',
          'chip',
          'chips',
          'semiconductor',
          'gpu',
          'machine learning',
        ],

        catalyst:
          'AI / TECH',

        score: 8,
      },

      {
        keywords: [
          'offering',
          'share offering',
          'stock offering',
          'secondary offering',
          'dilution',
          'dilutive',
          'atm offering',
          'at-the-market',
          'share sale',
          'registered direct',
        ],

        catalyst:
          'OFFERING / DILUTION',

        score: -20,
      },

      {
        keywords: [
          'downgrade',
          'downgraded',
          'sell rating',
          'price target cut',
          'cuts price target',
          'underweight',
          'underperform',
        ],

        catalyst:
          'ANALYST DOWNGRADE',

        score: -10,
      },

      {
        keywords: [
          'lawsuit',
          'investigation',
          'sec investigation',
          'subpoena',
          'fraud',
          'bankruptcy',
          'chapter 11',
          'regulatory probe',
        ],

        catalyst:
          'LEGAL / RISK',

        score: -15,
      },
    ];

    for (
      const rule of rules
    ) {
      if (
        rule.keywords.some(
          (keyword) =>
            text.includes(
              keyword,
            ),
        )
      ) {
        return {
          ...article,

          catalyst:
            rule.catalyst,

          catalystScore:
            rule.score,
        };
      }
    }

    return {
      ...article,

      catalyst:
        'NEWS',

      catalystScore: 3,
    };
  }

  private isGenericMarketArticle(
    headline: string,
    summary: string,
  ): boolean {
    const text =
      [
        headline,
        summary,
      ]
        .join(' ')
        .toLowerCase();

    const patterns = [
      /\bstocks?\s+moving\b/,
      /\bstocks?\s+to\s+watch\b/,
      /\bstocks?\s+with\s+whale\b/,
      /\bwhale\s+activity\b/,
      /\bwhale\s+alerts?\b/,
      /\bintraday\s+session\b/,
      /\bmarket\s+roundup\b/,
      /\bmarket\s+update\b/,
      /\bmarket\s+activity\b/,
      /\btop\s+\d+\s+stocks?\b/,
      /\b\d+\s+.*stocks?\s+moving\b/,
      /\b\d+\s+.*stocks?\s+with\b/,
      /\bseveral\s+stocks?\b/,
      /\bmultiple\s+stocks?\b/,
      /\bsector\s+stocks?\b/,
      /\bindustry\s+stocks?\b/,
    ];

    return patterns.some(
      (pattern) =>
        pattern.test(text),
    );
  }

  private cleanup(): void {
    const maxArticles = 500;

    if (
      this.articles.size <=
      maxArticles
    ) {
      return;
    }

    const sorted =
      Array.from(
        this.articles.values(),
      ).sort(
        (a, b) =>
          new Date(
            b.created_at,
          ).getTime() -
          new Date(
            a.created_at,
          ).getTime(),
      );

    const keep =
      sorted.slice(
        0,
        maxArticles,
      );

    this.articles.clear();

    for (
      const article of keep
    ) {
      this.articles.set(
        article.id,
        article,
      );
    }

    this.seenIds =
      new Set(
        keep.map(
          (article) =>
            article.id,
        ),
      );
  }
}