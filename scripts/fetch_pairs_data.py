import datetime as dt
import json
import pathlib
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTFILE = ROOT / "data" / "pairs-ko-pep.json"
SYMBOLS = ("KO", "PEP")
START = dt.datetime(2021, 6, 11, tzinfo=dt.timezone.utc)
END = dt.datetime(2026, 6, 12, tzinfo=dt.timezone.utc)


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
    series = {symbol: fetch_chart(symbol) for symbol in SYMBOLS}
    common_dates = sorted(set(series["KO"]) & set(series["PEP"]))
    prices = [
        {
            "date": date,
            "koAdjClose": series["KO"][date]["adjClose"],
            "pepAdjClose": series["PEP"][date]["adjClose"],
            "koClose": series["KO"][date]["close"],
            "pepClose": series["PEP"][date]["close"],
        }
        for date in common_dates
    ]
    OUTFILE.parent.mkdir(exist_ok=True)
    OUTFILE.write_text(
        json.dumps(
            {
                "metadata": {
                    "symbols": list(SYMBOLS),
                    "source": "Yahoo Finance chart endpoint, unauthenticated public historical prices",
                    "createdDate": dt.date.today().isoformat(),
                    "startDate": common_dates[0],
                    "endDate": common_dates[-1],
                    "rows": len(prices),
                    "notes": "Adjusted close is used by the simulator; raw close is retained for audit.",
                },
                "prices": prices,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(prices)} rows to {OUTFILE}")


if __name__ == "__main__":
    main()
