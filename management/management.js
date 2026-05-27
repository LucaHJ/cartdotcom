const storageKey = "cartdotcom:management:intakes:v1";
const councilKey = "cartdotcom:management:council:v1";
const performanceKey = "cartdotcom:management:performance:v1";
const timeKey = "cartdotcom:management:time-ledger:v1";

const projects = [
    {
        id: "war-room-2",
        name: "WAR-ROOM-2",
        status: "active",
        priority: "high",
        owner: "Luca",
        summary: "Central second brain, project management center, council workflow, and agent operations hub.",
        context: [
            "AGENTS.md",
            "projects/PROJECT_REGISTRY.yml",
            "projects/war-room-2/PROJECT.md",
            "projects/war-room-2/STATUS.md",
            "docs/agent/docs-map.md",
            "docs/QUALITY_GATES.md"
        ]
    },
    {
        id: "cartdotcom-management",
        name: "cartdotcom management layer",
        status: "implementation",
        priority: "high",
        owner: "Luca",
        summary: "Isolated management page flow published under /management without linking into legacy operational pages.",
        context: [
            "management/index.html",
            "management/intake.html",
            "management/projects.html",
            "management/council.html",
            "management/agents.html",
            "management/quality.html"
        ]
    }
];

const workSignals = [
    ["council", "Council", "Question scope, risks, assumptions, and success criteria."],
    ["architecture", "Architecture", "Define system boundaries, data flow, and dependencies."],
    ["security", "Security", "Review auth, secrets, permissions, and abuse cases."],
    ["code", "Code", "Create implementation tasks and verification checks."],
    ["documentation", "Docs", "Update human and agent-readable project knowledge."],
    ["automation", "Automation", "Plan cloud jobs, schedules, retries, and audit records."],
    ["assets", "Assets", "Route image, video, audio, and design generation tasks."],
    ["review", "Review", "Create quality, security, and code review checkpoints."]
];

const defaultSignals = ["council", "architecture", "security", "code", "documentation", "automation", "review"];

const roleLabels = {
    chair: "Council Chair",
    product: "Product",
    architect: "Architect",
    security: "Security",
    qa: "QA",
    documentation: "Documentation",
    operator: "Operator",
    implementer: "Implementer"
};

const openDecisions = [
    "Choose production storage for project state and task records.",
    "Choose the first cloud automation runner for jobs that must run while local machines are off.",
    "Decide whether GitHub writes create direct commits or review pull requests.",
    "Set the human approval threshold for autonomous agent work.",
    "Onboard the first non-WAR-ROOM-2 project with a full council pass.",
    "Define the monetization compliance threshold before collecting customer money."
];

const defaultRequest = "Build WAR-ROOM-2 into the central brain with a website intake that can split work across council, architecture, implementation, documentation, review, and automation agents.";

const defaultPerformanceEntries = [
    {
        id: "sample-tool-codex",
        type: "tool",
        name: "Codex implementation work",
        project: "WAR-ROOM-2",
        gross: 0,
        cost: 0,
        traffic: 0,
        conversions: 0,
        status: "monitor",
        note: "Track time saved, defects caught, and deployment velocity."
    },
    {
        id: "sample-stream-affiliate",
        type: "income",
        name: "Affiliate content test",
        project: "cartdotcom",
        gross: 0,
        cost: 0,
        traffic: 0,
        conversions: 0,
        status: "not-started",
        note: "Requires endorsement disclosures and source tracking before publication."
    },
    {
        id: "sample-project-management",
        type: "project",
        name: "Management layer",
        project: "cartdotcom",
        gross: 0,
        cost: 0,
        traffic: 0,
        conversions: 0,
        status: "build",
        note: "Measures whether management pages reduce coordination overhead."
    }
];

const complianceControls = [
    ["Privacy and data map", "Identify personal information collected, purpose, storage location, retention, access, deletion, and cross-border processors.", "Before public user accounts"],
    ["Privacy policy", "Publish a clear policy covering collection, use, disclosure, access/correction rights, complaints, and overseas disclosures.", "Before collecting personal data"],
    ["Marketing consent", "Commercial messages need consent, sender identification, and a working unsubscribe path.", "Before email, SMS, or DM campaigns"],
    ["Consumer law claims", "Revenue pages must avoid misleading claims, hidden limitations, fake scarcity, and unsupported performance promises.", "Before monetized landing pages"],
    ["Refunds and terms", "Terms must state offer scope, refund handling, subscriptions, cancellation, support, and consumer guarantee limits.", "Before paid offers"],
    ["Endorsements and affiliates", "Material connections, paid placements, affiliate links, gifted products, and reviews need clear disclosure.", "Before affiliate or sponsor content"],
    ["Payment card scope", "Use hosted checkout where possible, document PCI scope, avoid storing card data, and track third-party payment scripts.", "Before card payments"],
    ["Tax and accounting", "Track income, costs, invoice records, GST/VAT/sales-tax triggers, and accountant review requirements.", "Before meaningful revenue"],
    ["Accessibility", "Use WCAG 2.2 AA as the working target for pages, forms, navigation, contrast, keyboard use, and error messages.", "Before broad release"],
    ["Security and incident response", "Document auth, secrets, backups, abuse handling, breach response, logging, and owner escalation.", "Before scale"],
    ["IP and content rights", "Record source, license, model/provider, attribution, reuse rights, and takedown handling for generated and sourced assets.", "Before publishing assets"],
    ["AI/vendor disclosure", "Track AI providers, data sent to them, output review rules, model limitations, and high-risk human approval gates.", "Before agent automation"]
];

const deploymentControls = [
    ["Cloudflare plan capacity", "Track Pages build count, file count, asset size, Functions invocation costs, and need for Workers Standard.", "Scale gate"],
    ["Fail-closed protected routes", "Auth-protected management or customer areas should fail closed if Functions quota or auth middleware fails.", "Security gate"],
    ["Preview deployment workflow", "Use branch previews for risky changes and require human review before production promotion.", "Release gate"],
    ["Observability", "Capture uptime, deploy version, errors, latency, conversion failures, payment failures, and worker exceptions.", "Operations gate"],
    ["Rate limiting and abuse", "Protect APIs, forms, auth, and expensive agent/tool calls with rate limits and abuse logging.", "Public launch"],
    ["Data persistence", "Move durable state from localStorage into D1, KV, R2, Supabase, or another backed-up production store.", "Before team use"],
    ["Backup and restore", "Define export cadence, restore procedure, owner, and evidence that restore has been tested.", "Scale gate"],
    ["Performance budget", "Set budgets for page weight, critical requests, interaction latency, and mobile render health.", "Audience gate"],
    ["Incident runbook", "Write owner, severity levels, rollback command, customer comms, breach/legal trigger, and postmortem template.", "Before paid customers"],
    ["Cost guardrails", "Set monthly spend alerts for Cloudflare, AI providers, media generation, storage, observability, and automation.", "Before automation"]
];

function readJson(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key) || "null") || fallback;
    } catch (error) {
        return fallback;
    }
}

function writeJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        // Local drafts are optional and must not block the page.
    }
}

async function managementApi(path, options = {}) {
    const response = await fetch(path, {
        credentials: "same-origin",
        headers: {
            accept: "application/json",
            ...(options.body ? { "content-type": "application/json" } : {})
        },
        ...options
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : {};
    if (!response.ok || payload.error) {
        throw new Error(payload.error || `Request failed: ${response.status}`);
    }
    return payload;
}

async function loadQueuedDrafts() {
    try {
        const payload = await managementApi("/api/management/queue");
        if (Array.isArray(payload.records)) {
            writeJson(storageKey, payload.records);
            return { source: "queue", records: payload.records };
        }
    } catch (error) {
        // Local static previews do not run Cloudflare Functions. Fall back to browser drafts.
    }
    return { source: "browser", records: readJson(storageKey, []) };
}

async function saveQueuedDraft(draft) {
    const intakes = readJson(storageKey, []);
    writeJson(storageKey, [draft, ...intakes.filter((item) => item.id !== draft.id)].slice(0, 30));

    try {
        const payload = await managementApi("/api/management/queue", {
            method: "POST",
            body: JSON.stringify(draft)
        });
        const record = payload.record || draft;
        const latest = readJson(storageKey, []);
        writeJson(storageKey, [record, ...latest.filter((item) => item.id !== record.id)].slice(0, 30));
        return { ok: true, source: "queue", record };
    } catch (error) {
        return { ok: false, source: "browser", record: draft, error: error.message };
    }
}

function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function money(value) {
    return new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 0
    }).format(asNumber(value));
}

function percent(value) {
    return `${Math.round(asNumber(value) * 10) / 10}%`;
}

function normalizeMinutes(value) {
    return Math.max(0, Math.round(asNumber(value)));
}

function minutesLabel(minutes) {
    const total = normalizeMinutes(minutes);
    const hours = Math.floor(total / 60);
    const remainder = total % 60;
    if (!hours) return `${remainder}m`;
    if (!remainder) return `${hours}h`;
    return `${hours}h ${remainder}m`;
}

function readTimeEntries() {
    return readJson(timeKey, []).filter((entry) => normalizeMinutes(entry.minutes) > 0);
}

function writeTimeEntries(entries) {
    writeJson(timeKey, entries.slice(0, 1000));
}

