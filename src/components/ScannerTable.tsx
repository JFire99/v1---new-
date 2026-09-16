import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, Flame } from 'lucide-react';
import type { StockMetrics } from '@/types/scanner';
import { formatPrice, formatVolume, formatPct, formatRelVol, getMomentumColor, getMomentumBg, getChangeColor } from '@/lib/format';

interface ScannerTableProps {
  stocks: StockMetrics[];
}

type SortKey = keyof StockMetrics;
type SortDir = 'asc' | 'desc';

interface Column {
  key: SortKey;
  label: string;
  align: 'left' | 'right' | 'center';
  sortable: boolean;
  width?: string;
}

const COLUMNS: Column[] = [
  { key: 'ticker', label: 'Ticker', align: 'left', sortable: true, width: 'w-24' },
  { key: 'price', label: 'Price', align: 'right', sortable: true, width: 'w-20' },
  { key: 'dailyChangePct', label: 'Daily %', align: 'right', sortable: true, width: 'w-20' },
  { key: 'change1mPct', label: '1m %', align: 'right', sortable: true, width: 'w-18' },
  { key: 'change5mPct', label: '5m %', align: 'right', sortable: true, width: 'w-18' },
  { key: 'volume', label: 'Volume', align: 'right', sortable: true, width: 'w-22' },
  { key: 'relVolume', label: 'Rel Vol', align: 'right', sortable: true, width: 'w-18' },
  { key: 'dayHigh', label: 'Day High', align: 'right', sortable: true, width: 'w-20' },
  { key: 'distanceFromHighPct', label: 'From High', align: 'right', sortable: true, width: 'w-20' },
  { key: 'momentumScore', label: 'Momentum', align: 'center', sortable: true, width: 'w-28' },
  { key: 'triggers', label: 'Triggers', align: 'left', sortable: false },
];

export function ScannerTable({ stocks }: ScannerTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('momentumScore');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => {
    const arr = [...stocks];
    arr.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      let cmp = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [stocks, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const getSortIcon = (key: SortKey) => {
    if (key !== sortKey) return <ChevronsUpDown className="h-3 w-3 text-gray-600" />;
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3 text-orange-500" /> : <ChevronDown className="h-3 w-3 text-orange-500" />;
  };

  if (stocks.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <Flame className="mx-auto mb-3 h-12 w-12 text-gray-700" />
          <p className="text-sm text-gray-500">No stocks match current filters</p>
          <p className="mt-1 text-xs text-gray-600">Adjust your filter settings or wait for market activity</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-[#0d1117] text-xs uppercase tracking-wider text-gray-500">
            {COLUMNS.map((col) => (
              <th
                key={String(col.key)}
                className={`px-3 py-2.5 font-semibold ${col.align === 'left' ? 'text-left' : col.align === 'right' ? 'text-right' : 'text-center'} ${col.width ?? ''} ${col.sortable ? 'cursor-pointer select-none hover:text-gray-300' : ''}`}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <div className={`flex items-center gap-1 ${col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''}`}>
                  <span>{col.label}</span>
                  {col.sortable && getSortIcon(col.key)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((stock) => (
            <tr
              key={stock.ticker}
              className="border-b border-gray-800/50 transition-colors hover:bg-gray-800/30"
            >
              {/* Ticker */}
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white">{stock.ticker}</span>
                  {stock.triggers.includes('New Daily High') && (
                    <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[10px] font-bold text-emerald-400">NEW HIGH</span>
                  )}
                </div>
              </td>

              {/* Price */}
              <td className="px-3 py-2 text-right font-mono text-gray-200">
                ${formatPrice(stock.price)}
              </td>

              {/* Daily % */}
              <td className={`px-3 py-2 text-right font-mono font-semibold ${getChangeColor(stock.dailyChangePct)}`}>
                {formatPct(stock.dailyChangePct)}
              </td>

              {/* 1m % */}
              <td className={`px-3 py-2 text-right font-mono ${getChangeColor(stock.change1mPct)}`}>
                {formatPct(stock.change1mPct)}
              </td>

              {/* 5m % */}
              <td className={`px-3 py-2 text-right font-mono ${getChangeColor(stock.change5mPct)}`}>
                {formatPct(stock.change5mPct)}
              </td>

              {/* Volume */}
              <td className="px-3 py-2 text-right font-mono text-gray-300">
                {formatVolume(stock.volume)}
              </td>

              {/* Rel Volume */}
              <td className={`px-3 py-2 text-right font-mono font-semibold ${stock.relVolume >= 5 ? 'text-orange-400' : stock.relVolume >= 2 ? 'text-yellow-400' : 'text-gray-300'}`}>
                {formatRelVol(stock.relVolume)}
              </td>

              {/* Day High */}
              <td className="px-3 py-2 text-right font-mono text-gray-400">
                ${formatPrice(stock.dayHigh)}
              </td>

              {/* Distance from high */}
              <td className={`px-3 py-2 text-right font-mono ${stock.distanceFromHighPct < 1 ? 'text-emerald-400' : stock.distanceFromHighPct < 3 ? 'text-yellow-400' : 'text-gray-400'}`}>
                -{stock.distanceFromHighPct.toFixed(2)}%
              </td>

              {/* Momentum score */}
              <td className="px-3 py-2">
                <div className="flex items-center justify-center gap-2">
                  <div className="relative h-6 w-16 overflow-hidden rounded-full bg-gray-800">
                    <div
                      className={`h-full ${getMomentumBg(stock.momentumScore)} transition-all duration-500`}
                      style={{ width: `${stock.momentumScore}%` }}
                    />
                    <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                      {stock.momentumScore}
                    </span>
                  </div>
                  {stock.momentumScore >= 75 && (
                    <Flame className={`h-4 w-4 ${getMomentumColor(stock.momentumScore)} animate-pulse`} />
                  )}
                </div>
              </td>

              {/* Triggers */}
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {stock.triggers.slice(0, 3).map((trigger: string) => (
                    <span
                      key={trigger}
                      className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-400"
                    >
                      {trigger}
                    </span>
                  ))}
                  {stock.triggers.length > 3 && (
                    <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                      +{stock.triggers.length - 3}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
