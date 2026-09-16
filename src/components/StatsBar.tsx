import React, { useMemo } from 'react';

interface Stock {
  symbol: string;
  price: number;
  dailyChange: number;
  oneMinuteChange: number;
  fiveMinuteChange: number;
  volume: number;
  relativeVolume: number;
  dayHigh: number;
  distanceFromHigh: number;
  score: number;
}

interface StatsBarProps {
  stocks: Stock[];
  totalScanned: number;
}

export function StatsBar({ stocks, totalScanned }: StatsBarProps) {
  const stats = useMemo(() => {
    if (!stocks.length) {
      return {
        topGainer: null as Stock | null,
        topMomentum: null as Stock | null,
        topRelVol: null as Stock | null,
        avgScore: 0,
      };
    }

    const topGainer = [...stocks].sort(
      (a, b) => b.dailyChange - a.dailyChange,
    )[0];

    const topMomentum = [...stocks].sort(
      (a, b) => b.fiveMinuteChange - a.fiveMinuteChange,
    )[0];

    const topRelVol = [...stocks].sort(
      (a, b) => b.relativeVolume - a.relativeVolume,
    )[0];

    const avgScore =
      stocks.reduce((sum, stock) => sum + stock.score, 0) / stocks.length;

    return {
      topGainer,
      topMomentum,
      topRelVol,
      avgScore,
    };
  }, [stocks]);

  return (
    <div className="grid grid-cols-2 border-b border-gray-800 bg-[#0d1117] lg:grid-cols-4">
      <div className="border-r border-gray-800 px-4 py-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
          Top Gainer
        </div>

        {stats.topGainer ? (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-white">
              {stats.topGainer.symbol}
            </span>
            <span className="text-sm font-semibold text-emerald-400">
              +{stats.topGainer.dailyChange.toFixed(2)}%
            </span>
          </div>
        ) : (
          <span className="text-sm text-gray-600">--</span>
        )}
      </div>

      <div className="border-r border-gray-800 px-4 py-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
          Momentum
        </div>

        {stats.topMomentum ? (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-white">
              {stats.topMomentum.symbol}
            </span>
            <span className="text-sm font-semibold text-orange-400">
              {stats.topMomentum.fiveMinuteChange >= 0 ? '+' : ''}
              {stats.topMomentum.fiveMinuteChange.toFixed(2)}%
            </span>
          </div>
        ) : (
          <span className="text-sm text-gray-600">--</span>
        )}
      </div>

      <div className="border-r border-gray-800 px-4 py-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
          Rel Vol
        </div>

        {stats.topRelVol ? (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-white">
              {stats.topRelVol.symbol}
            </span>
            <span className="text-sm font-semibold text-blue-400">
              {stats.topRelVol.relativeVolume.toFixed(1)}x
            </span>
          </div>
        ) : (
          <span className="text-sm text-gray-600">--</span>
        )}
      </div>

      <div className="px-4 py-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
          Avg Score
        </div>

        {stocks.length ? (
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-orange-400">
              {stats.avgScore.toFixed(1)}
            </span>
            <span className="text-xs text-gray-600">
              / 100 · {totalScanned.toLocaleString()} scanned
            </span>
          </div>
        ) : (
          <span className="text-sm text-gray-600">--</span>
        )}
      </div>
    </div>
  );
}