function timeRollups(entries) {
    const rollups = {
        totalMinutes: 0,
        projects: {},
        segments: {},
        contributors: {}
    };
    for (const entry of entries) {
        const minutes = normalizeMinutes(entry.minutes);
        if (!minutes) continue;
        const projectId = entry.projectId || "unassigned";
        const segmentId = entry.segmentId || "unassigned";
        const contributor = entry.contributor || entry.role || "unassigned";
        const segmentKey = `${projectId}::${segmentId}`;
        rollups.totalMinutes += minutes;
        rollups.projects[projectId] = rollups.projects[projectId] || {
            projectId,
            projectName: entry.projectName || projectId,
            minutes: 0,
            contributions: 0
        };
        rollups.projects[projectId].minutes += minutes;
        rollups.projects[projectId].contributions += 1;
        rollups.segments[segmentKey] = rollups.segments[segmentKey] || {
            projectId,
            segmentId,
            segmentName: entry.segmentName || segmentId,
            minutes: 0,
            contributions: 0
        };
        rollups.segments[segmentKey].minutes += minutes;
        rollups.segments[segmentKey].contributions += 1;
        rollups.contributors[contributor] = rollups.contributors[contributor] || {
            contributor,
            minutes: 0,
            contributions: 0
        };
        rollups.contributors[contributor].minutes += minutes;
        rollups.contributors[contributor].contributions += 1;
    }
    return rollups;
}

function buildTasks(request, signals, projectId) {
    const activeSignals = new Set(signals);
    const tasks = [
        {
            id: "triage",
            role: "chair",
            title: "Classify intake and load project context",
            output: "Structured intake record with project id, intent, missing info, and risk level.",
            checks: [
                `Project id resolves to ${projectId}`,
                "Required context pack is listed",
                "Ambiguities are flagged before execution"
            ]
        }
    ];

    if (activeSignals.has("council")) {
        tasks.push({
            id: "council",
            role: "chair",
            title: "Run council review",
            output: "Council decision with assumptions, risks, non-goals, and go/no-go recommendation.",
            dependsOn: ["triage"],
            checks: [
                "Each council role contributes findings",
                "Decision is short enough to become an artifact",
                "Open questions are separated from approved scope"
            ]
        });
    }

    if (activeSignals.has("architecture")) {
        tasks.push({
            id: "architecture",
            role: "architect",
            title: "Define architecture slice",
            output: "Architecture note or ADR covering system boundary, data flow, and integration points.",
            dependsOn: activeSignals.has("council") ? ["council"] : ["triage"],
            checks: [
                "Data ownership is explicit",
                "External services and permissions are listed",
                "Future agents can find the relevant docs"
            ]
        });
    }

    if (activeSignals.has("security")) {
        tasks.push({
            id: "security",
            role: "security",
            title: "Review security and permission boundaries",
            output: "Security checklist for auth, secrets, scoped tokens, and audit logging.",
            dependsOn: ["triage"],
            checks: [
                "No secrets enter Markdown docs",
                "Cloud jobs have minimal permission scope",
                "Human approval threshold is stated"
            ]
        });
    }

    if (activeSignals.has("code")) {
        tasks.push({
            id: "implementation",
            role: "implementer",
            title: "Create implementation work package",
            output: "One reviewable code task with files, non-goals, and verification commands.",
            dependsOn: activeSignals.has("architecture") ? ["architecture"] : ["triage"],
            checks: [
                "Task can produce one reviewable diff",
                "Acceptance criteria are testable",
                "No unrelated refactors are included"
            ]
        });
    }

    if (activeSignals.has("documentation")) {
        tasks.push({
            id: "documentation",
            role: "documentation",
            title: "Update project knowledge",
            output: "Updates to PROJECT, STATUS, ADR, docs-map, or runbook files.",
            dependsOn: activeSignals.has("council") ? ["council"] : ["triage"],
            checks: [
                "Durable decisions are not left only in chat",
                "Docs map points to the new artifact",
                "Project registry remains current"
            ]
        });
    }

    if (activeSignals.has("automation")) {
        tasks.push({
            id: "automation",
            role: "operator",
            title: "Design cloud automation task",
            output: "Job spec with trigger, retry policy, permissions, audit log, and failure handling.",
            dependsOn: activeSignals.has("architecture") ? ["architecture"] : ["triage"],
            checks: [
                "Runs without depending on local machine power state",
                "Idempotency strategy is defined",
                "Failure notification is defined"
            ]
        });
    }

    if (activeSignals.has("assets")) {
        tasks.push({
            id: "assets",
            role: "product",
            title: "Route asset generation",
            output: "Asset brief with provider recommendation, prompt inputs, rights notes, and review target.",
            dependsOn: ["triage"],
            checks: [
                "Output format and usage rights are stated",
                "Prompt and tool version will be logged",
                "Human review is required before publication"
            ]
        });
    }

    if (activeSignals.has("review")) {
        tasks.push({
            id: "review",
            role: "qa",
            title: "Create review and verification plan",
            output: "Quality gate covering tests, static checks, AI review, and human approval.",
            dependsOn: tasks.some((task) => task.id === "implementation") ? ["implementation"] : ["triage"],
            checks: [
                "Verification commands are named",
                "Risky changes require approval",
                "Review output has actionable findings"
            ]
        });
    }

    if (String(request).toLowerCase().includes("mobile")) {
        tasks.push({
            id: "mobile-readiness",
            role: "architect",
            title: "Assess mobile readiness",
            output: "Mobile app boundary note covering API reuse, auth, offline needs, and iOS constraints.",
            dependsOn: activeSignals.has("architecture") ? ["architecture"] : ["triage"],
            checks: [
                "No duplicate mobile-only data model",
                "Shared API contract is identified",
                "Offline and sync requirements are captured"
            ]
        });
    }

    return tasks;
}

function setActiveNavigation() {
    const path = window.location.pathname.replace(/\/index\.html$/, "/");
    for (const link of document.querySelectorAll(".management-nav a")) {
        const href = new URL(link.href).pathname.replace(/\/index\.html$/, "/");
        const active = href === path || (href === "/management/" && path === "/management");
        if (active) link.setAttribute("aria-current", "page");
    }
}

