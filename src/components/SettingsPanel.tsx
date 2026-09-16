import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, X, RotateCcw } from 'lucide-react';
import type { ScannerSettings } from '@/types/scanner';
import { DEFAULT_SETTINGS } from '@/types/scanner';

interface SettingsPanelProps {
  settings: ScannerSettings;
  onApply: (settings: Partial<ScannerSettings>) => void;
  isOpen: boolean;
  onClose: () => void;
}

interface NumberInputProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  step?: string;
  placeholder?: string;
}

function NumberInput({ label, value, onChange, step = '0.01', placeholder }: NumberInputProps) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-400">{label}</label>
      <input
        type="number"
        step={step}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? null : parseFloat(v));
        }}
        className="w-full rounded-md border border-gray-700 bg-[#0d1117] px-3 py-2 text-sm text-white outline-none transition-colors focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
      />
    </div>
  );
}

export function SettingsPanel({ settings, onApply, isOpen, onClose }: SettingsPanelProps) {
  const [local, setLocal] = useState<ScannerSettings>(settings);

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  const handleApply = () => {
    onApply(local);
    onClose();
  };

  const handleReset = () => {
    setLocal({ ...DEFAULT_SETTINGS });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="mt-20 max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-gray-800 bg-[#0a0e14] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-800 bg-[#0a0e14] px-5 py-4">
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-orange-500" />
            <h2 className="text-base font-bold text-white">Scanner Settings</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-5">
          {/* Price filters */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Price Filters</h3>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput
                label="Minimum Price ($)"
                value={local.minPrice}
                onChange={(v) => setLocal({ ...local, minPrice: v ?? 0 })}
                step="0.01"
                placeholder="0.50"
              />
              <NumberInput
                label="Maximum Price ($)"
                value={local.maxPrice}
                onChange={(v) => setLocal({ ...local, maxPrice: v ?? 9999 })}
                step="0.01"
                placeholder="20.00"
              />
            </div>
          </div>

          {/* Momentum filters */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Momentum Filters</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <NumberInput
                label="Min Daily %"
                value={local.minDailyChangePct}
                onChange={(v) => setLocal({ ...local, minDailyChangePct: v ?? 0 })}
                step="0.1"
                placeholder="4"
              />
              <NumberInput
                label="Min 1-Minute %"
                value={local.min1mChangePct}
                onChange={(v) => setLocal({ ...local, min1mChangePct: v ?? 0 })}
                step="0.1"
                placeholder="0"
              />
              <NumberInput
                label="Min 5-Minute %"
                value={local.min5mChangePct}
                onChange={(v) => setLocal({ ...local, min5mChangePct: v ?? 0 })}
                step="0.1"
                placeholder="2"
              />
              <NumberInput
                label="Min Momentum Score"
                value={local.minMomentumScore}
                onChange={(v) => setLocal({ ...local, minMomentumScore: v ?? 0 })}
                step="1"
                placeholder="60"
              />
            </div>
          </div>

          {/* Volume filters */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Volume & Liquidity Filters</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <NumberInput
                label="Min Volume (shares)"
                value={local.minVolume}
                onChange={(v) => setLocal({ ...local, minVolume: v ?? 0 })}
                step="5000"
                placeholder="10000"
              />
              <NumberInput
                label="Min Dollar Volume ($)"
                value={local.minDollarVolume}
                onChange={(v) => setLocal({ ...local, minDollarVolume: v ?? 0 })}
                step="10000"
                placeholder="50000"
              />
              <NumberInput
                label="Min Relative Volume (x)"
                value={local.minRelVolume}
                onChange={(v) => setLocal({ ...local, minRelVolume: v ?? 0 })}
                step="0.1"
                placeholder="1.5"
              />
            </div>
          </div>

          {/* Market cap & float */}
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Market Cap & Float (Optional)</h3>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput
                label="Min Market Cap ($)"
                value={local.minMarketCap}
                onChange={(v) => setLocal({ ...local, minMarketCap: v })}
                step="1000000"
                placeholder="Any"
              />
              <NumberInput
                label="Max Float (shares)"
                value={local.maxFloat}
                onChange={(v) => setLocal({ ...local, maxFloat: v })}
                step="1000000"
                placeholder="Any"
              />
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 flex items-center justify-between border-t border-gray-800 bg-[#0a0e14] px-5 py-4">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <RotateCcw className="h-4 w-4" />
            Reset Defaults
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="rounded-md bg-gradient-to-r from-orange-500 to-red-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition-all hover:shadow-orange-500/40 hover:brightness-110 active:scale-95"
            >
              Apply Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
