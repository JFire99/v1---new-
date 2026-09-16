import React from 'react';
import { Activity, Bell, Download, Wifi, WifiOff, Clock } from 'lucide-react';

interface ConnectionStatus {
  connected?: boolean;
  marketOpen?: boolean;
  feed?: string;
}

interface HeaderProps {
  marketStatus: string | ConnectionStatus;
  connectionStatus: string | ConnectionStatus;
  lastUpdate: number;
  totalScanned: number;
  totalAlerts: number;
  onExport: () => void;
}

export function Header({
  marketStatus,
  connectionStatus,
  totalScanned,
  totalAlerts,
  onExport,
}: HeaderProps) {
  let connected = false;
  let marketOpen = false;
  let feed = 'IEX';

  if (typeof connectionStatus === 'object' && connectionStatus !== null) {
    connected = connectionStatus.connected === true;

    if (connectionStatus.feed) {
      feed = connectionStatus.feed.toUpperCase();
    }

    if (connectionStatus.marketOpen !== undefined) {
      marketOpen = connectionStatus.marketOpen;
    }
  } else {
    connected = connectionStatus === 'LIVE';
  }

  if (typeof marketStatus === 'string') {
    marketOpen = marketStatus === 'OPEN';
  }

  const marketClass = marketOpen
    ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-400'
    : 'border-gray-700 bg-gray-800/40 text-gray-400';

  const connectionClass = connected
    ? 'border-emerald-900/50 bg-emerald-950/30 text-emerald-400'
    : 'border-red-900/50 bg-red-950/30 text-red-400';

  return (
    <header className="border-b border-gray-800 bg-[#0d1117]">
      <div className="flex items-center justify-between px-4 py-3">

        <div className="flex items-center gap-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500/10">
            <Activity className="h-5 w-5 text-orange-500" />
          </div>

          <div>
            <h1 className="text-lg font-bold tracking-tight text-white">
              JFire Momentum Scanner
            </h1>

            <p className="text-xs text-gray-500">
              Real-time US stock momentum scanner
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">

          <div
            className={
              'flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold ' +
              marketClass
            }
          >
            <Clock className="h-3.5 w-3.5" />
            {marketOpen ? 'MARKET OPEN' : 'MARKET CLOSED'}
          </div>

          <div
            className={
              'flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold ' +
              connectionClass
            }
            title={'Alpaca feed: ' + feed}
          >
            {connected ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}

            {connected ? 'LIVE' : 'DISCONNECTED'}
          </div>

          <div className="hidden items-center gap-4 border-l border-gray-800 pl-4 sm:flex">

            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-gray-600">
                Scanned
              </div>

              <div className="text-sm font-semibold text-gray-300">
                {Number(totalScanned || 0).toLocaleString()}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Bell className="h-3.5 w-3.5 text-orange-400" />

              <span className="text-sm font-semibold text-orange-400">
                {Number(totalAlerts || 0).toLocaleString()}
              </span>
            </div>

            <button
              onClick={onExport}
              className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800/50 px-3 py-1.5 text-xs font-semibold text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>

          </div>
        </div>
      </div>
    </header>
  );
}