function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(options)) {
        if (key === "className") node.className = value;
        else if (key === "text") node.textContent = value;
        else if (key === "html") node.innerHTML = value;
        else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
        else if (value !== null && value !== undefined) node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) {
        if (child === null || child === undefined) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

function renderStats(tasks, intakes, timeEntries = readTimeEntries()) {
    const rollups = timeRollups(timeEntries);
    const projectCount = new Set([
        ...projects.map((project) => project.id),
        ...Object.keys(rollups.projects)
    ]).size;
    return el("div", { className: "stat-row" }, [
        stat("Projects", String(projectCount)),
        stat("WAR-ROOM Time", minutesLabel(rollups.totalMinutes)),
        stat("Draft Tasks", String(tasks.length)),
        stat("Saved Intakes", String(intakes.length || 0))
    ]);
}

function stat(label, value) {
    return el("div", { className: "stat" }, [
        el("span", { text: label }),
        el("strong", { text: value })
    ]);
}

function taskList(tasks) {
    const list = el("ul", { className: "task-list" });
    for (const task of tasks) list.append(taskCard(task));
    return list;
}

function taskCard(task) {
    return el("li", { className: "task-card" }, [
        el("header", {}, [
            el("div", {}, [
                el("span", { className: "tag", text: roleLabels[task.role] || task.role }),
                el("h3", { text: task.title })
            ]),
            el("span", {
                className: task.dependsOn ? "dependency-pill" : "status-pill",
                text: task.dependsOn ? `After ${task.dependsOn.join(", ")}` : "Entry"
            })
        ]),
        el("p", { className: "task-output", text: task.output }),
        el("div", { className: "check-grid" }, task.checks.map((check) => el("span", { text: check })))
    ]);
}

function renderDashboard(app) {
    const intakes = readJson(storageKey, []);
    const timeEntries = readTimeEntries();
    const tasks = buildTasks(defaultRequest, defaultSignals, "war-room-2");
    const recent = intakes.slice(0, 4);

    app.append(el("section", { className: "band" }, [
        el("div", { className: "band-grid" }, [
            el("div", {}, [
                el("p", { className: "eyebrow", text: "operations" }),
                el("h2", { className: "section-title", text: "One intake, routed through project context and role gates" }),
                el("p", { className: "panel-subtitle", text: "The management area is isolated under /management and keeps its navigation separate from existing site surfaces." })
            ]),
            renderStats(tasks, intakes, timeEntries)
        ])
    ]));

    app.append(el("section", { className: "flow-strip" }, [
        flowStep("01", "Capture", "Request, project, priority, and work signals."),
        flowStep("02", "Council", "Assumptions, risks, non-goals, and approval gate."),
        flowStep("03", "Assign", "Role-specific tasks with context requirements."),
        flowStep("04", "Execute", "One reviewable artifact per task."),
        flowStep("05", "Record", "Durable decisions, status, and audit trail.")
    ]));

    app.append(el("section", { className: "dashboard-grid", style: "margin-top:16px" }, [
        panel("Current Task Graph", taskList(tasks)),
        panel("Recent Intake Drafts", recent.length ? savedIntakeList(recent) : el("div", { className: "empty-state", text: "No local intake drafts saved in this browser." }))
    ]));

    app.append(el("section", { className: "panel", style: "margin-top:16px" }, [
        el("div", { className: "panel-header" }, [
            el("h2", { text: "Time Ledger" }),
            el("span", { className: "status-pill", text: minutesLabel(timeRollups(timeEntries).totalMinutes) })
        ]),
        el("div", { style: "margin-top:14px" }, renderTimeDashboard(timeEntries))
    ]));

    app.append(el("section", { className: "two-column", style: "margin-top:16px" }, [
        panel("Open Decisions", list(openDecisions)),
        panel("Active Boundaries", list([
            "Do not modify legacy site surfaces from this management flow.",
            "Treat Markdown as canonical knowledge and HTML as presentation unless the page is interactive.",
            "Use cloud-hosted jobs for automation that must run while local machines are offline.",
            "Load project context from the registry before cross-project work."
        ]))
    ]));
}

function flowStep(number, title, detail) {
    return el("div", { className: "flow-step" }, [
        el("span", { text: number }),
        el("strong", { text: title }),
        el("p", { text: detail })
    ]);
}

function panel(title, body, subtitle = "") {
    return el("section", { className: "panel" }, [
        el("div", { className: "panel-header" }, [
            el("h2", { text: title })
        ]),
        subtitle ? el("p", { className: "panel-subtitle", text: subtitle }) : null,
        el("div", { style: "margin-top:14px" }, body)
    ]);
}

function list(items) {
    return el("ul", { className: "list-clean" }, items.map((item) => el("li", { text: item })));
}

function savedIntakeList(intakes) {
    return el("ul", { className: "list-clean" }, intakes.map((intake) => {
        const item = el("li", { className: "saved-intake" });
        item.append(
            el("strong", { text: intake.projectId || "project" }),
            el("time", { text: new Date(intake.createdAt).toLocaleString() }),
            el("p", { text: String(intake.request || "").slice(0, 180) })
        );
        return item;
    }));
}

function renderTimeDashboard(entries) {
    if (!entries.length) {
        return el("div", { className: "empty-state", text: "No contribution time has been logged yet. Worker orders created from the command console can log generation time by segment." });
    }

    const rollups = timeRollups(entries);
    const projectRows = Object.values(rollups.projects)
        .sort((a, b) => b.minutes - a.minutes)
        .map((project) => [
            project.projectName,
            project.projectId,
            minutesLabel(project.minutes),
            String(project.contributions)
        ]);
    const segmentRows = Object.values(rollups.segments)
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 12)
        .map((segment) => [
            segment.projectId,
            segment.segmentName,
            minutesLabel(segment.minutes),
            String(segment.contributions)
        ]);
    const contributorRows = Object.values(rollups.contributors)
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 8)
        .map((contributor) => [
            contributor.contributor,
            minutesLabel(contributor.minutes),
            String(contributor.contributions)
        ]);

    return el("div", { className: "time-dashboard" }, [
        el("div", { className: "score-board" }, [
            scoreItem("WAR-ROOM total", minutesLabel(rollups.totalMinutes)),
            scoreItem("Projects", String(Object.keys(rollups.projects).length)),
            scoreItem("Segments", String(Object.keys(rollups.segments).length)),
            scoreItem("Contributions", String(entries.length))
        ]),
        el("div", { className: "three-column time-rollup-grid" }, [
            timeRollupPanel("Project Totals", simpleTable(["Project", "ID", "Time", "Logs"], projectRows)),
            timeRollupPanel("Segment Totals", simpleTable(["Project", "Segment", "Time", "Logs"], segmentRows)),
            timeRollupPanel("Contributor Totals", simpleTable(["Contributor", "Time", "Logs"], contributorRows))
        ])
    ]);
}

function timeRollupPanel(title, body) {
    return el("section", { className: "time-rollup-panel" }, [
        el("h3", { text: title }),
        body
    ]);
}

function classifyCommand(request) {
    const text = String(request || "").trim();
    const lower = text.toLowerCase();
    const mentionsExisting = projects.find((project) =>
        lower.includes(project.id.toLowerCase()) || lower.includes(project.name.toLowerCase())
    );
    const newProjectPattern = /\b(new|start|create|launch|build|make|prototype|spin up)\b.{0,28}\b(project|product|app|site|website|tool|business|service|dashboard|platform)\b/i;
    const isNewProject = Boolean(newProjectPattern.test(text) && !mentionsExisting);
    const projectNameMatch = text.match(/\b(?:called|named)\s+([A-Za-z0-9][A-Za-z0-9 -]{2,48}?)(?:\s+that\b|\s+to\b|\s+for\b|[.,!?]|$)/i);
    const guessedName = projectNameMatch
        ? projectNameMatch[1].trim().replace(/[.,!?].*$/, "")
        : isNewProject
            ? "New project"
            : mentionsExisting?.name || "WAR-ROOM-2";
    const projectId = mentionsExisting?.id || (isNewProject ? slugify(guessedName) : "war-room-2");
    const hasMoney = /\b(money|revenue|income|profit|sell|sales|paid|subscription|affiliate|sponsor|customer|pricing|moneti[sz]e)\b/i.test(text);
    const hasCompliance = hasMoney || /\b(legal|privacy|terms|refund|tax|gdpr|spam|email|payment|card|cookie|accessibility|compliance)\b/i.test(text);
    const hasDeployment = /\b(deploy|scale|large[- ]scale|audience|production|cloudflare|traffic|uptime|backup|incident|latency)\b/i.test(text);
    const needsCouncil = isNewProject || /\b(idea|proposal|strategy|plan|change|pivot|feature|existing product)\b/i.test(text);
    const priority = /\b(urgent|asap|critical|broken|security|breach|outage|launch today)\b/i.test(text)
        ? "urgent"
        : hasMoney || hasCompliance || hasDeployment
            ? "high"
            : "normal";
    const signals = new Set(["review"]);

    if (needsCouncil) signals.add("council");
    if (isNewProject || /\b(architecture|database|api|cloud|system|mobile|ios|workflow|integration|platform)\b/i.test(text)) signals.add("architecture");
    if (hasCompliance || /\b(auth|login|secret|token|permission|payment|user data|credential)\b/i.test(text)) signals.add("security");
    if (/\b(build|implement|fix|add|change|create|code|page|feature|ship|prototype)\b/i.test(text)) signals.add("code");
    if (isNewProject || /\b(document|docs|future worker|future agent|readable|runbook|brief)\b/i.test(text)) signals.add("documentation");
    if (/\b(agent|worker|automate|automation|schedule|queue|cron|background|execute|task)\b/i.test(text)) signals.add("automation");
    if (/\b(image|video|tts|voice|design|asset|brand|logo|web design)\b/i.test(text)) signals.add("assets");
    if (signals.size === 1) {
        signals.add("council");
        signals.add("documentation");
    }

    return {
        text,
        projectId,
        projectName: guessedName,
        isNewProject,
        priority,
        signals: Array.from(signals),
        hasMoney,
        hasCompliance,
        hasDeployment,
        needsCouncil,
        confidence: isNewProject || mentionsExisting ? "high" : "medium"
    };
}

function extractExecutionTarget(text) {
    const patterns = [
        /\b(?:begin|start|continue|resume|execute|run)\s+(?:executing\s+|execution\s+for\s+|work(?:ing)?\s+on\s+)?(.+?)(?:[.!?]|$)/i,
        /\bbeing\s+executing\s+(.+?)(?:[.!?]|$)/i
    ];
    for (const pattern of patterns) {
        const match = String(text || "").match(pattern);
        if (!match) continue;
        return match[1]
            .replace(/^(?:the\s+)?project\s+/i, "")
            .replace(/\s+(?:project|work)$/i, "")
            .trim();
    }
    return "";
}

function searchableProjectName(record) {
    return [
        record.projectId,
        record.details?.name,
        record.analysis?.projectName
    ].filter(Boolean).join(" ").toLowerCase();
}

function findQueuedProject(records, target) {
    const normalizedTarget = slugify(target);
    const plainTarget = String(target || "").toLowerCase();
    return records.find((record) => {
        const projectId = String(record.projectId || record.analysis?.projectId || "").toLowerCase();
        const projectName = String(record.details?.name || record.analysis?.projectName || "").toLowerCase();
        const haystack = searchableProjectName(record);
        return projectId === normalizedTarget
            || slugify(projectName) === normalizedTarget
            || haystack.includes(plainTarget)
            || plainTarget.includes(projectName)
            || plainTarget.includes(projectId);
    }) || null;
}

async function executionAnalysisFor(text) {
    const target = extractExecutionTarget(text);
    if (!target) return null;

    const queue = await loadQueuedDrafts();
    const record = findQueuedProject(queue.records, target);
    if (!record) {
        return {
            notFound: true,
            target,
            source: queue.source,
            records: queue.records.length
        };
    }

    const existing = record.analysis || {};
    const signals = new Set([
        ...(Array.isArray(record.signals) ? record.signals : []),
        ...(Array.isArray(existing.signals) ? existing.signals : []),
        "code",
        "documentation",
        "review"
    ]);
    if (existing.hasCompliance) signals.add("security");
    if (existing.hasDeployment) signals.add("automation");

    return {
        text,
        projectId: record.projectId || existing.projectId || slugify(target),
        projectName: record.details?.name || existing.projectName || target,
        isNewProject: false,
        priority: record.priority || existing.priority || "high",
        signals: Array.from(signals),
        hasMoney: Boolean(existing.hasMoney),
        hasCompliance: Boolean(existing.hasCompliance),
        hasDeployment: Boolean(existing.hasDeployment),
        needsCouncil: false,
        confidence: "high",
        executionMode: true,
        queuedDraft: record,
        queueSource: queue.source
    };
}

