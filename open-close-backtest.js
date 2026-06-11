const DATA_URL = "data/open-close-universe.json?v=20260611-openclose2";
const STARTING_EQUITY = 100000;
const TRADING_DAYS = 252;

const els = {
    strategySelect: document.getElementById("strategySelect"),
    symbolSelect: document.getElementById("symbolSelect"),
    costInput: document.getElementById("costInput"),
    finalEquity: document.getElementById("finalEquity"),
    totalReturn: document.getElementById("totalReturn"),
    maxDrawdown: document.getElementById("maxDrawdown"),
    sharpeRatio: document.getElementById("sharpeRatio"),
    winRate: document.getElementById("winRate"),
    tradeCount: document.getElementById("tradeCount"),
    bestSymbol: document.getElementById("bestSymbol"),
    bestReturn: document.getElementById("bestReturn"),
    chartTitle: document.getElementById("chartTitle"),
    chart: document.getElementById("equityChart"),
    universeSummary: document.getElementById("universeSummary"),
    symbolChips: document.getElementById("symbolChips"),
    symbolBody: document.getElementById("symbolBody"),
    ledgerBody: document.getElementById("ledgerBody")
};

const appState = {
    metadata: null,
    data: [],
    activeView: "overview",
    results: null
};

function mean(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values) {
    if (values.length < 2) return 0;
    const avg = mean(values);
    return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
}

function stdDev(values) {
    return Math.sqrt(Math.max(variance(values), 0));
}

function pct(value) {
    return `${(value * 100).toFixed(2)}%`;
}

