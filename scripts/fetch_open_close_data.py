import datetime as dt
import json
import pathlib
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTFILE = ROOT / "data" / "open-close-universe.json"
START = dt.datetime(2021, 6, 11, tzinfo=dt.timezone.utc)
END = dt.datetime(2026, 6, 12, tzinfo=dt.timezone.utc)
SYMBOLS = [
    {"symbol": "AAPL", "name": "Apple", "group": "Mega-cap tech"},
    {"symbol": "MSFT", "name": "Microsoft", "group": "Mega-cap tech"},
    {"symbol": "NVDA", "name": "Nvidia", "group": "Semiconductors"},
    {"symbol": "TSLA", "name": "Tesla", "group": "Consumer discretionary"},
    {"symbol": "AMZN", "name": "Amazon", "group": "Consumer internet"},
    {"symbol": "META", "name": "Meta Platforms", "group": "Consumer internet"},
    {"symbol": "JPM", "name": "JPMorgan Chase", "group": "Financials"},
    {"symbol": "XOM", "name": "Exxon Mobil", "group": "Energy"},
    {"symbol": "KO", "name": "Coca-Cola", "group": "Consumer staples"},
    {"symbol": "WMT", "name": "Walmart", "group": "Consumer staples"},
    {"symbol": "SPY", "name": "S&P 500 ETF", "group": "Market ETF"},
    {"symbol": "QQQ", "name": "Nasdaq 100 ETF", "group": "Market ETF"},
]


def fetch_chart(symbol):
    period1 = int(START.timestamp())
    period2 = int(END.timestamp())
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
        f"?period1={period1}&period2={period2}&interval=1d"
        "&events=history&includeAdjustedClose=true"
    )
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    result = payload["chart"]["result"][0]
    timestamps = result["timestamp"]
    quote = result["indicators"]["quote"][0]
    adj_closes = result["indicators"]["adjclose"][0]["adjclose"]
    rows = {}
    for index, timestamp in enumerate(timestamps):
        open_price = quote["open"][index]
        close_price = quote["close"][index]
        volume = quote["volume"][index]
        adj_close = adj_closes[index]
        if open_price is None or close_price is None or volume is None:
            continue
        rows[dt.datetime.utcfromtimestamp(timestamp).date().isoformat()] = {
            "open": round(float(open_price), 6),
            "close": round(float(close_price), 6),
            "adjClose": round(float(adj_close), 6) if adj_close is not None else None,
            "volume": int(volume),
        }
    return rows


def main():
    symbols = [item["symbol"] for item in SYMBOLS]
    series = {symbol: fetch_chart(symbol) for symbol in symbols}
    common_dates = sorted(set.intersection(*(set(series[symbol]) for symbol in symbols)))
    prices = []
    for date in common_dates:
        prices.append(
            {
                "date": date,
                "symbols": {symbol: series[symbol][date] for symbol in symbols},
            }
        )
    OUTFILE.parent.mkdir(exist_ok=True)
    OUTFILE.write_text(
        json.dumps(
            {
                "metadata": {
                    "symbols": SYMBOLS,
                    "source": "Yahoo Finance chart endpoint, unauthenticated public historical prices",
                    "createdDate": dt.date.today().isoformat(),
                    "startDate": common_dates[0],
                    "endDate": common_dates[-1],
                    "rows": len(prices),
                    "notes": "The backtest uses raw daily open and close prices only; dividends and overnight returns are intentionally excluded.",
                },
                "prices": prices,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(prices)} rows and {len(symbols)} symbols to {OUTFILE}")


if __name__ == "__main__":
    main()
