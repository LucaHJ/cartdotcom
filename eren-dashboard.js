const GOAL = 1000000;
const STORAGE_KEY = "eren-profit-ledger-v1";

const monthlyPlan = [
    {
        month: 1,
        target: 0,
        title: "Foundation and public proof",
        steps: [
            "Lock dashboard, metrics, privacy rules, and claim review.",
            "Ship first landing page template and email capture.",
            "Publish daily content experiments with human review.",
            "Choose first product from evidence, not excitement."
        ]
    },
    {
        month: 2,
        target: 1000,
        title: "First paid users",
        steps: [
            "Launch first paid tool or preorder.",
            "Track every claim, signup, conversion, and support issue.",
            "Build reusable checkout, onboarding, and product registry.",
            "Kill weak angles quickly."
        ]
    },
    {
        month: 3,
        target: 6000,
        title: "Reach 5k monthly profit",
        steps: [
            "Have at least one repeatable acquisition channel.",
            "Launch or deepen 2-3 product experiments.",
            "Add basic automation only where manual output has worked.",
            "Create bundle or higher tier if one audience is responding."
        ]
    },
    {
        month: 4,
        target: 16000,
        title: "Standardize the factory",
        steps: [
            "Turn repeated workflows into templates, scripts, or Codex skills.",
            "Add security, privacy, and reliability checklists to every product.",
            "Build daily reporting for revenue, conversion, and churn.",
            "Scale the strongest product instead of maintaining weak ones."
        ]
    },
    {
        month: 5,
        target: 31000,
        title: "Distribution pressure",
        steps: [
            "Increase content output only where conversion data supports it.",
            "Test paid ads with small capped budgets after organic proof.",
            "Publish evidence-backed demos and case studies.",
            "Add referral or affiliate loops if retention is acceptable."
        ]
    },
    {
        month: 6,
        target: 51000,
        title: "Reach 20k monthly profit",
        steps: [
            "Identify the top 1-3 products by profit, retention, and support load.",
            "Reduce operational drag through onboarding and support automation.",
            "Start market-intelligence product only behind compliance gates.",
            "Decide whether quantity or quality is producing better returns."
        ]
    },
    {
        month: 7,
        target: 101000,
        title: "Compound the winners",
        steps: [
            "Create adjacent tools for the same paying audience.",
            "Bundle related products to lift average revenue per user.",
            "Add annual plans where retention justifies it.",
            "Harden infrastructure before traffic scales further."
        ]
    },
    {
        month: 8,
        target: 176000,
        title: "Systemize acquisition",
        steps: [
            "Convert best-performing content into repeatable campaigns.",
            "Use measured proof, not hype, in public claims.",
            "Build product comparison pages and problem-specific landing pages.",
            "Expand only into channels with trackable conversion."
        ]
    },
    {
        month: 9,
        target: 276000,
        title: "Breakout search",
        steps: [
            "Pursue breakout upside through higher tiers, partnerships, or ads.",
            "Remove or sell off distractions.",
            "Audit privacy, security, and payment flows.",
            "Prepare for support, refunds, and customer trust at larger scale."
        ]
    },
    {
        month: 10,
        target: 456000,
        title: "Aggressive scale",
        steps: [
            "Push the strongest funnel hard with budget caps and daily review.",
            "Ship a major product upgrade or premium tier.",
            "Automate reporting, onboarding, and content QA.",
            "Keep claim evidence and financial records audit-ready."
        ]
    },
    {
        month: 11,
        target: 696000,
        title: "Maximize revenue per user",
        steps: [
            "Raise ARPU through bundles, pro tiers, and annual plans.",
            "Improve retention before adding more low-value traffic.",
            "Cut support-heavy or risky offers.",
            "Publish trustworthy performance history where applicable."
        ]
    },
    {
        month: 12,
        target: 1000000,
        title: "Hit the cumulative target",
        steps: [
            "Focus only on actions that move profit materially.",
            "Close the cumulative gap with proven channels and offers.",
            "Document what becomes the next-year operating system.",
            "Preserve security, privacy, and product trust under pressure."
        ]
    }
];

const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
});

const exactFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
});

function getEntries() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function sanitize(value) {
    return String(value || "").replace(/[<>&"']/g, (char) => ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "\"": "&quot;",
        "'": "&#039;"
    }[char]));
}

