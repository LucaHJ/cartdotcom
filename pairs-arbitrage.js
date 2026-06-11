const DATA_URL = "data/pairs-ko-pep.json?v=20260611";
const STARTING_EQUITY = 100000;
const TRADING_DAYS = 252;

const STRATEGIES = [
    {
        id: "beta_conservative",
        name: "Beta spread / conservative",
        method: "beta",
        lookback: 504,
        entryZ: 2.2,
        exitZ: 0.35,
        stopZ: 3.4,
        maxHold: 35,
        riskPct: 0.005,
        grossCap: 0.55,
        profitR: 1.35,
        minCorr: 0.78,
        minHalfLife: 2,
        maxHalfLife: 24,
        minStationarityT: -2.4,
        maxBetaDrift: 0.22,
        costBps: 5
    },
    {
        id: "beta_balanced",
        name: "Beta spread / balanced",
        method: "beta",
        lookback: 378,
        entryZ: 2.0,
        exitZ: 0.5,
        stopZ: 3.8,
        maxHold: 45,
        riskPct: 0.008,
        grossCap: 0.75,
        profitR: 1.8,
        minCorr: 0.72,
        minHalfLife: 2,
        maxHalfLife: 32,
        minStationarityT: -2.0,
        maxBetaDrift: 0.3,
        costBps: 5
    },
    {
        id: "ratio_active",
        name: "Log ratio / active",
        method: "ratio",
        lookback: 252,
        entryZ: 1.55,
        exitZ: 0.65,
        stopZ: 4.2,
        maxHold: 60,
        riskPct: 0.01,
        grossCap: 0.95,
        profitR: 2.2,
        minCorr: 0.66,
        minHalfLife: 1,
        maxHalfLife: 42,
        minStationarityT: -1.8,
        maxBetaDrift: 0.45,
        costBps: 6
    },
    {
        id: "filtered_quality",
        name: "Quality gate / low turnover",
        method: "beta",
        lookback: 504,
        entryZ: 2.5,
        exitZ: 0.25,
        stopZ: 3.25,
        maxHold: 30,
        riskPct: 0.004,
        grossCap: 0.45,
        profitR: 1.2,
        minCorr: 0.82,
        minHalfLife: 2,
        maxHalfLife: 18,
        minStationarityT: -2.7,
        maxBetaDrift: 0.18,
        costBps: 5
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
    results: new Map(),
    selectedId: STRATEGIES[0].id,
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

function getWindow(data, endIndex, length) {
    return data.slice(endIndex - length, endIndex);
}

function returns(values) {
    const out = [];
    for (let i = 1; i < values.length; i += 1) {
        out.push(values[i] / values[i - 1] - 1);
    }
    return out;
}

function modelForDay(data, index, strategy) {
    if (index < strategy.lookback) return null;

    const window = getWindow(data, index, strategy.lookback);
    const koLogs = window.map((row) => Math.log(row.ko));
    const pepLogs = window.map((row) => Math.log(row.pep));
    const koReturns = returns(window.map((row) => row.ko));
    const pepReturns = returns(window.map((row) => row.pep));
    const beta = strategy.method === "ratio" ? 1 : regressionSlope(pepLogs, koLogs);
    const shortWindow = window.slice(Math.floor(window.length / 2));
    const shortBeta = strategy.method === "ratio"
        ? 1
        : regressionSlope(shortWindow.map((row) => Math.log(row.pep)), shortWindow.map((row) => Math.log(row.ko)));
    const spreads = window.map((row) => Math.log(row.ko) - beta * Math.log(row.pep));
    const spreadMean = mean(spreads);
    const spreadStd = stdDev(spreads);
    const currentSpread = Math.log(data[index].ko) - beta * Math.log(data[index].pep);
    const lagged = [];
    const deltas = [];

    for (let i = 1; i < spreads.length; i += 1) {
        lagged.push(spreads[i - 1]);
        deltas.push(spreads[i] - spreads[i - 1]);
    }

    const meanReversion = olsSlopeTStat(lagged, deltas);
    const halfLife = meanReversion.slope < 0 ? -Math.log(2) / meanReversion.slope : Infinity;
    const z = spreadStd ? (currentSpread - spreadMean) / spreadStd : 0;
    const corr = correlation(koReturns, pepReturns);
    const betaDrift = beta ? Math.abs(shortBeta / beta - 1) : 0;
    const filtersPass = corr >= strategy.minCorr
        && halfLife >= strategy.minHalfLife
        && halfLife <= strategy.maxHalfLife
        && meanReversion.tStat <= strategy.minStationarityT
        && betaDrift <= strategy.maxBetaDrift
        && spreadStd > strategy.costBps / 10000;

    return {
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

function openPosition(row, model, strategy, equity) {
    const direction = model.z > 0 ? -1 : 1;
    const riskDollars = equity * strategy.riskPct;
    const stopMove = Math.max((strategy.stopZ - Math.abs(model.z)) * model.spreadStd, 0.006);
    const rawUnit = riskDollars / stopMove;
    const grossUnitCap = (equity * strategy.grossCap) / (1 + Math.abs(model.beta));
    const unit = Math.max(0, Math.min(rawUnit, grossUnitCap));
    const koShares = direction * unit / row.ko;
    const pepShares = -direction * model.beta * unit / row.pep;
    const gross = Math.abs(koShares * row.ko) + Math.abs(pepShares * row.pep);
    const cost = gross * strategy.costBps / 10000;

    return {
        openDate: row.date,
        direction,
        label: direction > 0 ? "Long KO / Short PEP" : "Short KO / Long PEP",
        entryZ: model.z,
        entryKo: row.ko,
        entryPep: row.pep,
        koShares,
        pepShares,
        gross,
        initialRisk: riskDollars,
        entryCost: cost,
        openIndex: row.index
    };
}

function positionPnl(position, row) {
    if (!position) return 0;
    return position.koShares * (row.ko - position.entryKo)
        + position.pepShares * (row.pep - position.entryPep);
}

function shouldClose(position, row, model, strategy, unrealized) {
    const sameSideStop = Math.sign(model.z) === Math.sign(position.entryZ) && Math.abs(model.z) >= strategy.stopZ;
    if (sameSideStop) return "spread stop";
    if (unrealized <= -position.initialRisk) return "risk stop";
    if (unrealized >= position.initialRisk * strategy.profitR) return "profit target";
    if (Math.abs(model.z) <= strategy.exitZ || Math.sign(model.z) !== Math.sign(position.entryZ)) return "convergence";
    if (row.index - position.openIndex >= strategy.maxHold) return "time stop";
    return "";
}

function closePosition(position, row, model, strategy, reason, unrealized) {
    const exitGross = Math.abs(position.koShares * row.ko) + Math.abs(position.pepShares * row.pep);
    const exitCost = exitGross * strategy.costBps / 10000;
    const pnl = unrealized - position.entryCost - exitCost;

    return {
        openDate: position.openDate,
        closeDate: row.date,
        label: position.label,
        entryZ: position.entryZ,
        exitZ: model.z,
        gross: position.gross,
        pnl,
        reason,
        holdDays: row.index - position.openIndex
    };
}

function simulateStrategy(data, strategy) {
    let cash = STARTING_EQUITY;
    let position = null;
    let peak = STARTING_EQUITY;
    let maxDrawdown = 0;
    const daily = [];
    const trades = [];
    const returnsSeries = [];

    for (let index = 0; index < data.length; index += 1) {
        const row = { ...data[index], index };
        const model = modelForDay(data, index, strategy);
        let decision = "warming up";
        let unrealized = position ? positionPnl(position, row) : 0;

        if (model) {
            decision = model.filtersPass ? "wait" : "filtered";

            if (position) {
                const reason = shouldClose(position, row, model, strategy, unrealized);
                if (reason) {
                    const trade = closePosition(position, row, model, strategy, reason, unrealized);
                    trades.push(trade);
                    cash += trade.pnl;
                    position = null;
                    unrealized = 0;
                    decision = `close: ${reason}`;
                } else {
                    decision = "hold";
                }
            }

            if (!position && model.filtersPass && Math.abs(model.z) >= strategy.entryZ) {
                position = openPosition(row, model, strategy, cash);
                cash -= position.entryCost;
                unrealized = 0;
                decision = `open: ${position.label}`;
            }
        }

        const equity = cash + unrealized;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, peak ? (peak - equity) / peak : 0);
        if (daily.length) {
            returnsSeries.push(equity / daily[daily.length - 1].equity - 1);
        }

        daily.push({
            date: row.date,
            ko: row.ko,
            pep: row.pep,
            model,
            equity,
            cash,
            unrealized,
            exposure: position ? position.gross : 0,
            positionLabel: position ? position.label : "Flat",
            decision
        });
    }

    if (position) {
        const row = { ...data[data.length - 1], index: data.length - 1 };
        const model = modelForDay(data, data.length - 1, strategy);
        const unrealized = positionPnl(position, row);
        const trade = closePosition(position, row, model, strategy, "final day", unrealized);
        trades.push(trade);
        cash += trade.pnl;
        daily[daily.length - 1].equity = cash;
        daily[daily.length - 1].cash = cash;
        daily[daily.length - 1].unrealized = 0;
        daily[daily.length - 1].exposure = 0;
        daily[daily.length - 1].positionLabel = "Flat";
        daily[daily.length - 1].decision = "close: final day";
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

    const zValues = visible.map((row) => row.model?.z ?? 0);
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
        const y = yZ(row.model?.z ?? 0);
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
    ctx.fillText("z-score", pad.left, height - 12);
    ctx.fillStyle = "#86b7ff";
    ctx.fillText("equity", pad.left + 62, height - 12);
}

function renderStrategyTable() {
    els.strategyBody.innerHTML = STRATEGIES.map((strategy) => {
        const result = appState.results.get(strategy.id);
        const active = strategy.id === appState.selectedId ? " class=\"active\"" : "";
        return `
            <tr data-strategy="${strategy.id}"${active}>
                <td>${strategy.name}</td>
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
            <td>${trade.label}</td>
            <td class="num">${num(trade.entryZ, 2)}</td>
            <td class="num">${num(trade.exitZ, 2)}</td>
            <td class="num ${trade.pnl >= 0 ? "positive" : "negative"}">${money(trade.pnl)}</td>
            <td>${trade.reason}</td>
        </tr>
    `);
    els.tradeBody.innerHTML = rows.length ? rows.join("") : "<tr><td colspan=\"7\" class=\"muted\">No closed trades</td></tr>";
}

function render() {
    const result = appState.results.get(appState.selectedId);
    if (!result) return;
    const dayIndex = Math.min(appState.dayIndex, result.daily.length - 1);
    appState.dayIndex = dayIndex;
    const row = result.daily[dayIndex];
    const model = row.model;

    els.daySlider.max = String(result.daily.length - 1);
    els.daySlider.value = String(dayIndex);
    els.finalEquity.textContent = money(result.finalEquity);
    els.totalReturn.textContent = `${pct(result.totalReturn)} total return`;
    els.maxDrawdown.textContent = pct(result.maxDrawdown);
    els.sharpeRatio.textContent = `${num(result.sharpe, 2)} Sharpe`;
    els.tradeCount.textContent = String(result.trades.length);
    els.winRate.textContent = `${pct(result.winRate)} wins`;
    els.currentSignal.textContent = row.decision;
    els.currentDate.textContent = row.date;
    els.chartTitle.textContent = result.strategy.name;
    els.zPill.textContent = model ? `${num(model.z, 2)}z` : "warming";
    els.zPill.className = `pill ${model && Math.abs(model.z) >= result.strategy.entryZ ? "good" : ""}`;
    els.positionPill.textContent = row.positionLabel;
    els.positionPill.className = `pill ${row.positionLabel === "Flat" ? "" : "bad"}`;
    els.koPrice.textContent = money(row.ko);
    els.pepPrice.textContent = money(row.pep);
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
    appState.data = payload.prices.map((row) => ({
        date: row.date,
        ko: row.koAdjClose,
        pep: row.pepAdjClose
    }));

    STRATEGIES.forEach((strategy) => {
        appState.results.set(strategy.id, simulateStrategy(appState.data, strategy));
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