function slugify(value) {
    return String(value || "new-project")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 42) || "new-project";
}

function workerOrdersFor(analysis, details = {}) {
    if (analysis.executionMode) {
        const originalOrders = analysis.queuedDraft?.tasks?.length || 0;
        const tasks = [
            {
                id: "load-queued-context",
                role: "chair",
                title: "Load queued project brief and context",
                output: "Active execution context from the queued project draft, council notes, constraints, and prior worker orders.",
                checks: [
                    `Project resolves to ${analysis.projectId}`,
                    `${originalOrders} queued worker order${originalOrders === 1 ? "" : "s"} considered`,
                    "No new scope is invented before checking the brief"
                ]
            },
            {
                id: "select-first-slice",
                role: "product",
                title: "Select first executable slice",
                output: "One narrow implementation target based on the project brief, first shippable slice, and current constraints.",
                dependsOn: ["load-queued-context"],
                checks: [
                    "Slice is small enough for one reviewable diff",
                    "Success metric is named",
                    "Non-goals remain out of scope"
                ]
            },
            {
                id: "execute-first-slice",
                role: "implementer",
                title: "Execute the first slice",
                output: "Implementation artifact for the selected slice with no unrelated changes.",
                dependsOn: ["select-first-slice"],
                checks: [
                    "Changes stay inside approved project boundaries",
                    "Verification command or manual check is recorded",
                    "Failures are surfaced before moving on"
                ]
            },
            {
                id: "update-project-docs",
                role: "documentation",
                title: "Update durable project documentation",
                output: "Project status, decisions, runbook notes, and any context needed by future workers.",
                dependsOn: ["execute-first-slice"],
                checks: [
                    "Future workers can understand what changed",
                    "Project status is current",
                    "Open questions are separated from completed work"
                ]
            },
            {
                id: "run-review-gates",
                role: "qa",
                title: "Run review, compliance, and deployment gates",
                output: "Verification result with defects, risks, compliance blockers, and deployment readiness.",
                dependsOn: ["execute-first-slice"],
                checks: [
                    "Tests or checks are named",
                    "Compliance/deployment blockers are not ignored",
                    "Human approval threshold is stated"
                ]
            },
            {
                id: "log-time",
                role: "operator",
                title: "Log contribution time",
                output: "Time ledger entries for each meaningful human or agent contribution.",
                dependsOn: ["update-project-docs", "run-review-gates"],
                checks: [
                    "Individual contribution minutes are recorded",
                    "Segment total updates",
                    "Project and WAR-ROOM totals update"
                ]
            }
        ];

        if (analysis.hasMoney) {
            tasks.splice(2, 0, {
                id: "confirm-money-path",
                role: "product",
                title: "Confirm monetization path before build",
                output: "Revenue hypothesis, target buyer/user, pricing assumption, and performance metric.",
                dependsOn: ["select-first-slice"],
                checks: [
                    "Money-making assumption is explicit",
                    "Metric can be tracked",
                    "Cost and time risk are considered"
                ]
            });
        }

        return tasks;
    }

    const tasks = buildTasks(analysis.text, analysis.signals, analysis.projectId);
    if (analysis.hasMoney) {
        tasks.push({
            id: "monetization",
            role: "product",
            title: "Define monetization hypothesis",
            output: "Offer, target customer, pricing path, conversion metric, and shutdown condition.",
            dependsOn: analysis.signals.includes("council") ? ["council"] : ["triage"],
            checks: [
                "Revenue path is measurable",
                "Cost and time risk are named",
                "Performance row can be created"
            ]
        });
    }
    if (analysis.hasCompliance) {
        tasks.push({
            id: "compliance",
            role: "security",
            title: "Run compliance gate",
            output: "Privacy, consumer claims, marketing consent, payment, tax, and disclosure checklist.",
            dependsOn: ["triage"],
            checks: [
                "No paid launch without terms/privacy review",
                "Claims have evidence",
                "Payment and marketing scope are known"
            ]
        });
    }
    if (analysis.hasDeployment) {
        tasks.push({
            id: "deployment-readiness",
            role: "operator",
            title: "Prepare deployment and scale plan",
            output: "Hosting, storage, observability, rollback, abuse limits, and cost guardrails.",
            dependsOn: analysis.signals.includes("architecture") ? ["architecture"] : ["triage"],
            checks: [
                "Production state is not local-only",
                "Rollback path is named",
                "Cost and failure alerts are defined"
            ]
        });
    }
    if (details.goal || details.customer || details.success) {
        tasks.push({
            id: "project-brief",
            role: "documentation",
            title: "Write project operating brief",
            output: "PROJECT, STATUS, COUNCIL, risks, and first runbook entries for future workers.",
            dependsOn: ["council"],
            checks: [
                "Goal and user are explicit",
                "First implementation slice is named",
                "Future workers can load context without chat history"
            ]
        });
    }
    return tasks;
}

function councilQuestions(analysis) {
    return [
        ["Project name", analysis.projectName],
        ["Primary customer or user", analysis.hasMoney ? "Who will pay, approve, or use this?" : "Who is this for?"],
        ["Outcome", "What should be true when this succeeds?"],
        ["First shippable slice", "What is the smallest version worth building first?"],
        ["Constraints", "Budget, deadline, legal risk, tools, dependencies, or non-goals."],
        ["Success metric", analysis.hasMoney ? "Revenue, conversion, retention, cost saved, or time saved." : "How will progress be measured?"]
    ];
}

function renderTimeLedger(draft) {
    const container = el("section", { className: "time-ledger" });
    const projectName = draft.details?.name || draft.analysis?.projectName || draft.projectId;

    function render() {
        const entries = readTimeEntries();
        const projectEntries = entries.filter((entry) => entry.projectId === draft.projectId);
        const rollups = timeRollups(entries);
        const projectRollup = rollups.projects[draft.projectId] || { minutes: 0, contributions: 0 };
        const segmentRows = draft.tasks.map((task) => {
            const key = `${draft.projectId}::${task.id}`;
            const segment = rollups.segments[key] || { minutes: 0, contributions: 0 };
            return [
                task.title,
                roleLabels[task.role] || task.role,
                minutesLabel(segment.minutes),
                String(segment.contributions)
            ];
        });
        const recentRows = projectEntries.slice(0, 8).map((entry) => [
            entry.contributionTitle || entry.segmentName,
            entry.contributor || entry.role || "unassigned",
            entry.segmentName || entry.segmentId,
            minutesLabel(entry.minutes),
            new Date(entry.createdAt).toLocaleString()
        ]);
        const segmentOptions = draft.tasks.map((task) => [task.id, `${roleLabels[task.role] || task.role}: ${task.title}`]);
        const segmentSelect = basicSelect(`timeSegment-${draft.id}`, segmentOptions, draft.tasks[0]?.id || "");
        const contributor = textInput(`timeContributor-${draft.id}`, "Person, agent, or worker name");
        const contribution = textInput(`timeContribution-${draft.id}`, "Contribution generated");
        const minutes = numberInput(`timeMinutes-${draft.id}`, "Minutes");
        const notes = el("textarea", { id: `timeNotes-${draft.id}`, className: "textarea", placeholder: "Optional note about the generation, decision, or output." });
        const status = el("p", { className: "notice", text: "Log actual generation time when a worker or human completes a contribution." });

        notes.style.minHeight = "86px";

        function syncDefaults() {
            const task = draft.tasks.find((item) => item.id === segmentSelect.value) || draft.tasks[0];
            if (!task) return;
            if (!contributor.value) contributor.value = roleLabels[task.role] || task.role;
            if (!contribution.value) contribution.value = task.title;
        }

        segmentSelect.addEventListener("change", () => {
            contributor.value = "";
            contribution.value = "";
            syncDefaults();
        });
        syncDefaults();

        container.replaceChildren(
            el("div", { className: "time-ledger-header" }, [
                el("div", {}, [
                    el("span", { className: "tag", text: "time ledger" }),
                    el("h2", { text: "Contribution time tracking" }),
                    el("p", { text: "Log each worker or human contribution. Segment totals roll into the project total, and project totals roll into the WAR-ROOM total." })
                ]),
                el("div", { className: "time-ledger-totals" }, [
                    scoreItem("This project", minutesLabel(projectRollup.minutes)),
                    scoreItem("WAR-ROOM", minutesLabel(rollups.totalMinutes))
                ])
            ]),
            el("div", { className: "time-form-grid" }, [
                fieldWrap("Project segment", segmentSelect.id, segmentSelect),
                fieldWrap("Contributor", contributor.id, contributor),
                fieldWrap("Contribution", contribution.id, contribution),
                fieldWrap("Minutes", minutes.id, minutes)
            ]),
            fieldWrap("Notes", notes.id, notes),
            el("div", { className: "button-row" }, [
                el("button", {
                    className: "button",
                    type: "button",
                    text: "Log Contribution Time",
                    onclick: () => {
                        const task = draft.tasks.find((item) => item.id === segmentSelect.value) || draft.tasks[0];
                        const loggedMinutes = normalizeMinutes(minutes.value);
                        if (!task || !loggedMinutes) {
                            status.textContent = "Choose a segment and enter minutes greater than 0.";
                            return;
                        }
                        const entry = {
                            id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
                            createdAt: new Date().toISOString(),
                            projectId: draft.projectId,
                            projectName,
                            segmentId: task.id,
                            segmentName: task.title,
                            contributionTitle: contribution.value.trim() || task.title,
                            contributor: contributor.value.trim() || roleLabels[task.role] || task.role,
                            role: roleLabels[task.role] || task.role,
                            minutes: loggedMinutes,
                            notes: notes.value.trim(),
                            sourceDraftId: draft.id
                        };
                        writeTimeEntries([entry, ...readTimeEntries()]);
                        render();
                    }
                })
            ]),
            status,
            el("div", { className: "time-ledger-grid" }, [
                timeRollupPanel("Project Segment Totals", wrapTable(simpleTable(["Segment", "Role", "Time", "Logs"], segmentRows))),
                timeRollupPanel("Recent Contributions", recentRows.length ? wrapTable(simpleTable(["Contribution", "Contributor", "Segment", "Time", "Logged"], recentRows)) : el("div", { className: "empty-state", text: "No contributions logged for this project yet." }))
            ])
        );
    }

    render();
    return container;
}

