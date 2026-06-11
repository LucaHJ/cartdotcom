const DATA_URL = "data/pairs-universe.json?v=20260611";
const STARTING_EQUITY = 100000;
const TRADING_DAYS = 252;

const STRATEGIES = [
    {
        id: "scanner_conservative",
        name: "Scanner / conservative",
        method: "beta",
        lookback: 504,
        entryZ: 2.2,
        exitZ: 0.35,
        stopZ: 3.4,
        maxHold: 35,
        riskPct: 0.0035,
        grossCap: 0.45,
        maxOpenPairs: 3,
        profitR: 1.35,
        minCorr: 0.78,
        minHalfLife: 2,
        maxHalfLife: 24,
        minStationarityT: -2.4,
        maxBetaDrift: 0.22,
        costBps: 5,
        riskLabel: "Low"
    },
    {
        id: "scanner_balanced",
        name: "Scanner / balanced",
        method: "beta",
        lookback: 378,
        entryZ: 1.85,
        exitZ: 0.5,
        stopZ: 3.8,
        maxHold: 45,
        riskPct: 0.006,
        grossCap: 0.65,
        maxOpenPairs: 4,
        profitR: 1.6,
        minCorr: 0.68,
        minHalfLife: 2,
        maxHalfLife: 36,
        minStationarityT: -1.85,
        maxBetaDrift: 0.35,
        costBps: 5,
        riskLabel: "Medium"
    },
    {
        id: "scanner_active",
        name: "Scanner / active",
        method: "beta",
        lookback: 252,
        entryZ: 1.55,
        exitZ: 0.65,
        stopZ: 4.2,
        maxHold: 60,
        riskPct: 0.008,
        grossCap: 0.85,
        maxOpenPairs: 5,
        profitR: 1.8,
        minCorr: 0.6,
        minHalfLife: 1,
        maxHalfLife: 48,
        minStationarityT: -1.55,
        maxBetaDrift: 0.45,
        costBps: 6,
        riskLabel: "High"
    },
    {
        id: "scanner_quality",
        name: "Scanner / quality gate",
        method: "beta",
        lookback: 504,
        entryZ: 2.45,
        exitZ: 0.25,
        stopZ: 3.25,
        maxHold: 30,
        riskPct: 0.003,
        grossCap: 0.4,
        maxOpenPairs: 2,
        profitR: 1.15,
        minCorr: 0.82,
        minHalfLife: 2,
        maxHalfLife: 18,
        minStationarityT: -2.7,
        maxBetaDrift: 0.18,
        costBps: 5,
        riskLabel: "Low"
    }
];

const els = {
    strategySelect: document.getElementById("strategySelect"),
    daySlider: document.getElementById("daySlider"),
    stepBack: document.getElementById("stepBack"),
    playPause: document.getElementById("playPause"),
    stepForward: document.getElementById("stepForward"),
    finalEquity: document.getElementById("finalEquity"),
    totalReturn: document.getElementById("totalReturn"),
    maxDrawdown: document.getElementById("maxDrawdown"),
    sharpeRatio: document.getElementById("sharpeRatio"),
    tradeCount: document.getElementById("tradeCount"),
    winRate: document.getElementById("winRate"),
    currentSignal: document.getElementById("currentSignal"),
    currentDate: document.getElementById("currentDate"),
    chartTitle: document.getElementById("chartTitle"),
    zPill: document.getElementById("zPill"),
    positionPill: document.getElementById("positionPill"),
    chart: document.getElementById("simulationChart"),
    pairName: document.getElementById("pairName"),
    koPrice: document.getElementById("koPrice"),
    pepPrice: document.getElementById("pepPrice"),
    hedgeBeta: document.getElementById("hedgeBeta"),
    correlation: document.getElementById("correlation"),
    halfLife: document.getElementById("halfLife"),
    stationarity: document.getElementById("stationarity"),
    exposure: document.getElementById("exposure"),
    unrealized: document.getElementById("unrealized"),
    strategyBody: document.getElementById("strategyBody"),
    tradeBody: document.getElementById("tradeBody")
};

