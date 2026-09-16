import React from 'react';
import {
  Bell,
  X,
  Zap,
  TrendingUp,
  Volume2,
  ArrowUp,
} from 'lucide-react';

interface Alert {
  id: string;
  symbol: string;
  type: string;
  message: string;
  score: number;
  timestamp: number;
}

interface AlertPanelProps {
  alerts: Alert[];
  onClear: () => void;
}

function getAlertIcon(type: string) {
  const lowerType = type.toLowerCase();

  if (lowerType.includes('volume')) {
    return <Volume2 className="h-3.5 w-3.5" />;
  }

  if (lowerType.includes('breakout')) {
    return <TrendingUp className="h-3.5 w-3.5" />;
  }

  if (lowerType.includes('rapid')) {
    return <Zap className="h-3.5 w-3.5" />;
  }

  return <ArrowUp className="h-3.5 w-3.5" />;
}

function formatAlertTime(timestamp: number) {
  if (!timestamp) return '--';

  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function AlertPanel({
  alerts,
  onClear,
}: AlertPanelProps) {
  return (
    <div className="flex h-full min-h-[300px] flex-col bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-orange-400" />

          <h3 className="text-sm font-bold text-white">
            Alerts
          </h3>

          {alerts.length > 0 && (
            <span className="rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-bold text-orange-400">
              {alerts.length}
            </span>
          )}
        </div>

        {alerts.length > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center px-6 text-center">
            <Bell className="mb-3 h-8 w-8 text-gray-800" />

            <p className="text-xs font-medium text-gray-600">
              No alerts yet
            </p>

            <p className="mt-1 text-[10px] text-gray-700">
              Momentum signals will appear here
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800/70">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="px-4 py-3 transition-colors hover:bg-gray-800/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-orange-500/10 text-orange-400">
                      {getAlertIcon(alert.type)}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">
                          {alert.symbol}
                        </span>

                        <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">
                          {alert.type}
                        </span>
                      </div>

                      <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                        {alert.message}
                      </p>

                      <div className="mt-1.5 text-[9px] text-gray-600">
                        {formatAlertTime(alert.timestamp)}
                      </div>
                    </div>
                  </div>

                  <div className="flex-shrink-0 text-right">
                    <div className="text-[9px] uppercase tracking-wide text-gray-600">
                      Score
                    </div>

                    <div
                      className={`text-sm font-bold ${
                        alert.score >= 80
                          ? 'text-emerald-400'
                          : alert.score >= 70
                            ? 'text-orange-400'
                            : 'text-gray-400'
                      }`}
                    >
                      {alert.score}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}