function wrapTable(table) {
    return el("div", { className: "table-wrap" }, [table]);
}

function renderIntake(app) {
    const history = el("section", { className: "console-history", "aria-live": "polite" });
    const commandInput = el("textarea", {
        id: "commandInput",
        className: "console-input",
        placeholder: "Describe a project, idea, change, product, monetization test, or deployment concern..."
    });
    const status = el("p", { className: "console-status", text: "Auto-triage will infer project, priority, council need, workers, compliance, and deployability." });
    const submit = el("button", { className: "button console-submit", type: "button", text: "Process" });

    function addMessage(kind, children) {
        const message = el("article", { className: `console-message ${kind}` }, children);
        history.append(message);
        message.scrollIntoView({ block: "nearest" });
        return message;
    }

    async function dispatchOrders(analysis, details = {}) {
        const tasks = workerOrdersFor(analysis, details);
        const draft = {
            id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
            createdAt: new Date().toISOString(),
            projectId: analysis.projectId,
            priority: analysis.priority,
            request: analysis.text,
            signals: analysis.signals,
            analysis,
            details,
            tasks
        };
        const saveResult = await saveQueuedDraft(draft);
        const statusText = saveResult.ok
            ? "This project was written to the management queue and will survive reloads."
            : `Queue write failed, so this is only stored in this browser for now. ${saveResult.error || ""}`.trim();

        addMessage("assistant", [
            el("span", { className: "tag", text: "worker orders" }),
            el("h2", { text: "Orders prepared for execution" }),
            el("p", { text: statusText }),
            taskList(tasks),
            renderTimeLedger(saveResult.record || draft)
        ]);
    }

    function renderCouncilPrompt(analysis) {
        const card = el("div", { className: "console-card" }, [
            el("h2", { text: "Establish a council meeting?" }),
            el("p", { text: "This looks like a new or broad project. A council meeting will capture the project brief so future workers do not depend on this chat history." }),
            el("div", { className: "button-row" }, [
                el("button", {
                    className: "button",
                    type: "button",
                    text: "Establish Meeting",
                    onclick: () => renderCouncilMeeting(analysis, card)
                }),
                el("button", {
                    className: "ghost-button",
                    type: "button",
                    text: "Dispatch Without Meeting",
                    onclick: async () => dispatchOrders(analysis)
                })
            ])
        ]);
        addMessage("assistant", [card]);
    }

    function renderCouncilMeeting(analysis, target) {
        const fields = {};
        const questionNodes = councilQuestions(analysis).map(([label, placeholder]) => {
            const id = `council-${slugify(label)}`;
            const control = label === "Project name"
                ? el("input", { id, className: "input", type: "text" })
                : el("textarea", { id, className: "textarea", placeholder });
            if (label === "Project name") control.value = analysis.projectName;
            else control.style.minHeight = "82px";
            fields[label] = control;
            return fieldWrap(label, id, control);
        });
        target.replaceChildren(
            el("h2", { text: "Council meeting" }),
            el("p", { text: "Outline the durable project facts. When approved, worker orders will be generated from this brief." }),
            el("div", { className: "console-brief-grid" }, questionNodes),
            el("div", { className: "button-row" }, [
                el("button", {
                    className: "button",
                    type: "button",
                    text: "Approve Brief and Dispatch Workers",
                    onclick: () => {
                        const details = {
                            name: fields["Project name"].value.trim(),
                            customer: fields["Primary customer or user"].value.trim(),
                            goal: fields["Outcome"].value.trim(),
                            slice: fields["First shippable slice"].value.trim(),
                            constraints: fields["Constraints"].value.trim(),
                            success: fields["Success metric"].value.trim()
                        };
                        dispatchOrders({ ...analysis, projectName: details.name || analysis.projectName, projectId: slugify(details.name || analysis.projectName) }, details);
                    }
                })
            ])
        );
    }

    async function processCommand() {
        const text = commandInput.value.trim();
        if (!text) {
            status.textContent = "Enter a project, idea, change, or operating request first.";
            return;
        }
        addMessage("user", [el("p", { text })]);
        const executionAnalysis = await executionAnalysisFor(text);
        if (executionAnalysis?.notFound) {
            addMessage("assistant", [
                el("span", { className: "tag", text: "project lookup" }),
                el("h2", { text: "Queued project not found" }),
                el("p", { text: `I could not find "${executionAnalysis.target}" in the management queue or local fallback drafts. Establish the project first, or check the Projects tab for the exact name.` }),
                el("div", { className: "console-triage-grid" }, [
                    scoreItem("Queue source", executionAnalysis.source),
                    scoreItem("Drafts checked", String(executionAnalysis.records)),
                    scoreItem("Action", "establish project"),
                    scoreItem("Status", "blocked")
                ])
            ]);
            commandInput.value = "";
            status.textContent = "Project was not found in queued drafts.";
            return;
        }

        const analysis = executionAnalysis || classifyCommand(text);
        addMessage("assistant", [
            el("span", { className: "tag", text: analysis.executionMode ? "execution command" : "auto triage" }),
            el("h2", { text: analysis.executionMode ? "Execution project resolved" : analysis.isNewProject ? "New project detected" : "Request classified" }),
            el("div", { className: "console-triage-grid" }, [
                scoreItem("Project", analysis.projectName),
                scoreItem("Priority", analysis.priority),
                scoreItem("Council", analysis.executionMode ? "already queued" : analysis.needsCouncil ? "recommended" : "optional"),
                scoreItem("Confidence", analysis.confidence)
            ]),
            el("p", { text: analysis.executionMode ? "Assumptions applied: load the queued project brief, preserve council constraints, select the first shippable slice, execute narrowly, update docs, run gates, and log contribution time." : `Inferred workers: ${analysis.signals.map((signal) => workSignals.find((item) => item[0] === signal)?.[1] || signal).join(", ")}.` })
        ]);
        commandInput.value = "";
        status.textContent = "Request processed.";
        if (analysis.executionMode) dispatchOrders(analysis, analysis.queuedDraft?.details || {});
        else if (analysis.needsCouncil) renderCouncilPrompt(analysis);
        else dispatchOrders(analysis);
    }

    submit.addEventListener("click", processCommand);
    commandInput.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") processCommand();
    });

    app.replaceChildren(
        el("section", { className: "console-shell" }, [
            el("div", { className: "console-hero" }, [
                el("p", { className: "eyebrow", text: "single command surface" }),
                el("h2", { text: "What should WAR-ROOM-2 work on?" }),
                el("p", { text: "Describe the outcome. The system will infer context, council need, worker roles, compliance, deployment, and measurement." })
            ]),
            history,
            el("section", { className: "console-composer", "aria-label": "Project command" }, [
                commandInput,
                el("div", { className: "console-composer-footer" }, [
                    status,
                    submit
                ])
            ])
        ])
    );

    addMessage("assistant", [
        el("span", { className: "tag", text: "ready" }),
        el("p", { text: "Give me a project, idea, change, monetization experiment, or deployment concern. I will turn it into council and worker orders without manual tagging." })
    ]);
    commandInput.focus();
}