function renderMetrics(entries) {
    const total = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const remaining = Math.max(GOAL - total, 0);
    const percent = Math.min((total / GOAL) * 100, 100);
    const nextMilestone = monthlyPlan.find((item) => total < item.target);

    document.getElementById("totalProfit").textContent = exactFormatter.format(total);
    document.getElementById("remainingProfit").textContent = formatter.format(remaining);
    document.getElementById("requiredPace").textContent = `${formatter.format(GOAL / 12)}/mo`;
    document.getElementById("entryCount").textContent = String(entries.length);
    document.getElementById("goalPercent").textContent = `${percent.toFixed(2)}% of goal`;
    document.getElementById("progressFill").style.width = `${percent}%`;
    document.getElementById("paceSummary").textContent = nextMilestone
        ? `${formatter.format(nextMilestone.target - total)} until Month ${nextMilestone.month} target: ${nextMilestone.title}.`
        : "Goal reached or exceeded. Shift attention to preservation, quality, and repeatability.";
}

function renderLedger(entries) {
    const ledger = document.getElementById("ledgerList");

    if (!entries.length) {
        ledger.innerHTML = `<p class="empty-state">No profit entries yet. Add real net profit when it is received or confidently attributable.</p>`;
        return;
    }

    const sorted = [...entries].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    ledger.innerHTML = sorted.map((entry) => `
        <article class="ledger-item">
            <div class="ledger-main">
                <strong>${exactFormatter.format(Number(entry.amount || 0))}</strong>
                <span>${sanitize(entry.date)}${entry.source ? ` - ${sanitize(entry.source)}` : ""}</span>
                ${entry.notes ? `<p>${sanitize(entry.notes)}</p>` : ""}
            </div>
            <button class="delete-entry" type="button" data-id="${sanitize(entry.id)}">Delete</button>
        </article>
    `).join("");
}

function renderPlan(entries) {
    const total = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const plan = document.getElementById("monthPlan");
    const nextTarget = monthlyPlan.find((item) => total < item.target);

    plan.innerHTML = monthlyPlan.map((item) => {
        const isCurrent = nextTarget && item.month === nextTarget.month;
        const status = total >= item.target ? "Cleared" : `${formatter.format(Math.max(item.target - total, 0))} gap`;
        return `
            <article class="month-item ${isCurrent && total < item.target ? "current" : ""}">
                <div class="month-top">
                    <span class="month-number">Month ${item.month}</span>
                    <span class="month-target">${status}</span>
                </div>
                <h3>${sanitize(item.title)}</h3>
                <p class="month-target">Cumulative target: ${formatter.format(item.target)}</p>
                <ul>
                    ${item.steps.map((step) => `<li>${sanitize(step)}</li>`).join("")}
                </ul>
            </article>
        `;
    }).join("");
}

function render() {
    const entries = getEntries();
    renderMetrics(entries);
    renderLedger(entries);
    renderPlan(entries);
}

function addEntry(event) {
    event.preventDefault();

    const amount = Number(document.getElementById("profitAmount").value);
    if (!Number.isFinite(amount) || amount <= 0) {
        return;
    }

    const entry = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        date: document.getElementById("profitDate").value,
        amount,
        source: document.getElementById("profitSource").value.trim(),
        notes: document.getElementById("profitNotes").value.trim()
    };

    const entries = getEntries();
    entries.push(entry);
    saveEntries(entries);
    event.target.reset();
    document.getElementById("profitDate").valueAsDate = new Date();
    render();
}

function deleteEntry(id) {
    const entries = getEntries().filter((entry) => entry.id !== id);
    saveEntries(entries);
    render();
}

function exportData() {
    const payload = {
        exportedAt: new Date().toISOString(),
        goal: GOAL,
        entries: getEntries()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "eren-profit-ledger.json";
    link.click();
    URL.revokeObjectURL(url);
}

function clearData() {
    if (!confirm("Clear all locally stored profit entries for this browser?")) {
        return;
    }
    localStorage.removeItem(STORAGE_KEY);
    render();
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("profitDate").valueAsDate = new Date();
    document.getElementById("profitForm").addEventListener("submit", addEntry);
    document.getElementById("exportData").addEventListener("click", exportData);
    document.getElementById("clearData").addEventListener("click", clearData);
    document.getElementById("ledgerList").addEventListener("click", (event) => {
        const button = event.target.closest(".delete-entry");
        if (button) {
            deleteEntry(button.dataset.id);
        }
    });
    render();
});
