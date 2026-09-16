import type { MarketSessionInfo, MarketSessionTransition, MarketSessionType } from './types/scanner';

/**
 * Single authoritative market session detector for US Equities.
 * Always computed in 'America/New_York' timezone to naturally handle EST/EDT daylight savings.
 *
 * Sessions:
 * - PRE_MARKET: 04:00–09:30 ET Monday–Friday
 * - REGULAR:    09:30–16:00 ET Monday–Friday
 * - AFTER_HOURS: 16:00–20:00 ET Monday–Friday
 * - OVERNIGHT:   20:00–04:00 ET Sunday–Friday
 * - CLOSED:      Friday 20:00 to Sunday 20:00 ET, or full NYSE holidays
 */

export interface EtTimeParts {
  year: number;
  month: number;
  day: number;
  weekday: string; // 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat'
  hour: number; // 0..23
  minute: number; // 0..59
  second: number; // 0..59
  dateStr: string; // 'YYYY-MM-DD'
  timeStr: string; // 'HH:MM:SS'
  minutesOfDay: number; // 0..1439
}

export function getEtTimeParts(d: Date = new Date()): EtTimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(formatter.formatToParts(d).map((p) => [p.type, p.value]));
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const second = parseInt(parts.second, 10);
  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10);
  const day = parseInt(parts.day, 10);
  const weekday = parts.weekday;
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  const timeStr = `${parts.hour}:${parts.minute}:${parts.second}`;
  const minutesOfDay = hour * 60 + minute;

  return {
    year,
    month,
    day,
    weekday,
    hour,
    minute,
    second,
    dateStr,
    timeStr,
    minutesOfDay,
  };
}

export function formatCountdown(minutes: number): string {
  if (minutes <= 0) return 'now';
  const days = Math.floor(minutes / (24 * 60));
  const remainingMinutes = minutes % (24 * 60);
  const hours = Math.floor(remainingMinutes / 60);
  const mins = remainingMinutes % 60;

  if (days > 0) {
    return `in ${days}d ${hours}h`;
  }
  if (hours > 0) {
    return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  }
  return `in ${mins}m`;
}