function fieldSelect(label, id, options, value, onChange) {
    const select = el("select", { id, className: "select" });
    for (const [optionValue, optionLabel] of options) {
        select.append(el("option", { value: optionValue, text: optionLabel }));
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return el("div", { className: "field-group" }, [
        el("label", { for: id, text: label }),
        select
    ]);
}

function fieldTextarea(label, id, value, onInput) {
    const textarea = el("textarea", { id, className: "textarea" });
    textarea.value = value;
    textarea.addEventListener("input", () => onInput(textarea.value));
    return el("div", { className: "field-group" }, [
        el("label", { for: id, text: label }),
        textarea
    ]);
}

function priorityButtons(value, onChange) {
    const group = el("div", { className: "field-group" }, [el("span", { className: "field-label", text: "Priority" })]);
    const buttons = el("div", { className: "segmented" });
    for (const option of ["normal", "high", "urgent"]) {
        buttons.append(el("button", {
            type: "button",
            className: option === value ? "active" : "",
            text: option,
            onclick: () => onChange(option)
        }));
    }
    group.append(buttons);
    return group;
}

function signalChooser(state, onChange) {
    const wrapper = el("fieldset", { className: "field-group" }, [
        el("legend", { className: "field-label", text: "Work signals" })
    ]);
    const grid = el("div", { className: "signals-grid" });
    for (const [id, label, description] of workSignals) {
        const checkbox = el("input", { type: "checkbox" });
        checkbox.checked = state.signals.includes(id);
        checkbox.addEventListener("change", () => {
            state.signals = checkbox.checked
                ? Array.from(new Set([...state.signals, id]))
                : state.signals.filter((item) => item !== id);
            onChange();
        });
        grid.append(el("label", { className: "signal-option" }, [
            checkbox,
            el("span", {}, [el("strong", { text: label }), el("span", { text: description })])
        ]));
    }
    wrapper.append(grid);
    return wrapper;
}

function currentDraft(state) {
    return {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        createdAt: new Date().toISOString(),
        projectId: state.projectId,
        priority: state.priority,
        request: state.request,
        signals: state.signals,
        tasks: buildTasks(state.request, state.signals, state.projectId)
    };
}

function saveCurrentDraft(state, status) {
    const draft = currentDraft(state);
    const intakes = readJson(storageKey, []);
    writeJson(storageKey, [draft, ...intakes].slice(0, 20));
    status.textContent = `${draft.tasks.length} tasks saved locally for ${draft.projectId}.`;
}

function exportDraft(state) {
    const draft = currentDraft(state);
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `war-room-intake-${draft.projectId}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
}

function renderProjects(app) {
    const queuePanelBody = el("div", { className: "queued-projects" }, [
        el("div", { className: "empty-state", text: "Loading queued project drafts..." })
    ]);

    app.append(el("section", { className: "three-column" }, projects.map((project) => {
        return el("article", { className: "registry-card" }, [
            el("span", { className: "tag", text: project.status }),
            el("h3", { text: project.name }),
            el("p", { className: "panel-subtitle", text: project.summary }),
            el("div", { className: "registry-meta" }, [
                el("span", { className: "dependency-pill", text: project.priority }),
                el("span", { className: "dependency-pill", text: project.owner }),
                el("span", { className: "dependency-pill", text: project.id })
            ])
        ]);
    })));

    app.append(el("section", { className: "panel", style: "margin-top:16px" }, [
        el("div", { className: "panel-header" }, [
            el("h2", { text: "Queued Project Drafts" }),
            el("span", { className: "status-pill", text: "queue" })
        ]),
        el("p", { className: "panel-subtitle", text: "Projects submitted through the command console appear here once they are written to the management queue. Local static previews use browser drafts as a fallback." }),
        el("div", { style: "margin-top:14px" }, queuePanelBody)
    ]));

    loadQueuedDrafts().then(({ source, records }) => {
        const projectDrafts = records.filter((record) => record.projectId || record.analysis?.projectId);
        queuePanelBody.replaceChildren(renderQueuedProjects(projectDrafts, source));
    });

    app.append(el("section", { className: "two-column", style: "margin-top:16px" }, [
        panel("Startup Context Pack", contextTable(projects[0])),
        panel("Unknown Project Rule", list([
            "Read the registry before editing.",
            "Resolve the target project id and context pack.",
            "Load the target project's PROJECT, STATUS, COUNCIL, and local AGENTS files.",
            "If the project is still ambiguous, stop and ask for the target."
        ]))
    ]));
}

function renderQueuedProjects(records, source) {
    if (!records.length) {
        return el("div", { className: "empty-state", text: "No queued project drafts found yet." });
    }

    const byProject = {};
    for (const record of records) {
        const projectId = record.projectId || record.analysis?.projectId || "unassigned";
        const projectName = record.details?.name || record.analysis?.projectName || projectId;
        byProject[projectId] = byProject[projectId] || {
            projectId,
            projectName,
            records: [],
            updatedAt: record.updatedAt || record.queuedAt || record.createdAt || ""
        };
        byProject[projectId].records.push(record);
        const timestamp = record.updatedAt || record.queuedAt || record.createdAt || "";
        if (timestamp > byProject[projectId].updatedAt) byProject[projectId].updatedAt = timestamp;
    }

    return el("div", { className: "three-column" }, Object.values(byProject)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map((project) => {
            const latest = project.records[0] || {};
            const taskCount = project.records.reduce((total, record) => total + (record.tasks?.length || 0), 0);
            return el("article", { className: "registry-card" }, [
                el("span", { className: "tag", text: source }),
                el("h3", { text: project.projectName }),
                el("p", { className: "panel-subtitle", text: latest.request || "Queued project draft" }),
                el("div", { className: "registry-meta" }, [
                    el("span", { className: "dependency-pill", text: project.projectId }),
                    el("span", { className: "dependency-pill", text: `${project.records.length} draft${project.records.length === 1 ? "" : "s"}` }),
                    el("span", { className: "dependency-pill", text: `${taskCount} order${taskCount === 1 ? "" : "s"}` })
                ]),
                project.updatedAt ? el("time", { className: "queued-project-time", text: new Date(project.updatedAt).toLocaleString() }) : null
            ]);
        }));
}

function contextTable(project) {
    const table = el("table", { className: "data-table" });
    table.append(el("thead", {}, [el("tr", {}, [
        el("th", { text: "Document" }),
        el("th", { text: "Purpose" })
    ])]));
    const tbody = el("tbody");
    const purposes = {
        "AGENTS.md": "Global agent startup rules",
        "projects/PROJECT_REGISTRY.yml": "Project lookup and routing",
        "projects/war-room-2/PROJECT.md": "Project scope and operating context",
        "projects/war-room-2/STATUS.md": "Current implementation state",
        "docs/agent/docs-map.md": "Deep context loading map",
        "docs/QUALITY_GATES.md": "Review and verification policy"
    };
    for (const doc of project.context) {
        tbody.append(el("tr", {}, [
            el("td", { text: doc }),
            el("td", { text: purposes[doc] || "Project context" })
        ]));
    }
    table.append(tbody);
    return table;
}

function renderCouncil(app) {
    const saved = readJson(councilKey, {
        decision: "",
        assumptions: "",
        risks: "",
        updatedAt: ""
    });
    const agenda = [
        ["Chair", "Classify request, name scope, identify missing decisions."],
        ["Product", "Confirm user value, target workflow, non-goals."],
        ["Architect", "Check system boundary, data ownership, integration cost."],
        ["Security", "Review auth, secrets, permissions, abuse paths."],
        ["Operator", "Check automation, retries, observability, rollback."],
        ["QA", "Define verification commands and failure thresholds."],
        ["Documentation", "Name durable files that must be updated."]
    ];

    const table = el("table", { className: "data-table" });
    table.append(el("thead", {}, [el("tr", {}, [el("th", { text: "Seat" }), el("th", { text: "Review focus" })])]));
    table.append(el("tbody", {}, agenda.map(([seat, focus]) => el("tr", {}, [el("td", { text: seat }), el("td", { text: focus })]))));

    const decision = el("textarea", { id: "decisionInput", className: "textarea" });
    decision.value = saved.decision;
    const assumptions = el("textarea", { id: "assumptionsInput", className: "textarea" });
    assumptions.value = saved.assumptions;
    const risks = el("textarea", { id: "risksInput", className: "textarea" });
    risks.value = saved.risks;
    const saveStatus = el("p", { className: "notice", text: saved.updatedAt ? `Last local council draft: ${new Date(saved.updatedAt).toLocaleString()}` : "No local council draft saved in this browser." });

    app.append(el("section", { className: "two-column" }, [
        panel("Council Seats", table),
        panel("Gate Conditions", list([
            "No implementation starts before scope and non-goals are named.",
            "Architecture and data ownership are explicit for shared systems.",
            "Security signs off on credentials, auth, external tools, and cloud jobs.",
            "QA names verification before implementers start work.",
            "Documentation target files are listed before the work closes."
        ]))
    ]));

    app.append(el("section", { className: "panel", style: "margin-top:16px" }, [
        el("div", { className: "panel-header" }, [el("h2", { text: "Council Draft" })]),
        el("div", { className: "three-column", style: "margin-top:14px" }, [
            el("div", { className: "field-group" }, [el("label", { for: "decisionInput", text: "Decision" }), decision]),
            el("div", { className: "field-group" }, [el("label", { for: "assumptionsInput", text: "Assumptions" }), assumptions]),
            el("div", { className: "field-group" }, [el("label", { for: "risksInput", text: "Risks" }), risks])
        ]),
        el("div", { className: "button-row", style: "margin-top:14px" }, [
            el("button", {
                className: "button",
                type: "button",
                text: "Save Council Draft",
                onclick: () => {
                    const value = {
                        decision: decision.value,
                        assumptions: assumptions.value,
                        risks: risks.value,
                        updatedAt: new Date().toISOString()
                    };
                    writeJson(councilKey, value);
                    saveStatus.textContent = `Saved council draft at ${new Date(value.updatedAt).toLocaleString()}.`;
                }
            })
        ]),
        saveStatus
    ]));
}

function renderAgents(app) {
    const startupRows = [
        ["Global instructions", "AGENTS.md", "Operating posture, project discovery, quality gate."],
        ["Project registry", "projects/PROJECT_REGISTRY.yml", "Project id, route, owner, status, context pack."],
        ["Project brief", "projects/{project}/PROJECT.md", "Scope, goals, boundaries, external systems."],
        ["Current status", "projects/{project}/STATUS.md", "Active work, recent changes, next decisions."],
        ["Council file", "projects/{project}/COUNCIL.md", "Required review seats and approval record."],
        ["Docs map", "docs/agent/docs-map.md", "On-demand context loading without clutter."],
        ["Quality gate", "docs/QUALITY_GATES.md", "Tests, build checks, review thresholds."]
    ];

    app.append(el("section", { className: "two-column" }, [
        panel("Startup Pack", simpleTable(["Artifact", "Path", "Why it is loaded"], startupRows)),
        panel("Cross-Project Handling", list([
            "When pointed at a project not already loaded, find it in the registry.",
            "Load only that project's context pack before touching files.",
            "State the active project before making cross-project edits.",
            "Keep shared architecture changes behind an ADR.",
            "Escalate when two project instructions conflict."
        ]))
    ]));

    app.append(el("section", { className: "two-column", style: "margin-top:16px" }, [
        panel("Role Agents", simpleTable(["Role", "Default output", "Stop condition"], [
            ["Council Chair", "Council decision", "Missing owner, goal, or approval threshold"],
            ["Architect", "ADR or architecture note", "Unknown data boundary"],
            ["Implementer", "Reviewable diff", "No acceptance criteria"],
            ["Documentation", "Updated durable docs", "Decision only exists in chat"],
            ["Security", "Permission checklist", "Secrets or broad tokens requested"],
            ["QA", "Verification report", "No reproducible command or manual check"],
            ["Operator", "Automation runbook", "No retry, audit, or failure path"]
        ])),
        panel("Format Policy", list([
            "Markdown remains the source format for notes, docs, and project records.",
            "HTML is presentation output unless it is an intentionally interactive surface.",
            "Large context is summarized into status docs instead of loaded into every agent.",
            "Generated artifacts should link back to canonical Markdown or registry entries."
        ]))
    ]));
}

function renderPerformance(app) {
    const entries = readJson(performanceKey, defaultPerformanceEntries);
    const totals = entries.reduce((acc, entry) => {
        acc.gross += asNumber(entry.gross);
        acc.cost += asNumber(entry.cost);
        acc.traffic += asNumber(entry.traffic);
        acc.conversions += asNumber(entry.conversions);
        return acc;
    }, { gross: 0, cost: 0, traffic: 0, conversions: 0 });
    const net = totals.gross - totals.cost;
    const conversionRate = totals.traffic ? (totals.conversions / totals.traffic) * 100 : 0;
    const byType = entries.reduce((acc, entry) => {
        const type = entry.type || "other";
        acc[type] = acc[type] || { gross: 0, cost: 0, count: 0 };
        acc[type].gross += asNumber(entry.gross);
        acc[type].cost += asNumber(entry.cost);
        acc[type].count += 1;
        return acc;
    }, {});

    app.append(el("section", { className: "band" }, [
        el("div", { className: "band-grid" }, [
            el("div", {}, [
                el("p", { className: "eyebrow", text: "money layer" }),
                el("h2", { className: "section-title", text: "Track what creates revenue, saves cost, or deserves shutdown" }),
                el("p", { className: "panel-subtitle", text: "This dashboard stores draft metrics locally for now. Production tracking should move into a database with source attribution, audit records, and access control." })
            ]),
            el("div", { className: "stat-row" }, [
                stat("Gross", money(totals.gross)),
                stat("Net", money(net)),
                stat("Cost", money(totals.cost)),
                stat("Conv.", String(totals.conversions))
            ])
        ])
    ]));

    app.append(el("section", { className: "dashboard-grid" }, [
        panel("Metric Entry", performanceForm(entries)),
        panel("Portfolio Summary", el("div", {}, [
            el("div", { className: "score-board" }, [
                scoreItem("Traffic", String(totals.traffic)),
                scoreItem("Conversion rate", percent(conversionRate)),
                scoreItem("Tracked lines", String(entries.length)),
                scoreItem("Income streams", String(entries.filter((entry) => entry.type === "income").length))
            ]),
            el("div", { className: "mini-bars" }, Object.entries(byType).map(([type, value]) => miniBar(type, value.gross - value.cost, Math.max(1, Math.abs(net), ...Object.values(byType).map((item) => Math.abs(item.gross - item.cost)))))),
            el("p", { className: "notice warning", text: "Use net revenue, marginal cost, conversion rate, and legal readiness together. A high-performing stream that fails compliance should not scale." })
        ]))
    ]));

    app.append(el("section", { className: "panel", style: "margin-top:16px" }, [
        el("div", { className: "panel-header" }, [
            el("h2", { text: "Tracked Tools, Projects, and Income Streams" }),
            el("span", { className: "status-pill", text: `${entries.length} rows` })
        ]),
        el("div", { style: "margin-top:14px" }, performanceTable(entries)),
        el("div", { className: "button-row", style: "margin-top:14px" }, [
            el("button", { className: "ghost-button", type: "button", text: "Export JSON", onclick: () => exportPerformance(entries, "json") }),
            el("button", { className: "ghost-button", type: "button", text: "Export CSV", onclick: () => exportPerformance(entries, "csv") }),
            el("button", {
                className: "ghost-button",
                type: "button",
                text: "Reset Samples",
                onclick: () => {
                    writeJson(performanceKey, defaultPerformanceEntries);
                    render();
                }
            })
        ])
    ]));
}

function performanceForm(entries) {
    const form = el("form", { className: "form-stack" });
    const type = basicSelect("metricType", [["income", "Income stream"], ["tool", "Tool"], ["project", "Project"], ["channel", "Channel"]], "income");
    const status = basicSelect("metricStatus", [["not-started", "Not started"], ["build", "Build"], ["monitor", "Monitor"], ["scale", "Scale"], ["pause", "Pause"]], "monitor");
    const name = textInput("metricName", "Affiliate content, productized service, tool, project");
    const project = textInput("metricProject", "Project or property");
    const gross = numberInput("metricGross", "0");
    const cost = numberInput("metricCost", "0");
    const traffic = numberInput("metricTraffic", "0");
    const conversions = numberInput("metricConversions", "0");
    const note = el("textarea", { id: "metricNote", className: "textarea", placeholder: "What changed, what source produced it, and what decision should follow." });
    note.style.minHeight = "100px";
    const saveStatus = el("p", { className: "notice", text: "Add rows weekly or after each campaign/tool test." });

    form.append(
        el("div", { className: "two-column" }, [
            fieldWrap("Type", "metricType", type),
            fieldWrap("Status", "metricStatus", status)
        ]),
        fieldWrap("Name", "metricName", name),
        fieldWrap("Project", "metricProject", project),
        el("div", { className: "two-column" }, [
            fieldWrap("Gross revenue / value", "metricGross", gross),
            fieldWrap("Cost", "metricCost", cost)
        ]),
        el("div", { className: "two-column" }, [
            fieldWrap("Traffic / usage", "metricTraffic", traffic),
            fieldWrap("Conversions / wins", "metricConversions", conversions)
        ]),
        fieldWrap("Decision note", "metricNote", note),
        el("div", { className: "button-row" }, [
            el("button", {
                className: "button",
                type: "submit",
                text: "Add Metric",
                onclick: (event) => {
                    event.preventDefault();
                    if (!name.value.trim()) {
                        saveStatus.textContent = "Name is required.";
                        return;
                    }
                    const next = {
                        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
                        type: type.value,
                        name: name.value.trim(),
                        project: project.value.trim() || "unassigned",
                        gross: asNumber(gross.value),
                        cost: asNumber(cost.value),
                        traffic: asNumber(traffic.value),
                        conversions: asNumber(conversions.value),
                        status: status.value,
                        note: note.value.trim(),
                        recordedAt: new Date().toISOString()
                    };
                    writeJson(performanceKey, [next, ...entries]);
                    saveStatus.textContent = `Added ${next.name}. Refreshing dashboard.`;
                    render();
                }
            })
        ]),
        saveStatus
    );

    return form;
}

function basicSelect(id, options, value) {
    const select = el("select", { id, className: "select" });
    for (const [optionValue, label] of options) select.append(el("option", { value: optionValue, text: label }));
    select.value = value;
    return select;
}

function textInput(id, placeholder) {
    return el("input", { id, className: "input", type: "text", placeholder });
}

function numberInput(id, placeholder) {
    return el("input", { id, className: "input", type: "number", inputmode: "decimal", min: "0", step: "1", placeholder });
}

function fieldWrap(label, id, control) {
    return el("div", { className: "field-group" }, [
        el("label", { for: id, text: label }),
        control
    ]);
}

function scoreItem(label, value) {
    return el("div", { className: "score-item" }, [
        el("span", { text: label }),
        el("strong", { text: value })
    ]);
}

function miniBar(label, value, max) {
    const width = Math.max(6, Math.min(100, Math.round((Math.abs(value) / max) * 100)));
    return el("div", { className: "mini-bar" }, [
        el("div", { className: "mini-bar-label" }, [
            el("span", { text: label }),
            el("strong", { text: money(value) })
        ]),
        el("div", { className: "mini-bar-track" }, [
            el("span", { className: value >= 0 ? "positive" : "negative", style: `width:${width}%` })
        ])
    ]);
}

function performanceTable(entries) {
    const rows = entries.map((entry) => [
        entry.type || "other",
        entry.name || "",
        entry.project || "",
        money(entry.gross),
        money(entry.cost),
        money(asNumber(entry.gross) - asNumber(entry.cost)),
        String(entry.traffic || 0),
        String(entry.conversions || 0),
        entry.status || "monitor"
    ]);
    return simpleTable(["Type", "Name", "Project", "Gross", "Cost", "Net", "Traffic", "Conv.", "Status"], rows);
}

function exportPerformance(entries, format) {
    let content;
    let type;
    let extension;
    if (format === "csv") {
        const headers = ["type", "name", "project", "gross", "cost", "traffic", "conversions", "status", "note", "recordedAt"];
        const rows = entries.map((entry) => headers.map((header) => `"${String(entry[header] ?? "").replace(/"/g, '""')}"`).join(","));
        content = [headers.join(","), ...rows].join("\n");
        type = "text/csv";
        extension = "csv";
    } else {
        content = JSON.stringify(entries, null, 2);
        type = "application/json";
        extension = "json";
    }
    const blob = new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `cartdotcom-performance-${Date.now()}.${extension}`;
    link.click();
    URL.revokeObjectURL(link.href);
}

