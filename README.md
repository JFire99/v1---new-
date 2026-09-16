# JFire Momentum Scanner

A professional real-time US stock momentum scanner built with React, TypeScript, and Alpaca Markets' live data API. It scans the market for high-momentum stocks and displays them in a dark trading-dashboard UI with live alerts.

## Features

- **Real-time data** via Alpaca Markets WebSocket (no mock data, no random prices)
- **Momentum scoring** (0-100) based on daily gain, 1m/5m momentum, relative volume, volume acceleration, new highs, and breakout strength
- **Live alerts** for momentum breakouts, volume spikes, new daily highs, and rapid price movements
- **Customizable filters** — price range, daily %, 1m/5m %, volume, relative volume, momentum score, market cap, float
- **Market status** indicator (Premarket, Open, After Hours, Closed)
- **Sortable table** with all key metrics
- **Connection indicator** (LIVE, CONNECTING, ERROR, NO API KEY)
- **Export/Download** the complete project as a ZIP file
- Works during **premarket, regular session, and after-hours**

## Prerequisites

1. **Node.js 18+** — download from https://nodejs.org/
2. **Alpaca Markets account** (free) — sign up at https://alpaca.markets/
   - After signing up, go to your Paper Trading account
   - Navigate to "Your API Keys" in the dashboard
   - Generate a new API key and secret

## Installation

```bash
# 1. Install dependencies
npm install

# 2. Add your Alpaca API credentials
#    Copy the example env file and fill in your keys:
cp .env.example .env

#    Then edit .env and replace the placeholder values:
#    ALPACA_API_KEY=your_actual_api_key
#    ALPACA_API_SECRET=your_actual_api_secret
#    ALPACA_FEED=iex

# 3. Start the scanner
npm run dev
```

## Running the Scanner

1. Make sure your `.env` file has valid Alpaca credentials.
2. Run `npm run dev` to start the development server.
3. Open your browser to the URL shown in the terminal (typically `http://localhost:5173`).
4. The connection indicator in the top-right should show **LIVE** once connected.
5. The scanner will begin streaming real-time data and populating the table.

### Market Hours

The scanner works during all US market sessions:
- **Premarket**: 4:00 AM - 9:30 AM ET
- **Regular Session**: 9:30 AM - 4:00 PM ET
- **After Hours**: 4:00 PM - 8:00 PM ET
- **Closed**: Weekends and outside the above hours

During closed hours, the scanner stays connected but fewer trades will stream.

## Configuration

All scanner thresholds are configurable via the **Filters** button in the UI:

| Filter | Default | Description |
|--------|---------|-------------|
| Min Price | $0.50 | Minimum stock price |
| Max Price | $20.00 | Maximum stock price |
| Min Daily % | 4% | Minimum daily percentage gain |
| Min 1-Minute % | 0% | Minimum 1-minute change |
| Min 5-Minute % | 2% | Minimum 5-minute change |
| Min Volume | 500,000 | Minimum daily volume |
| Min Relative Volume | 2x | Minimum volume vs average |
| Min Momentum Score | 60 | Minimum momentum score (0-100) |
| Min Market Cap | Any | Optional market cap floor |
| Max Float | Any | Optional float ceiling |

## Momentum Score Calculation

The momentum score (0-100) is a weighted composite of:

| Component | Max Points | Trigger |
|-----------|-----------|---------|
| Daily % gain | 25 | >= 4% = "Daily Gain", >= 10% = "Strong Daily Gain" |
| 1-minute momentum | 15 | >= 0.5% = "1m Surge", >= 1.5% = "Rapid 1m Move" |
| 5-minute momentum | 20 | >= 2% = "5m Breakout", >= 5% = "Strong 5m Move" |
| Relative volume | 20 | >= 2x = "High Rel Vol", >= 5x = "Volume Spike" |
| Volume acceleration | 10 | >= 1.5x = "Vol Acceleration" |
| New high / breakout | 10 | At day high = "New Daily High" |

## Alert System

Alerts fire when any of the following conditions are met:
- Momentum score >= 75
- 5-minute breakout (>= 3% in 5 minutes)
- Large volume spike (relative volume >= 5x)
- New daily high reached
- Rapid price movement (>= 2% in 1 minute)

Each alert shows: time, ticker, price, percentage move, volume, relative volume, momentum score, and the reason(s) for the alert.

## Export Project as ZIP

Click the **Export ZIP** button in the header to download the complete project source code as a ZIP file.

## Data Feed

- **IEX (default, free)**: Real-time trade data from the Investors Exchange. Available on all Alpaca accounts at no cost.
- **SIP (paid)**: Consolidated tape data from all US exchanges. Requires an Alpaca data subscription. Change `ALPACA_FEED=sip` in your `.env` file to use this.

## Building for Production

```bash
npm run build
```

This produces an optimized build in the `dist/` directory.

## Tech Stack

- **React 18** + **TypeScript** — frontend framework
- **Vite** — build tool and dev server
- **Tailwind CSS** — styling
- **Lucide React** — icons
- **Alpaca Markets API** — real-time stock market data (WebSocket + REST)
- **JSZip** — project export functionality

## Important Notes

- This scanner does **NOT** place any trades. It is a signal/scanner tool only.
- Alpaca's free IEX feed provides real-time data for most US stocks. Some less liquid symbols may have limited data.
- The scanner monitors ~200+ active symbols sourced from Alpaca's screener endpoints (most actives, gainers, losers).
- No financial advice — this tool is for informational and research purposes only.

## Troubleshooting

### "NO API KEY" status
Your `.env` file is missing or the Alpaca credentials are not set. Make sure `ALPACA_API_KEY` and `ALPACA_API_SECRET` are filled in correctly.

### "ERROR" status
The WebSocket connection failed. This can happen if:
- Your API credentials are invalid
- The Alpaca API is temporarily unavailable
- Network issues

The scanner will automatically attempt to reconnect every 5 seconds.

### No stocks showing
- Check that the market is open (or in premarket/after-hours)
- Try loosening your filter thresholds (lower minimums)
- Some periods have low market activity — wait for more trades

### "CONNECTING" status persists
The scanner is establishing the WebSocket connection. This should resolve to LIVE within a few seconds. If it doesn't, check your credentials.