export function getMarketSession(
  now: Date = new Date(),
  holidays?: Set<string>,
  configuredFeed: string = 'iex'
): MarketSessionInfo {
  const et = getEtTimeParts(now);
  const isHoliday = holidays ? holidays.has(et.dateStr) : false;

  let session: MarketSessionType = 'CLOSED';
  let targetSession: MarketSessionType = 'CLOSED';
  let minutesToTarget = 0;
  let targetTimeEt = '';

  const { weekday, minutesOfDay, second } = et;

  if (isHoliday) {
    // Holiday trading rule: regular and extended hours are closed
    session = 'CLOSED';
    // If tomorrow is a weekday and not a holiday, overnight starts at 20:00 ET tonight
    targetSession = 'OVERNIGHT';
    minutesToTarget = 1200 - minutesOfDay;
    if (minutesToTarget <= 0) {
      minutesToTarget += 1440;
    }
    targetTimeEt = '20:00 ET';
  } else if (weekday === 'Sun') {
    if (minutesOfDay < 1200) {
      session = 'CLOSED';
      targetSession = 'OVERNIGHT';
      minutesToTarget = 1200 - minutesOfDay;
      targetTimeEt = '20:00 ET';
    } else {
      session = 'OVERNIGHT';
      targetSession = 'PRE_MARKET';
      minutesToTarget = (1440 - minutesOfDay) + 240; // Next morning 04:00
      targetTimeEt = '04:00 ET (Mon)';
    }
  } else if (weekday === 'Sat') {
    session = 'CLOSED';
    targetSession = 'OVERNIGHT';
    minutesToTarget = (1440 - minutesOfDay) + 1440 + 1200; // Sunday 20:00 ET
    targetTimeEt = '20:00 ET (Sun)';
  } else if (['Mon', 'Tue', 'Wed', 'Thu'].includes(weekday)) {
    if (minutesOfDay < 240) {
      session = 'OVERNIGHT';
      targetSession = 'PRE_MARKET';
      minutesToTarget = 240 - minutesOfDay;
      targetTimeEt = '04:00 ET';
    } else if (minutesOfDay < 570) {
      session = 'PRE_MARKET';
      targetSession = 'REGULAR';
      minutesToTarget = 570 - minutesOfDay;
      targetTimeEt = '09:30 ET';
    } else if (minutesOfDay < 960) {
      session = 'REGULAR';
      targetSession = 'AFTER_HOURS';
      minutesToTarget = 960 - minutesOfDay;
      targetTimeEt = '16:00 ET';
    } else if (minutesOfDay < 1200) {
      session = 'AFTER_HOURS';
      targetSession = 'OVERNIGHT';
      minutesToTarget = 1200 - minutesOfDay;
      targetTimeEt = '20:00 ET';
    } else {
      session = 'OVERNIGHT';
      targetSession = 'PRE_MARKET';
      minutesToTarget = (1440 - minutesOfDay) + 240;
      targetTimeEt = '04:00 ET';
    }
  } else if (weekday === 'Fri') {
    if (minutesOfDay < 240) {
      session = 'OVERNIGHT';
      targetSession = 'PRE_MARKET';
      minutesToTarget = 240 - minutesOfDay;
      targetTimeEt = '04:00 ET';
    } else if (minutesOfDay < 570) {
      session = 'PRE_MARKET';
      targetSession = 'REGULAR';
      minutesToTarget = 570 - minutesOfDay;
      targetTimeEt = '09:30 ET';
    } else if (minutesOfDay < 960) {
      session = 'REGULAR';
      targetSession = 'AFTER_HOURS';
      minutesToTarget = 960 - minutesOfDay;
      targetTimeEt = '16:00 ET';
    } else if (minutesOfDay < 1200) {
      session = 'AFTER_HOURS';
      targetSession = 'CLOSED';
      minutesToTarget = 1200 - minutesOfDay;
      targetTimeEt = '20:00 ET';
    } else {
      session = 'CLOSED';
      targetSession = 'OVERNIGHT';
      minutesToTarget = (1440 - minutesOfDay) + 1440 + 1200; // Sunday 20:00 ET
      targetTimeEt = '20:00 ET (Sun)';
    }
  }

  // Calculate target timestamp
  const targetMs = now.getTime() + (minutesToTarget * 60 - second) * 1000;
  const targetTimeIso = new Date(targetMs).toISOString();

  // Badges & Display Labels
  let sessionBadge = 'CLOSED';
  let displayStatus = 'CLOSED';
  let feedBadge = 'IEX';
  let feedDescription = 'Alpaca Market Data';
  const isExtendedHours = session === 'PRE_MARKET' || session === 'AFTER_HOURS' || session === 'OVERNIGHT';
  const isOpen = session !== 'CLOSED';

  const baseFeedName = (configuredFeed || 'iex').toUpperCase();

  switch (session) {
    case 'PRE_MARKET':
      sessionBadge = 'PRE-MARKET';
      displayStatus = 'PRE-MARKET — LIVE';
      feedBadge = baseFeedName;
      feedDescription = `Alpaca ${baseFeedName} Real-Time Extended Hours`;
      break;
    case 'REGULAR':
      sessionBadge = 'REGULAR';
      displayStatus = 'REGULAR MARKET — LIVE';
      feedBadge = baseFeedName;
      feedDescription = `Alpaca ${baseFeedName} Real-Time Regular Session`;
      break;
    case 'AFTER_HOURS':
      sessionBadge = 'AFTER-HOURS';
      displayStatus = 'AFTER-HOURS — LIVE';
      feedBadge = baseFeedName;
      feedDescription = `Alpaca ${baseFeedName} Real-Time Extended Hours`;
      break;
    case 'OVERNIGHT':
      sessionBadge = 'OVERNIGHT';
      displayStatus = 'OVERNIGHT — 15M DELAYED';
      feedBadge = 'OVERNIGHT';
      feedDescription = 'Alpaca Overnight 24/5 Feed (15M Delayed Trades / Real-Time Indicative Quotes)';
      break;
    case 'CLOSED':
    default:
      sessionBadge = 'CLOSED';
      displayStatus = 'CLOSED';
      feedBadge = 'OFFLINE';
      feedDescription = 'US Equity Markets Closed';
      break;
  }

  const targetBadge =
    targetSession === 'PRE_MARKET'
      ? 'PRE-MARKET'
      : targetSession === 'REGULAR'
      ? 'REGULAR'
      : targetSession === 'AFTER_HOURS'
      ? 'AFTER-HOURS'
      : targetSession === 'OVERNIGHT'
      ? 'OVERNIGHT'
      : 'CLOSED';

  const nextTransition: MarketSessionTransition = {
    targetSession,
    targetBadge,
    targetTimeEt,
    targetTimeIso,
    countdownMinutes: minutesToTarget,
    countdownFormatted: formatCountdown(minutesToTarget),
  };

  return {
    session,
    sessionBadge,
    displayStatus,
    feedBadge,
    feedDescription,
    isExtendedHours,
    isOpen,
    currentEtTime: `${et.timeStr} ET`,
    currentEtDate: et.dateStr,
    isHoliday,
    holidayName: isHoliday ? 'Market Holiday' : null,
    nextTransition,
  };
}