function renderCompliance(app) {
    const phaseRows = [
        ["Pre-revenue", "Privacy map, asset rights, claims review, basic terms, analytics consent posture."],
        ["First sale", "Refund terms, payment scope, accounting records, support process, transaction audit trail."],
        ["Marketing scale", "Consent proof, unsubscribe handling, affiliate disclosures, review/testimonial policy."],
        ["Audience scale", "Accessibility pass, incident response, rate limits, data deletion, vendor review."],
        ["International", "GDPR/UK privacy posture, cookie consent, tax handling, localized consumer terms."]
    ];

    app.append(el("section", { className: "band" }, [
        el("div", { className: "band-grid" }, [
            el("div", {}, [
                el("p", { className: "eyebrow", text: "risk layer" }),
                el("h2", { className: "section-title", text: "Monetization should not outrun compliance" }),
                el("p", { className: "panel-subtitle", text: "This is an operational checklist, not legal advice. Get lawyer/accountant review before paid offers, public claims, or international expansion." })
            ]),
            el("div", { className: "stat-row" }, [
                stat("Controls", String(complianceControls.length)),
                stat("Blockers", "4"),
                stat("Review", "Legal"),
                stat("Target", "Scale")
            ])
        ])
    ]));

    app.append(el("section", { className: "panel" }, [
        el("div", { className: "panel-header" }, [
            el("h2", { text: "Compliance Control Register" }),
            el("span", { className: "status-pill", text: "required" })
        ]),
        el("div", { className: "matrix", style: "margin-top:14px" }, complianceControls.map((row) => matrixRow(row)))
    ]));

    app.append(el("section", { className: "two-column", style: "margin-top:16px" }, [
        panel("Revenue Phase Gates", simpleTable(["Phase", "Must be true"], phaseRows)),
        panel("Reference Basis", list([
            "Australian privacy: personal information handling, privacy policy, access/correction, data breach response.",
            "Australian marketing: consent, sender identification, and unsubscribe for commercial electronic messages.",
            "Australian consumer law: avoid misleading claims and honor consumer guarantees/refund obligations.",
            "US-facing promotion: material connections and endorsements must be clearly disclosed.",
            "EU/UK users: GDPR-style rights, lawful basis, data transfer, and cookie consent may apply.",
            "Payments: hosted checkout reduces card-data scope, but script inventory and payment-page integrity still need ownership."
        ]))
    ]));
}