let appState = {
    data: [],
    pairs: [],
    results: new Map(),
    selectedId: "scanner_balanced",
    dayIndex: 0,
    timer: null
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

function covariance(a, b) {
    if (a.length !== b.length || a.length < 2) return 0;
    const avgA = mean(a);
    const avgB = mean(b);
    return a.reduce((sum, value, index) => sum + (value - avgA) * (b[index] - avgB), 0) / (a.length - 1);
}

function correlation(a, b) {
    const denom = stdDev(a) * stdDev(b);
    return denom ? covariance(a, b) / denom : 0;
}

function regressionSlope(x, y) {
    const denom = variance(x);
    return denom ? covariance(x, y) / denom : 1;
}

function olsSlopeTStat(x, y) {
    if (x.length < 4) return { slope: 0, tStat: 0 };
    const xAvg = mean(x);
    const yAvg = mean(y);
    const sxx = x.reduce((sum, value) => sum + (value - xAvg) ** 2, 0);
    if (!sxx) return { slope: 0, tStat: 0 };
    const slope = x.reduce((sum, value, index) => sum + (value - xAvg) * (y[index] - yAvg), 0) / sxx;
    const intercept = yAvg - slope * xAvg;
    const residuals = y.map((value, index) => value - (intercept + slope * x[index]));
    const residualVariance = residuals.reduce((sum, value) => sum + value ** 2, 0) / Math.max(x.length - 2, 1);
    const slopeSe = Math.sqrt(residualVariance / sxx);
    return { slope, tStat: slopeSe ? slope / slopeSe : 0 };
}

function pct(value) {
    return `${(value * 100).toFixed(2)}%`;
}

function money(value) {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function num(value, digits = 2) {
    return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function price(row, symbol) {
    return row.symbols[symbol]?.adjClose;
}

function returns(values) {
    const out = [];
    for (let i = 1; i < values.length; i += 1) {
        out.push(values[i] / values[i - 1] - 1);
    }
    return out;
}

function modelForPair(data, index, strategy, pair) {
    if (index < strategy.lookback) return null;

    const window = data.slice(index - strategy.lookback, index);
    const leftPrices = window.map((row) => price(row, pair.left));
    const rightPrices = window.map((row) => price(row, pair.right));
    if (leftPrices.some((value) => !value) || rightPrices.some((value) => !value)) return null;

    const leftLogs = leftPrices.map(Math.log);
    const rightLogs = rightPrices.map(Math.log);
    const beta = strategy.method === "ratio" ? 1 : regressionSlope(rightLogs, leftLogs);
    const shortWindow = window.slice(Math.floor(window.length / 2));
    const shortBeta = strategy.method === "ratio"
        ? 1
        : regressionSlope(
            shortWindow.map((row) => Math.log(price(row, pair.right))),
            shortWindow.map((row) => Math.log(price(row, pair.left)))
        );
    const spreads = window.map((row) => Math.log(price(row, pair.left)) - beta * Math.log(price(row, pair.right)));
    const spreadMean = mean(spreads);
    const spreadStd = stdDev(spreads);
    const currentSpread = Math.log(price(data[index], pair.left)) - beta * Math.log(price(data[index], pair.right));
    const lagged = [];
    const deltas = [];

    for (let i = 1; i < spreads.length; i += 1) {
        lagged.push(spreads[i - 1]);
        deltas.push(spreads[i] - spreads[i - 1]);
    }

    const meanReversion = olsSlopeTStat(lagged, deltas);
    const halfLife = meanReversion.slope < 0 ? -Math.log(2) / meanReversion.slope : Infinity;
    const z = spreadStd ? (currentSpread - spreadMean) / spreadStd : 0;
    const corr = correlation(returns(leftPrices), returns(rightPrices));
    const betaDrift = beta ? Math.abs(shortBeta / beta - 1) : 0;
    const filtersPass = corr >= strategy.minCorr
        && halfLife >= strategy.minHalfLife
        && halfLife <= strategy.maxHalfLife
        && meanReversion.tStat <= strategy.minStationarityT
        && betaDrift <= strategy.maxBetaDrift
        && spreadStd > strategy.costBps / 10000;

    return {
        pair,
        beta,
        z,
        corr,
        halfLife,
        stationarityT: meanReversion.tStat,
        spreadStd,
        betaDrift,
        filtersPass
    };
}

function openPosition(row, model, strategy, equity, index) {
    const { pair } = model;
    const leftPrice = price(row, pair.left);
    const rightPrice = price(row, pair.right);
    const direction = model.z > 0 ? -1 : 1;
    const riskDollars = equity * strategy.riskPct;
    const stopMove = Math.max((strategy.stopZ - Math.abs(model.z)) * model.spreadStd, 0.006);
    const rawUnit = riskDollars / stopMove;
    const pairGrossCap = (equity * strategy.grossCap) / Math.max(strategy.maxOpenPairs, 1);
    const grossUnitCap = pairGrossCap / (1 + Math.abs(model.beta));
    const unit = Math.max(0, Math.min(rawUnit, grossUnitCap));
    const leftShares = direction * unit / leftPrice;
    const rightShares = -direction * model.beta * unit / rightPrice;
    const gross = Math.abs(leftShares * leftPrice) + Math.abs(rightShares * rightPrice);
    const cost = gross * strategy.costBps / 10000;

    return {
        pair,
        openDate: row.date,
        direction,
        label: direction > 0
            ? `Long ${pair.left} / Short ${pair.right}`
            : `Short ${pair.left} / Long ${pair.right}`,
        entryZ: model.z,
        entryLeft: leftPrice,
        entryRight: rightPrice,
        leftShares,
        rightShares,
        gross,
        initialRisk: riskDollars,
        entryCost: cost,
        openIndex: index
    };
}

function positionPnl(position, row) {
    if (!position) return 0;
    return position.leftShares * (price(row, position.pair.left) - position.entryLeft)
        + position.rightShares * (price(row, position.pair.right) - position.entryRight);
}

function shouldClose(position, row, model, strategy, unrealized, index) {
    const sameSideStop = Math.sign(model.z) === Math.sign(position.entryZ) && Math.abs(model.z) >= strategy.stopZ;
    if (sameSideStop) return "spread stop";
    if (unrealized <= -position.initialRisk) return "risk stop";
    if (unrealized >= position.initialRisk * strategy.profitR) return "profit target";
    if (Math.abs(model.z) <= strategy.exitZ || Math.sign(model.z) !== Math.sign(position.entryZ)) return "convergence";
    if (index - position.openIndex >= strategy.maxHold) return "time stop";
    return "";
}

function closePosition(position, row, model, strategy, reason, unrealized, index) {
    const exitGross = Math.abs(position.leftShares * price(row, position.pair.left))
        + Math.abs(position.rightShares * price(row, position.pair.right));
    const exitCost = exitGross * strategy.costBps / 10000;
    const pnl = unrealized - position.entryCost - exitCost;

    return {
        pairId: position.pair.id,
        pairLabel: position.pair.label,
        openDate: position.openDate,
        closeDate: row.date,
        label: position.label,
        entryZ: position.entryZ,
        exitZ: model.z,
        gross: position.gross,
        pnl,
        reason,
        holdDays: index - position.openIndex
    };
}

function rankSignals(models, openPositions, strategy) {
    return models
        .filter((model) => model?.filtersPass)
        .filter((model) => !openPositions.has(model.pair.id))
        .filter((model) => Math.abs(model.z) >= strategy.entryZ)
        .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

function simulateStrategy(data, pairs, strategy) {
    let cash = STARTING_EQUITY;
    let peak = STARTING_EQUITY;
    let maxDrawdown = 0;
    const openPositions = new Map();
    const daily = [];
    const trades = [];
    const returnsSeries = [];

    for (let index = 0; index < data.length; index += 1) {
        const row = data[index];
        const models = pairs.map((pair) => modelForPair(data, index, strategy, pair));
        const modelsByPair = new Map(models.filter(Boolean).map((model) => [model.pair.id, model]));
        const decisions = [];

        for (const [pairId, position] of [...openPositions]) {
            const model = modelsByPair.get(pairId);
            if (!model) continue;
            const unrealized = positionPnl(position, row);
            const reason = shouldClose(position, row, model, strategy, unrealized, index);
            if (reason) {
                const trade = closePosition(position, row, model, strategy, reason, unrealized, index);
                trades.push(trade);
                cash += trade.pnl;
                openPositions.delete(pairId);
                decisions.push(`close ${position.pair.left}/${position.pair.right}: ${reason}`);
            }
        }

        const equityBeforeOpen = cash + [...openPositions.values()].reduce((sum, position) => sum + positionPnl(position, row), 0);
        for (const model of rankSignals(models, openPositions, strategy)) {
            if (openPositions.size >= strategy.maxOpenPairs) break;
            const position = openPosition(row, model, strategy, equityBeforeOpen, index);
            if (position.gross <= 0) continue;
            cash -= position.entryCost;
            openPositions.set(model.pair.id, position);
            decisions.push(`open ${position.pair.left}/${position.pair.right}`);
        }

        const unrealized = [...openPositions.values()].reduce((sum, position) => sum + positionPnl(position, row), 0);
        const exposure = [...openPositions.values()].reduce((sum, position) => sum + position.gross, 0);
        const equity = cash + unrealized;
        const strongest = models
            .filter(Boolean)
            .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0] || null;
        const qualifying = models.filter((model) => model?.filtersPass && Math.abs(model.z) >= strategy.entryZ).length;

        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, peak ? (peak - equity) / peak : 0);
        if (daily.length) {
            returnsSeries.push(equity / daily[daily.length - 1].equity - 1);
        }

        daily.push({
            date: row.date,
            strongest,
            equity,
            cash,
            unrealized,
            exposure,
            openCount: openPositions.size,
            decision: decisions.length ? decisions.join("; ") : qualifying ? `${qualifying} split${qualifying === 1 ? "" : "s"} detected` : "scan clear"
        });
    }

    const finalRow = data[data.length - 1];
    for (const [pairId, position] of [...openPositions]) {
        const model = modelForPair(data, data.length - 1, strategy, position.pair);
        const unrealized = positionPnl(position, finalRow);
        const trade = closePosition(position, finalRow, model, strategy, "final day", unrealized, data.length - 1);
        trades.push(trade);
        cash += trade.pnl;
        openPositions.delete(pairId);
    }
    if (daily.length) {
        daily[daily.length - 1].equity = cash;
        daily[daily.length - 1].cash = cash;
        daily[daily.length - 1].unrealized = 0;
        daily[daily.length - 1].exposure = 0;
        daily[daily.length - 1].openCount = 0;
    }

    const finalEquity = daily[daily.length - 1].equity;
    const avgReturn = returnsSeries.length ? mean(returnsSeries) : 0;
    const returnStd = returnsSeries.length ? stdDev(returnsSeries) : 0;
    const sharpe = returnStd ? (avgReturn / returnStd) * Math.sqrt(TRADING_DAYS) : 0;
    const winners = trades.filter((trade) => trade.pnl > 0);
    const grossProfit = winners.reduce((sum, trade) => sum + trade.pnl, 0);
    const grossLoss = Math.abs(trades.filter((trade) => trade.pnl < 0).reduce((sum, trade) => sum + trade.pnl, 0));

    return {
        strategy,
        daily,
        trades,
        finalEquity,
        totalReturn: finalEquity / STARTING_EQUITY - 1,
        maxDrawdown,
        sharpe,
        winRate: trades.length ? winners.length / trades.length : 0,
        profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0,
        avgHold: trades.length ? mean(trades.map((trade) => trade.holdDays)) : 0
    };
}

function drawChart(result, dayIndex) {
    const canvas = els.chart;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const pad = { top: 22, right: 52, bottom: 34, left: 52 };
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#181b20";
    ctx.fillRect(0, 0, width, height);

    const visible = result.daily.slice(0, dayIndex + 1);
    if (visible.length < 2) return;

    const zValues = visible.map((row) => row.strongest?.z ?? 0);
    const equityValues = visible.map((row) => row.equity);
    const zAbsMax = Math.max(3, ...zValues.map((value) => Math.abs(value)));
    const eqMin = Math.min(...equityValues);
    const eqMax = Math.max(...equityValues);
    const eqRange = eqMax - eqMin || 1;
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const xFor = (i) => pad.left + (i / Math.max(visible.length - 1, 1)) * plotW;
    const yZ = (value) => pad.top + ((zAbsMax - value) / (zAbsMax * 2)) * plotH;
    const yEq = (value) => pad.top + ((eqMax - value) / eqRange) * plotH;

    ctx.strokeStyle = "#383f4b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -2; i <= 2; i += 1) {
        const y = yZ(i);
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
    }
    ctx.stroke();

    ctx.fillStyle = "#9aa3b2";
    ctx.font = "12px Segoe UI";
    ctx.fillText("+2z", 10, yZ(2) + 4);
    ctx.fillText("0z", 18, yZ(0) + 4);
    ctx.fillText("-2z", 10, yZ(-2) + 4);
    ctx.fillText(money(eqMax), width - pad.right + 8, pad.top + 5);
    ctx.fillText(money(eqMin), width - pad.right + 8, height - pad.bottom);

    ctx.strokeStyle = "#86b7ff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    visible.forEach((row, index) => {
        const x = xFor(index);
        const y = yEq(row.equity);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.strokeStyle = "#71c7a1";
    ctx.lineWidth = 2;
    ctx.beginPath();
    visible.forEach((row, index) => {
        const x = xFor(index);
        const y = yZ(row.strongest?.z ?? 0);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    result.trades.forEach((trade) => {
        const closeIndex = result.daily.findIndex((row) => row.date === trade.closeDate);
        if (closeIndex >= 0 && closeIndex <= dayIndex) {
            ctx.fillStyle = trade.pnl >= 0 ? "#a4f0c8" : "#ffb4b1";
            ctx.beginPath();
            ctx.arc(xFor(closeIndex), yZ(trade.exitZ), 4, 0, Math.PI * 2);
            ctx.fill();
        }
    });

    const markerX = xFor(visible.length - 1);
    ctx.strokeStyle = "#f2c56b";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(markerX, pad.top);
    ctx.lineTo(markerX, height - pad.bottom);
    ctx.stroke();

    ctx.fillStyle = "#e7e9ee";
    ctx.fillText("strongest split z-score", pad.left, height - 12);
    ctx.fillStyle = "#86b7ff";
    ctx.fillText("equity", pad.left + 142, height - 12);
}

function riskClass(label) {
    const key = String(label).toLowerCase().replace(/\s+/g, "-");
    return `risk-${key}`;
}

function renderStrategyTable() {
    els.strategyBody.innerHTML = STRATEGIES.map((strategy) => {
        const result = appState.results.get(strategy.id);
        const active = strategy.id === appState.selectedId ? " class=\"active\"" : "";
        return `
            <tr data-strategy="${strategy.id}"${active}>
                <td>${strategy.name}</td>
                <td><span class="risk-badge ${riskClass(strategy.riskLabel)}">${strategy.riskLabel}</span></td>
                <td>${strategy.entryZ.toFixed(2)}z</td>
                <td>${strategy.exitZ.toFixed(2)}z</td>
                <td>${strategy.stopZ.toFixed(2)}z</td>
                <td class="num ${result.totalReturn >= 0 ? "positive" : "negative"}">${pct(result.totalReturn)}</td>
                <td class="num">${num(result.sharpe, 2)}</td>
                <td class="num negative">${pct(result.maxDrawdown)}</td>
                <td class="num">${result.trades.length}</td>
                <td class="num">${pct(result.winRate)}</td>
            </tr>
        `;
    }).join("");
}

function renderTradeTable(result) {
    const rows = result.trades.slice().reverse().map((trade) => `
        <tr>
            <td>${trade.openDate}</td>
            <td>${trade.closeDate}</td>
            <td>${trade.pairLabel}</td>
            <td>${trade.label}</td>
            <td class="num">${num(trade.entryZ, 2)}</td>
            <td class="num">${num(trade.exitZ, 2)}</td>
            <td class="num ${trade.pnl >= 0 ? "positive" : "negative"}">${money(trade.pnl)}</td>
            <td>${trade.reason}</td>
        </tr>
    `);
    els.tradeBody.innerHTML = rows.length ? rows.join("") : "<tr><td colspan=\"8\" class=\"muted\">No closed trades</td></tr>";
}

function render() {
    const result = appState.results.get(appState.selectedId);
    if (!result) return;
    const dayIndex = Math.min(appState.dayIndex, result.daily.length - 1);
    appState.dayIndex = dayIndex;
    const row = result.daily[dayIndex];
    const model = row.strongest;

    els.strategySelect.value = appState.selectedId;
    els.daySlider.max = String(result.daily.length - 1);
    els.daySlider.value = String(dayIndex);
    const replayReturn = row.equity / STARTING_EQUITY - 1;
    els.finalEquity.textContent = money(row.equity);
    els.totalReturn.textContent = `${pct(replayReturn)} as of selected day`;
    els.maxDrawdown.textContent = pct(result.maxDrawdown);
    els.sharpeRatio.textContent = `${num(result.sharpe, 2)} Sharpe`;
    els.tradeCount.textContent = String(result.trades.length);
    els.winRate.textContent = `${pct(result.winRate)} wins`;
    els.currentSignal.textContent = row.decision;
    els.currentDate.textContent = row.date;
    els.chartTitle.textContent = result.strategy.name;
    els.zPill.textContent = model ? `${model.pair.left}/${model.pair.right} ${num(model.z, 2)}z` : "warming";
    els.zPill.className = `pill ${model && Math.abs(model.z) >= result.strategy.entryZ ? "good" : ""}`;
    els.positionPill.textContent = `${row.openCount} open`;
    els.positionPill.className = `pill ${row.openCount ? "bad" : ""}`;
    els.pairName.textContent = model ? model.pair.label : "-";
    els.koPrice.textContent = model ? `${model.pair.left} ${money(price(appState.data[dayIndex], model.pair.left))}` : "-";
    els.pepPrice.textContent = model ? `${model.pair.right} ${money(price(appState.data[dayIndex], model.pair.right))}` : "-";
    els.hedgeBeta.textContent = model ? num(model.beta, 3) : "-";
    els.correlation.textContent = model ? num(model.corr, 3) : "-";
    els.halfLife.textContent = model && Number.isFinite(model.halfLife) ? `${num(model.halfLife, 1)} days` : "-";
    els.stationarity.textContent = model ? num(model.stationarityT, 2) : "-";
    els.exposure.textContent = money(row.exposure);
    els.unrealized.textContent = money(row.unrealized);
    els.unrealized.className = row.unrealized >= 0 ? "positive" : "negative";

    renderStrategyTable();
    renderTradeTable(result);
    drawChart(result, dayIndex);
}

function setSelectedStrategy(id) {
    appState.selectedId = id;
    els.strategySelect.value = id;
    appState.dayIndex = appState.results.get(id).daily.length - 1;
    render();
}

function togglePlay() {
    if (appState.timer) {
        clearInterval(appState.timer);
        appState.timer = null;
        els.playPause.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M8 5v14l11-7z\"></path></svg>";
        els.playPause.setAttribute("aria-label", "Play simulation");
        return;
    }

    els.playPause.innerHTML = "<svg aria-hidden=\"true\" viewBox=\"0 0 24 24\"><path d=\"M8 5h3v14H8z\"></path><path d=\"M15 5h3v14h-3z\"></path></svg>";
    els.playPause.setAttribute("aria-label", "Pause simulation");
    appState.timer = setInterval(() => {
        const result = appState.results.get(appState.selectedId);
        if (appState.dayIndex >= result.daily.length - 1) {
            appState.dayIndex = Math.max(0, result.strategy.lookback - 5);
        } else {
            appState.dayIndex += 1;
        }
        render();
    }, 120);
}

function wireEvents() {
    els.strategySelect.addEventListener("change", (event) => setSelectedStrategy(event.target.value));
    els.daySlider.addEventListener("input", (event) => {
        appState.dayIndex = Number(event.target.value);
        render();
    });
    els.stepBack.addEventListener("click", () => {
        appState.dayIndex = Math.max(0, appState.dayIndex - 1);
        render();
    });
    els.stepForward.addEventListener("click", () => {
        const result = appState.results.get(appState.selectedId);
        appState.dayIndex = Math.min(result.daily.length - 1, appState.dayIndex + 1);
        render();
    });
    els.playPause.addEventListener("click", togglePlay);
    els.strategyBody.addEventListener("click", (event) => {
        const row = event.target.closest("tr[data-strategy]");
        if (row) setSelectedStrategy(row.dataset.strategy);
    });
    window.addEventListener("resize", () => render());
}

async function boot() {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`Unable to load ${DATA_URL}`);
    const payload = await response.json();
    appState.pairs = payload.metadata.pairs;
    appState.data = payload.prices.map((row) => ({
        date: row.date,
        symbols: Object.fromEntries(
            Object.entries(row.symbols).map(([symbol, values]) => [symbol, { adjClose: values.adjClose, close: values.close }])
        )
    }));

    STRATEGIES.forEach((strategy) => {
        appState.results.set(strategy.id, simulateStrategy(appState.data, appState.pairs, strategy));
        const option = document.createElement("option");
        option.value = strategy.id;
        option.textContent = strategy.name;
        els.strategySelect.appendChild(option);
    });

    appState.dayIndex = appState.data.length - 1;
    wireEvents();
    render();
}

boot().catch((error) => {
    console.error(error);
    document.body.insertAdjacentHTML("afterbegin", `<div class="load-error">Simulator failed to load: ${error.message}</div>`);
});
