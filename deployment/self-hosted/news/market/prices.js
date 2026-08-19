export const PREDICTION_INTERVALS = [
  ["12h", 12 * 60 * 60],
  ["24h", 24 * 60 * 60],
  ["48h", 48 * 60 * 60],
  ["1w", 7 * 24 * 60 * 60],
  ["2w", 14 * 24 * 60 * 60],
  ["1m", 30 * 24 * 60 * 60],
  ["3m", 91 * 24 * 60 * 60],
  ["6m", 183 * 24 * 60 * 60],
  ["1y", 365 * 24 * 60 * 60],
  ["2y", 2 * 365 * 24 * 60 * 60],
  ["3y", 3 * 365 * 24 * 60 * 60],
  ["4y", 4 * 365 * 24 * 60 * 60],
];

export function unixSeconds(value) {
  return Math.floor(new Date(value).getTime() / 1000);
}

export function isoFromUnix(seconds) {
  return new Date(seconds * 1000).toISOString();
}

export function yahooSymbol(symbol) {
  return symbol.replace(/\./g, "-");
}

export function validPoints(chart, now = Math.floor(Date.now() / 1000)) {
  return chart.timestamps
    .map((at, index) => ({ at, price: chart.closes[index] }))
    .filter((point) => Number.isFinite(point.price) && point.at <= now)
    .sort((left, right) => left.at - right.at);
}

export function nearestAfter(chart, target, now = Math.floor(Date.now() / 1000)) {
  if (target > now) return null;
  const points = validPoints(chart, now).filter((point) => point.at >= target);
  return points[0] || null;
}

export function baselinePoint(shortChart, longChart, predictionAt, now = Math.floor(Date.now() / 1000)) {
  const target = unixSeconds(predictionAt);
  return nearestAfter(shortChart, target, now) || nearestAfter(longChart, target, now);
}

export function buildIntervals({ predictionAt, direction, baseline, shortChart, longChart, now = Math.floor(Date.now() / 1000) }) {
  const base = unixSeconds(predictionAt);
  const intervals = {};
  for (const [label, seconds] of PREDICTION_INTERVALS) {
    const target = base + seconds;
    const preferred = seconds <= 48 * 60 * 60 ? shortChart : longChart;
    const point = nearestAfter(preferred, target, now) || nearestAfter(longChart, target, now);
    const change = point && baseline ? ((point.price - baseline.price) / baseline.price) * 100 : null;
    intervals[label] = {
      at: point ? isoFromUnix(point.at) : isoFromUnix(target),
      price: point?.price ?? null,
      change_pct: change,
      accurate: change === null ? null : direction === "bullish" ? change > 0 : change < 0,
    };
  }
  return intervals;
}

export function buildDailyPoints({ predictionAt, baseline, chart, now = Math.floor(Date.now() / 1000) }) {
  if (!baseline || !Number.isFinite(baseline.price) || baseline.price === 0) return [];
  const predictionEpoch = unixSeconds(predictionAt);
  const maxDay = Math.max(0, Math.floor((now - predictionEpoch) / 86400));
  const market = validPoints(chart, now).filter((point) => point.at > predictionEpoch);
  const result = [{ day_index: 0, at: isoFromUnix(predictionEpoch), price: baseline.price, change_pct: 0 }];
  let marketIndex = 0;
  let latestPrice = baseline.price;
  for (let day = 1; day <= maxDay; day += 1) {
    const target = predictionEpoch + day * 86400;
    while (marketIndex < market.length && market[marketIndex].at <= target) {
      latestPrice = market[marketIndex].price;
      marketIndex += 1;
    }
    result.push({
      day_index: day,
      at: isoFromUnix(target),
      price: latestPrice,
      change_pct: ((latestPrice - baseline.price) / baseline.price) * 100,
    });
  }
  return result;
}

export function nextCheckAt(predictionAt, intervals, now = Math.floor(Date.now() / 1000)) {
  const base = unixSeconds(predictionAt);
  const futureIntervals = PREDICTION_INTERVALS
    .filter(([label, seconds]) => intervals[label]?.price == null || base + seconds > now)
    .map(([_label, seconds]) => base + seconds)
    .filter((target) => target > now + 60);
  const ageDays = Math.max(0, Math.floor((now - base) / 86400));
  const nextDaily = base + (ageDays + 1) * 86400 + 300;
  return isoFromUnix(Math.min(nextDaily, ...(futureIntervals.length ? futureIntervals : [nextDaily])));
}

export async function fetchYahooChart(symbol, predictionAt, interval, lookaheadSeconds, fetchImpl = fetch) {
  const base = unixSeconds(predictionAt);
  const now = Math.floor(Date.now() / 1000);
  const period1 = Math.max(0, base - 3 * 86400);
  const period2 = Math.min(now + 2 * 86400, base + lookaheadSeconds);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?period1=${period1}&period2=${period2}&interval=${interval}&includePrePost=true`;
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(15000),
    headers: { accept: "application/json", "user-agent": "cartdotcom-news-signal-self-hosted/0.1" },
  });
  if (!response.ok) throw new Error(`Yahoo chart HTTP ${response.status} for ${symbol}`);
  const payload = await response.json();
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo returned no chart for ${symbol}`);
  return {
    timestamps: result.timestamp || [],
    closes: result.indicators?.quote?.[0]?.close || [],
  };
}