function money(value) {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function price(value) {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(value, digits = 2) {
    return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function dailyReturn(row, symbol, direction, costBps) {
    const item = row.symbols[symbol];
    const raw = item.close / item.open - 1;
    const directional = direction === "long" ? raw : -raw;
    return directional - costBps / 10000;
}

function comparisonCurves(symbol) {
    if (symbol === "portfolio") {
        const base = Object.fromEntries(
            appState.metadata.symbols.map((item) => [item.symbol, appState.data[0].symbols[item.symbol].close])
        );
        const priceIndex = appState.data.map((row) => mean(
            appState.metadata.symbols.map((item) => row.symbols[item.symbol].close / base[item.symbol])
        ));
        return {
            buyHoldCurve: priceIndex.map((value) => STARTING_EQUITY * value),
            priceCurve: priceIndex.map((value) => value * 100),
            priceLabel: "Price index"
        };
    }

    const firstClose = appState.data[0].symbols[symbol].close;
    const closes = appState.data.map((row) => row.symbols[symbol].close);
    return {
        buyHoldCurve: closes.map((close) => STARTING_EQUITY * (close / firstClose)),
        priceCurve: closes,
        priceLabel: "Close price"
    };
}

function metricsFromReturns(returns) {
    let equity = STARTING_EQUITY;
    let peak = STARTING_EQUITY;
    let maxDrawdown = 0;
    const equityCurve = [];
    for (const value of returns) {
        equity *= 1 + value;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, peak ? (peak - equity) / peak : 0);
        equityCurve.push(equity);
    }
    const avg = returns.length ? mean(returns) : 0;
    const vol = returns.length ? stdDev(returns) : 0;
    const sharpe = vol ? (avg / vol) * Math.sqrt(TRADING_DAYS) : 0;
    const winners = returns.filter((value) => value > 0).length;

    return {
        finalEquity: equity,
        totalReturn: equity / STARTING_EQUITY - 1,
        maxDrawdown,
        sharpe,
        winRate: returns.length ? winners / returns.length : 0,
        avgDaily: avg,
        bestDay: returns.length ? Math.max(...returns) : 0,
        worstDay: returns.length ? Math.min(...returns) : 0,
        trades: returns.length,
        equityCurve
    };
}

function computeResults() {
    const direction = els.strategySelect.value;
    const costBps = Number(els.costInput.value || 0);
    const symbols = appState.metadata.symbols.map((item) => item.symbol);
    const symbolResults = symbols.map((symbol) => {
        const returns = appState.data.map((row) => dailyReturn(row, symbol, direction, costBps));
        const metrics = metricsFromReturns(returns);
        return { symbol, meta: appState.metadata.symbols.find((item) => item.symbol === symbol), returns, ...metrics, ...comparisonCurves(symbol) };
    });
    const portfolioReturns = appState.data.map((_, index) => mean(symbolResults.map((result) => result.returns[index])));
    const portfolio = {
        symbol: "portfolio",
        meta: { symbol: "portfolio", name: "Equal-weight portfolio", group: "All symbols" },
        returns: portfolioReturns,
        ...metricsFromReturns(portfolioReturns),
        ...comparisonCurves("portfolio")
    };
    const allResults = [portfolio, ...symbolResults];
    return {
        direction,
        costBps,
        symbols,
        portfolio,
        symbolResults,
        allResults
    };
}

function selectedResult() {
    const selected = els.symbolSelect.value;
    return appState.results.allResults.find((result) => result.symbol === selected) || appState.results.portfolio;
}

function drawChart(result) {
    const canvas = els.chart;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const pad = { top: 44, right: 72, bottom: 34, left: 56 };
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#181b20";
    ctx.fillRect(0, 0, width, height);

    const values = result.equityCurve;
    const buyHold = result.buyHoldCurve;
    const prices = result.priceCurve;
    if (values.length < 2 || buyHold.length < 2 || prices.length < 2) return;

    const min = Math.min(...values, ...buyHold);
    const max = Math.max(...values, ...buyHold);
    const range = max - min || 1;
    const priceMin = Math.min(...prices);
    const priceMax = Math.max(...prices);
    const priceRange = priceMax - priceMin || 1;
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const xFor = (index) => pad.left + (index / Math.max(values.length - 1, 1)) * plotW;
    const yFor = (value) => pad.top + ((max - value) / range) * plotH;
    const yForPrice = (value) => pad.top + ((priceMax - value) / priceRange) * plotH;

    const drawSeries = (series, color, yScale, lineWidth = 2) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        series.forEach((value, index) => {
            const x = xFor(index);
            const y = yScale(value);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    };

    ctx.strokeStyle = "#383f4b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 4; i += 1) {
        const y = pad.top + (plotH * i) / 4;
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
    }
    ctx.stroke();

    drawSeries(values, result.totalReturn >= 0 ? "#a4f0c8" : "#ffb4b1", yFor, 2.3);
    drawSeries(buyHold, "#79c6ff", yFor, 2);
    drawSeries(prices, "#f2c56b", yForPrice, 1.8);

    ctx.fillStyle = "#9aa3b2";
    ctx.font = "12px Segoe UI";
    ctx.fillText(money(max), width - pad.right + 8, pad.top + 5);
    ctx.fillText(money(min), width - pad.right + 8, height - pad.bottom);
    ctx.fillStyle = "#f2c56b";
    ctx.fillText(priceMax.toFixed(result.symbol === "portfolio" ? 1 : 2), width - pad.right + 8, pad.top + 20);
    ctx.fillText(priceMin.toFixed(result.symbol === "portfolio" ? 1 : 2), width - pad.right + 8, height - pad.bottom - 15);
    ctx.fillStyle = "#a4f0c8";
    ctx.fillRect(pad.left, 17, 20, 3);
    ctx.fillText("intraday strategy", pad.left + 28, 21);
    ctx.fillStyle = "#79c6ff";
    ctx.fillRect(pad.left + 146, 17, 20, 3);
    ctx.fillText("buy and hold", pad.left + 174, 21);
    ctx.fillStyle = "#f2c56b";
    ctx.fillRect(pad.left + 270, 17, 20, 3);
    ctx.fillText(result.priceLabel, pad.left + 298, 21);
    ctx.fillStyle = "#9aa3b2";
    ctx.fillText(appState.data[0].date, pad.left, height - 12);
    ctx.fillText(appState.data[appState.data.length - 1].date, width - pad.right - 74, height - 12);
}

function renderMetrics(result) {
    const best = appState.results.symbolResults.slice().sort((a, b) => b.totalReturn - a.totalReturn)[0];
    els.finalEquity.textContent = money(result.finalEquity);
    els.totalReturn.textContent = `${pct(result.totalReturn)} total return`;
    els.maxDrawdown.textContent = pct(result.maxDrawdown);
    els.sharpeRatio.textContent = `${num(result.sharpe, 2)} Sharpe`;
    els.winRate.textContent = pct(result.winRate);
    els.tradeCount.textContent = `${result.trades.toLocaleString()} daily trades`;
    els.bestSymbol.textContent = best.symbol;
    els.bestReturn.textContent = `${best.meta.name} · ${pct(best.totalReturn)}`;
    els.chartTitle.textContent = `${result.meta.name} · ${els.strategySelect.options[els.strategySelect.selectedIndex].text}`;
}

function renderUniverse() {
    const metadata = appState.metadata;
    els.universeSummary.textContent = `${metadata.symbols.length} symbols · ${metadata.startDate} to ${metadata.endDate}`;
    els.symbolChips.innerHTML = metadata.symbols.map((item) => `
        <article class="symbol-chip">
            <strong>${item.symbol} · ${item.name}</strong>
            <span>${item.group}</span>
        </article>
    `).join("");
}

function renderSymbolTable() {
    els.symbolBody.innerHTML = appState.results.symbolResults
        .slice()
        .sort((a, b) => b.totalReturn - a.totalReturn)
        .map((result) => `
            <tr>
                <td>${result.symbol}</td>
                <td>${result.meta.name}</td>
                <td class="num ${result.totalReturn >= 0 ? "positive" : "negative"}">${pct(result.totalReturn)}</td>
                <td class="num">${num(result.sharpe, 2)}</td>
                <td class="num negative">${pct(result.maxDrawdown)}</td>
                <td class="num">${pct(result.winRate)}</td>
                <td class="num ${result.avgDaily >= 0 ? "positive" : "negative"}">${pct(result.avgDaily)}</td>
                <td class="num positive">${pct(result.bestDay)}</td>
                <td class="num negative">${pct(result.worstDay)}</td>
            </tr>
        `).join("");
}

function renderLedger(result) {
    const direction = appState.results.direction;
    const rows = appState.data.map((row, index) => {
        const symbol = result.symbol === "portfolio" ? "Portfolio" : result.symbol;
        const rowReturn = result.returns[index];
        const item = result.symbol === "portfolio" ? null : row.symbols[result.symbol];
        return `
            <tr>
                <td>${row.date}</td>
                <td>${symbol}</td>
                <td class="num">${item ? price(item.open) : "-"}</td>
                <td class="num">${item ? price(item.close) : "-"}</td>
                <td>${direction === "long" ? "Long intraday" : "Short intraday"}</td>
                <td class="num ${rowReturn >= 0 ? "positive" : "negative"}">${pct(rowReturn)}</td>
            </tr>
        `;
    });
    els.ledgerBody.innerHTML = rows.reverse().join("");
}

function setView(view) {
    appState.activeView = view;
    document.querySelectorAll(".tab-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.view === view);
    });
    document.querySelectorAll(".view-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `${view}View`);
    });
}

function render() {
    appState.results = computeResults();
    const result = selectedResult();
    renderMetrics(result);
    renderUniverse();
    renderSymbolTable();
    renderLedger(result);
    drawChart(result);
}

function wireEvents() {
    els.strategySelect.addEventListener("change", render);
    els.symbolSelect.addEventListener("change", render);
    els.costInput.addEventListener("input", render);
    document.querySelectorAll(".tab-button").forEach((button) => {
        button.addEventListener("click", () => setView(button.dataset.view));
    });
    window.addEventListener("resize", () => drawChart(selectedResult()));
}

async function boot() {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`Unable to load ${DATA_URL}`);
    const payload = await response.json();
    appState.metadata = payload.metadata;
    appState.data = payload.prices;
    appState.metadata.symbols.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.symbol;
        option.textContent = `${item.symbol} · ${item.name}`;
        els.symbolSelect.appendChild(option);
    });
    wireEvents();
    render();
}

boot().catch((error) => {
    console.error(error);
    document.body.insertAdjacentHTML("afterbegin", `<div class="load-error">Backtest failed to load: ${error.message}</div>`);
});
