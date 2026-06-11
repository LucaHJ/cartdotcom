import datetime as dt
import json
import pathlib
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTFILE = ROOT / "data" / "pairs-universe.json"
START = dt.datetime(2021, 6, 11, tzinfo=dt.timezone.utc)
END = dt.datetime(2026, 6, 12, tzinfo=dt.timezone.utc)

PAIRS = [
    {"id": "KO_PEP", "left": "KO", "right": "PEP", "label": "Coca-Cola / PepsiCo", "theme": "Beverages"},
    {"id": "HD_LOW", "left": "HD", "right": "LOW", "label": "Home Depot / Lowe's", "theme": "Home improvement"},
    {"id": "V_MA", "left": "V", "right": "MA", "label": "Visa / Mastercard", "theme": "Payment networks"},
    {"id": "XOM_CVX", "left": "XOM", "right": "CVX", "label": "Exxon Mobil / Chevron", "theme": "Integrated oil"},
    {"id": "JPM_BAC", "left": "JPM", "right": "BAC", "label": "JPMorgan / Bank of America", "theme": "Large banks"},
    {"id": "UNP_CSX", "left": "UNP", "right": "CSX", "label": "Union Pacific / CSX", "theme": "Railroads"},
    {"id": "MCD_YUM", "left": "MCD", "right": "YUM", "label": "McDonald's / Yum Brands", "theme": "Quick service restaurants"},
    {"id": "PG_CL", "left": "PG", "right": "CL", "label": "Procter & Gamble / Colgate", "theme": "Consumer staples"},
    {"id": "UPS_FDX", "left": "UPS", "right": "FDX", "label": "UPS / FedEx", "theme": "Parcel logistics"},
    {"id": "CAT_DE", "left": "CAT", "right": "DE", "label": "Caterpillar / Deere", "theme": "Industrial equipment"},
    {"id": "DAL_UAL", "left": "DAL", "right": "UAL", "label": "Delta / United Airlines", "theme": "Airlines"},
    {"id": "MRK_PFE", "left": "MRK", "right": "PFE", "label": "Merck / Pfizer", "theme": "Pharmaceuticals"},
]


def symbols():
    unique = set()
    for pair in PAIRS:
        unique.add(pair["left"])
        unique.add(pair["right"])
    return sorted(unique)


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
    adj_closes = result["indicators"]["adjclose"][0]["adjclose"]
    closes = result["indicators"]["quote"][0]["close"]
    rows = {}
    for timestamp, adj_close, close in zip(timestamps, adj_closes, closes):
        if adj_close is None or close is None:
            continue
        rows[dt.datetime.utcfromtimestamp(timestamp).date().isoformat()] = {
            "adjClose": round(float(adj_close), 6),
            "close": round(float(close), 6),
        }
    return rows


def main():
    all_symbols = symbols()
    series = {symbol: fetch_chart(symbol) for symbol in all_symbols}
    common_dates = sorted(set.intersection(*(set(series[symbol]) for symbol in all_symbols)))
    prices = []
    for date in common_dates:
        prices.append(
            {
                "date": date,
                "symbols": {
                    symbol: {
                        "adjClose": series[symbol][date]["adjClose"],
                        "close": series[symbol][date]["close"],
                    }
                    for symbol in all_symbols
                },
            }
        )
    OUTFILE.parent.mkdir(exist_ok=True)
    OUTFILE.write_text(
        json.dumps(
            {
                "metadata": {
                    "symbols": all_symbols,
                    "pairs": PAIRS,
                    "source": "Yahoo Finance chart endpoint, unauthenticated public historical prices",
                    "createdDate": dt.date.today().isoformat(),
                    "startDate": common_dates[0],
                    "endDate": common_dates[-1],
                    "rows": len(prices),
                    "notes": "Adjusted close is used by the scanner; raw close is retained for audit.",
                },
                "prices": prices,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(prices)} rows, {len(all_symbols)} symbols, {len(PAIRS)} pairs to {OUTFILE}")


if __name__ == "__main__":
    main()