function renderDeployment(app) {
    const architectureRows = [
        ["Static content", "Cloudflare Pages assets", "Marketing, docs, and management UI shell"],
        ["Protected routes", "Pages Functions middleware", "Management access and future customer account gates"],
        ["Durable data", "D1 or Supabase plus R2 for files", "Project state, performance rows, assets, audit logs"],
        ["Queue and jobs", "Workers Queues, GitHub Actions, Trigger.dev, or Inngest", "Automations that must run without a local machine"],
        ["Observability", "Cloudflare Analytics plus error logging", "Latency, errors, conversions, deploy health"],
        ["Secrets", "Cloudflare environment variables", "API keys, provider tokens, webhook secrets"]
    ];

    app.append(el("section", { className: "band" }, [
        el("div", { className: "band-grid" }, [
            el("div", {}, [
                el("p", { className: "eyebrow", text: "deployability" }),
                el("h2", { className: "section-title", text: "Prepare the site for a larger audience before the audience arrives" }),
                el("p", { className: "panel-subtitle", text: "The current static management layer is safe for preview. Production scale needs storage, observability, fail-closed auth, rollback, and cost controls." })
            ]),
            el("div", { className: "stat-row" }, [
                stat("Gates", String(deploymentControls.length)),
                stat("Runtime", "Cloudflare"),
                stat("State", "Pending"),
                stat("Risk", "Medium")
            ])
        ])
    ]));

    app.append(el("section", { className: "two-column" }, [
        panel("Scale Architecture", simpleTable(["Layer", "Candidate", "Use"], architectureRows)),
        panel("Launch Checklist", list([
            "Set Cloudflare Pages Functions fail-open/fail-closed behavior deliberately for protected routes.",
            "Move local-only dashboard state into a backed-up database before team or customer use.",
            "Add rate limits around auth, forms, write APIs, and paid AI/tool calls.",
            "Add deploy previews and rollback notes for every production change.",
            "Record cost owners and monthly spend caps before enabling automated generation."
        ]))
    ]));

    app.append(el("section", { className: "panel", style: "margin-top:16px" }, [
        el("div", { className: "panel-header" }, [
            el("h2", { text: "Deployment Control Register" }),
            el("span", { className: "status-pill", text: "scale gate" })
        ]),
        el("div", { className: "matrix", style: "margin-top:14px" }, deploymentControls.map((row) => matrixRow(row)))
    ]));
}

function renderQuality(app) {
    const qualityRows = [
        ["Docs-only", "Heading consistency, links, registry references", "Manual review or lightweight link check"],
        ["Static page", "No console errors, responsive layout, no route leakage", "Browser render and narrow viewport check"],
        ["Function/API", "Auth, input validation, error shape, cache policy", "Local Pages dev plus targeted request tests"],
        ["Agent output", "Acceptance checks, artifact path, verification commands", "Council or QA review before execution"],
        ["Automation", "Idempotency, retry, audit, alerting, least privilege", "Cloud dry run plus failure simulation"],
        ["Release", "Git status, diff review, deployment target", "Build command and Cloudflare Pages preview"]
    ];

    const automationRows = [
        ["Short jobs", "Cloudflare Workers Cron", "Small scheduled tasks close to the existing site"],
        ["Long jobs", "GitHub Actions", "Repo-aware tasks, commits, tests, and build checks"],
        ["Stateful workflows", "Trigger.dev or Inngest", "Retries, queues, human approval, longer orchestration"],
        ["Content generation", "Provider APIs behind queued jobs", "Image, video, TTS, web generation with audit records"],
        ["Human review", "Management approval queue", "High-risk writes, publishing, spending, credentials"]
    ];

    app.append(el("section", { className: "panel" }, [
        el("div", { className: "panel-header" }, [el("h2", { text: "Quality Gate Matrix" })]),
        el("div", { className: "matrix", style: "margin-top:14px" }, qualityRows.map((row) => matrixRow(row)))
    ]));

    app.append(el("section", { className: "two-column", style: "margin-top:16px" }, [
        panel("Automation Stack", simpleTable(["Workload", "Candidate", "Fit"], automationRows)),
        panel("Development Oversight", list([
            "Require a council pass before new project work starts.",
            "Keep implementation tasks small enough for one coherent review.",
            "Run automated checks before human review.",
            "Use AI review as a second pass, not as the only approval.",
            "Record architecture and operational decisions as durable docs."
        ]))
    ]));
}

function simpleTable(headers, rows) {
    const table = el("table", { className: "data-table" });
    table.append(el("thead", {}, [el("tr", {}, headers.map((header) => el("th", { text: header })))]));
    table.append(el("tbody", {}, rows.map((row) => el("tr", {}, row.map((cell) => el("td", { text: cell }))))));
    return table;
}

function matrixRow(row) {
    return el("div", { className: "matrix-row" }, [
        el("strong", { text: row[0] }),
        el("span", { text: row[1] }),
        el("span", { text: row[2] })
    ]);
}

function render() {
    setActiveNavigation();
    const app = document.getElementById("managementApp");
    if (!app) return;
    const page = document.body.dataset.page || "dashboard";
    app.replaceChildren();
    if (page === "intake") renderIntake(app);
    else if (page === "projects") renderProjects(app);
    else if (page === "performance") renderPerformance(app);
    else if (page === "compliance") renderCompliance(app);
    else if (page === "deployment") renderDeployment(app);
    else if (page === "council") renderCouncil(app);
    else if (page === "agents") renderAgents(app);
    else if (page === "quality") renderQuality(app);
    else renderDashboard(app);
}

render();
