import { json, normalizeString } from "../../_lib/backend-auth.js";

const WORKER_PREFIX = "management:worker:";
const QUEUE_PREFIX = "management:queue:";
const MAX_BODY_BYTES = 64 * 1024;
const WORKER_VERSION = "war-room-2-cloud-worker-v1";

const COUNCIL_SEATS = [
    ["Chair", "Converts loose intent into a decision path and prevents premature execution."],
    ["Skeptic", "Finds weak assumptions, missing evidence, and reasons not to build."],
    ["Growth", "Looks for revenue paths, distribution loops, and scale opportunities."],
    ["Product", "Protects the user workflow, first slice, and success criteria."],
    ["Architect", "Defines data ownership, integration boundaries, and maintainability."],
    ["Security", "Reviews auth, secrets, permissions, prompt injection, and abuse paths."],
    ["Operator", "Checks deployment, queueing, retries, observability, and cost controls."],
    ["QA", "Defines verification, review gates, and failure thresholds."],
    ["Archivist", "Turns decisions into durable docs for future humans and agents."]
];

const RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: [
        "mode",
        "title",
        "message",
        "confidence",
        "needsUserInput",
        "council",
        "project",
        "workerOrders",
        "safeguards",
        "memoryWrites",
        "nextActions",
        "telemetry"
    ],
    properties: {
        mode: { type: "string", enum: ["answer", "council", "project_setup", "execution", "blocked"] },
        title: { type: "string" },
        message: { type: "string" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        needsUserInput: { type: "boolean" },
        council: {
            type: "array",
            maxItems: 9,
            items: {
                type: "object",
                additionalProperties: false,
                required: ["seat", "stance", "contribution", "questions", "risks", "opportunities"],
                properties: {
                    seat: { type: "string" },
                    stance: { type: "string" },
                    contribution: { type: "string" },
                    questions: { type: "array", maxItems: 3, items: { type: "string" } },
                    risks: { type: "array", maxItems: 3, items: { type: "string" } },
                    opportunities: { type: "array", maxItems: 3, items: { type: "string" } }
                }
            }
        },
        project: {
            type: "object",
            additionalProperties: false,
            required: ["detected", "id", "name", "status", "priority", "objective", "firstSlice", "successMetric", "constraints", "shouldCreateDraft"],
            properties: {
                detected: { type: "boolean" },
                id: { type: "string" },
                name: { type: "string" },
                status: { type: "string", enum: ["unknown", "council-needed", "draft-ready", "execution-ready", "blocked"] },
                priority: { type: "string", enum: ["normal", "high", "urgent"] },
                objective: { type: "string" },
                firstSlice: { type: "string" },
                successMetric: { type: "string" },
                constraints: { type: "array", maxItems: 8, items: { type: "string" } },
                shouldCreateDraft: { type: "boolean" }
            }
        },
        workerOrders: {
            type: "array",
            maxItems: 10,
            items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "role", "title", "output", "dependsOn", "checks"],
                properties: {
                    id: { type: "string" },
                    role: { type: "string" },
                    title: { type: "string" },
                    output: { type: "string" },
                    dependsOn: { type: "array", maxItems: 6, items: { type: "string" } },
                    checks: { type: "array", maxItems: 5, items: { type: "string" } }
                }
            }
        },
        safeguards: { type: "array", maxItems: 8, items: { type: "string" } },
        memoryWrites: {
            type: "array",
            maxItems: 8,
            items: {
                type: "object",
                additionalProperties: false,
                required: ["type", "title", "content"],
                properties: {
                    type: { type: "string", enum: ["decision", "assumption", "risk", "task", "context", "blocker"] },
                    title: { type: "string" },
                    content: { type: "string" }
                }
            }
        },
        nextActions: {
            type: "array",
            maxItems: 6,
            items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "action", "requiresApproval"],
                properties: {
                    label: { type: "string" },
                    action: { type: "string", enum: ["reply", "open_council", "queue_project", "open_projects", "start_execution", "research", "review"] },
                    requiresApproval: { type: "boolean" }
                }
            }
        },
        telemetry: {
            type: "object",
            additionalProperties: false,
            required: ["contextUsed", "workerVersion"],
            properties: {
                contextUsed: { type: "array", maxItems: 10, items: { type: "string" } },
                workerVersion: { type: "string" }
            }
        }
    }
};

function getKV(env) {
    return env.SECOND_BRAIN_KV || null;
}

function workerKey(id) {
    return `${WORKER_PREFIX}${id}`;
}

function queueKey(id) {
    return `${QUEUE_PREFIX}${id}`;
}

function safeSlug(value, fallback = "war-room-task") {
    return String(value || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || fallback;
}

async function sha256Hex(value) {
    const data = new TextEncoder().encode(String(value || ""));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBody(request) {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
        return { error: "Worker request is too large.", status: 413 };
    }
    try {
        return { body: JSON.parse(raw || "{}") };
    } catch (error) {
        return { error: "JSON body is required.", status: 400 };
    }
}

async function listRecords(kv, prefix, limit = 12) {
    if (!kv) return [];
    const result = await kv.list({ prefix, limit });
    const records = [];
    for (const key of result.keys || []) {
        const value = await kv.get(key.name, "json");
        if (value) records.push(value);
    }
    return records
        .sort((a, b) => String(b.updatedAt || b.queuedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.queuedAt || a.createdAt || "")))
        .slice(0, limit);
}

function compactProject(record) {
    return {
        id: record.projectId || record.analysis?.projectId || record.id || "unknown",
        name: record.details?.name || record.analysis?.projectName || record.projectId || "unknown",
        status: record.status || "queued",
        priority: record.priority || record.analysis?.priority || "normal",
        request: normalizeString(record.request, 500),
        updatedAt: record.updatedAt || record.queuedAt || record.createdAt || "",
        workerOrders: Array.isArray(record.tasks) ? record.tasks.length : 0
    };
}

function compactWorkerLog(record) {
    return {
        id: record.id,
        mode: record.response?.mode || "unknown",
        title: record.response?.title || "",
        project: record.response?.project?.name || "",
        createdAt: record.createdAt || ""
    };
}

function extractOutputText(openaiResponse) {
    const chunks = [];
    for (const item of openaiResponse.output || []) {
        for (const content of item.content || []) {
            if (content.type === "output_text" && content.text) chunks.push(content.text);
            if (content.type === "refusal" && content.refusal) chunks.push(JSON.stringify({
                mode: "blocked",
                title: "Request refused",
                message: content.refusal
            }));
        }
    }
    return chunks.join("\n").trim();
}

function fallbackWorkerResponse(message) {
    return {
        mode: "blocked",
        title: "Cloud worker unavailable",
        message,
        confidence: "low",
        needsUserInput: true,
        council: [],
        project: {
            detected: false,
            id: "",
            name: "",
            status: "blocked",
            priority: "normal",
            objective: "",
            firstSlice: "",
            successMetric: "",
            constraints: [],
            shouldCreateDraft: false
        },
        workerOrders: [],
        safeguards: [
            "No desktop access is available from the web worker.",
            "No repo, deployment, or paid tool action should run without an explicit approved worker order."
        ],
        memoryWrites: [],
        nextActions: [
            { label: "Use local triage fallback", action: "reply", requiresApproval: false }
        ],
        telemetry: {
            contextUsed: [],
            workerVersion: WORKER_VERSION
        }
    };
}

function normalizeWorkerResponse(parsed) {
    const response = {
        ...fallbackWorkerResponse("No response was generated."),
        ...parsed,
        telemetry: {
            ...(fallbackWorkerResponse("").telemetry),
            ...(parsed.telemetry || {}),
            workerVersion: WORKER_VERSION
        }
    };
    response.project = {
        ...fallbackWorkerResponse("").project,
        ...(parsed.project || {})
    };
    response.project.id = safeSlug(response.project.id || response.project.name || "war-room-task");
    response.council = Array.isArray(parsed.council) ? parsed.council : [];
    response.workerOrders = Array.isArray(parsed.workerOrders) ? parsed.workerOrders : [];
    response.safeguards = Array.isArray(parsed.safeguards) ? parsed.safeguards : [];
    response.memoryWrites = Array.isArray(parsed.memoryWrites) ? parsed.memoryWrites : [];
    response.nextActions = Array.isArray(parsed.nextActions) ? parsed.nextActions : [];
    return response;
}

function buildInstructions() {
    const council = COUNCIL_SEATS.map(([seat, focus]) => `- ${seat}: ${focus}`).join("\n");
    return `You are WAR-ROOM-2, a cloud-based project management and agent orchestration worker.

Outcome:
Respond to the management site with the same rigor expected from a senior desktop coding agent, but do not pretend to have desktop shell access. You are an online worker that can reason, plan, structure council sessions, prepare worker orders, and write durable management records through the host system.

Operating rules:
- Cloud-first. Assume GitHub, Cloudflare, object storage, databases, queues, and APIs are the normal execution surfaces.
- No desktop access. Do not claim you can read or modify the user's desktop unless a separate approved desktop bridge exists.
- Council before broad builds. For new projects, major changes, monetization, security-sensitive work, or unclear ideas, run an interactive council and ask the smallest set of high-value questions before saying execution can begin.
- Execution must be narrow. Split projects into reviewable slices; do not send workers after every requirement at once.
- Memory must be durable. Put decisions, assumptions, risks, tasks, and context into memoryWrites so future workers do not depend on chat history.
- Quality gates are mandatory. Every worker order needs an output target and checks.
- Security is a first-class requirement. Prefer least privilege, PR-first GitHub writes, no raw secrets in prompts, approval gates for deployments and paid tool spend.
- If the user asks for something impossible or unsafe, return blocked with the reason and a safer next action.
- The response must be valid JSON matching the supplied schema.

Council seats:
${council}`;
}

function buildInput({ message, conversationId, recentProjects, recentWorkerLogs, actor }) {
    return [
        {
            role: "system",
            content: buildInstructions()
        },
        {
            role: "user",
            content: JSON.stringify({
                request: normalizeString(message, 6000),
                conversationId,
                actor: actor?.email || "backend-user",
                knownProjects: recentProjects.map(compactProject),
                recentWorkerLogs: recentWorkerLogs.map(compactWorkerLog),
                siteCapabilities: [
                    "Can persist management queue records in SECOND_BRAIN_KV.",
                    "Can display responses, council notes, proposed memory writes, and worker orders.",
                    "Can queue project drafts after approval.",
                    "Cannot run desktop shell commands from the browser.",
                    "Repo-writing cloud execution is not connected in this first implementation pass."
                ]
            })
        }
    ];
}

async function callOpenAI(env, input, actor) {
    const apiKey = normalizeString(env.OPENAI_API_KEY, 4000);
    if (!apiKey) {
        return { error: "OPENAI_API_KEY is not configured in Cloudflare Pages.", status: 501 };
    }

    const model = normalizeString(env.OPENAI_MANAGEMENT_MODEL, 80) || "gpt-5.5";
    const reasoningEffort = normalizeString(env.OPENAI_MANAGEMENT_REASONING, 20) || "medium";
    const safetyIdentifier = (await sha256Hex(actor?.email || "backend-user")).slice(0, 64);

    const upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
            "authorization": `Bearer ${apiKey}`,
            "content-type": "application/json"
        },
        body: JSON.stringify({
            model,
            input,
            reasoning: { effort: reasoningEffort },
            max_output_tokens: 4200,
            prompt_cache_key: "war-room-2-management-worker",
            safety_identifier: safetyIdentifier,
            metadata: {
                surface: "cartdotcom-management",
                worker_version: WORKER_VERSION
            },
            text: {
                verbosity: "medium",
                format: {
                    type: "json_schema",
                    name: "war_room_worker_response",
                    strict: true,
                    schema: RESPONSE_SCHEMA
                }
            }
        })
    });

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
        return {
            error: payload.error?.message || `OpenAI request failed with status ${upstream.status}.`,
            status: upstream.status,
            upstreamRequestId: upstream.headers.get("x-request-id") || ""
        };
    }
    return { payload, model };
}

async function persistWorkerRecord(kv, record) {
    if (!kv) return;
    await kv.put(workerKey(record.id), JSON.stringify(record), {
        metadata: {
            mode: record.response?.mode || "unknown",
            projectId: record.response?.project?.id || "",
            createdAt: record.createdAt,
            actor: record.actor || ""
        }
    });
}

export async function onRequestGet(context) {
    const kv = getKV(context.env);
    const records = await listRecords(kv, WORKER_PREFIX, 10);
    return json({
        ok: true,
        configured: {
            kv: Boolean(kv),
            openai: Boolean(normalizeString(context.env.OPENAI_API_KEY, 4000)),
            model: normalizeString(context.env.OPENAI_MANAGEMENT_MODEL, 80) || "gpt-5.5"
        },
        workerVersion: WORKER_VERSION,
        records: records.map(compactWorkerLog)
    });
}

export async function onRequestPost(context) {
    const kv = getKV(context.env);
    if (!kv) return json({ error: "SECOND_BRAIN_KV binding is required for cloud worker memory." }, 503);

    const parsedBody = await readBody(context.request);
    if (parsedBody.error) return json({ error: parsedBody.error }, parsedBody.status);

    const body = parsedBody.body || {};
    const message = normalizeString(body.message, 6000);
    if (!message) return json({ error: "message is required." }, 400);

    const actor = context.data.backendSession || {};
    const conversationId = safeSlug(body.conversationId || crypto.randomUUID(), "conversation");
    const recentProjects = await listRecords(kv, QUEUE_PREFIX, 12);
    const recentWorkerLogs = await listRecords(kv, WORKER_PREFIX, 6);
    const input = buildInput({ message, conversationId, recentProjects, recentWorkerLogs, actor });
    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();

    const openai = await callOpenAI(context.env, input, actor);
    if (openai.error) {
        const fallback = fallbackWorkerResponse(openai.error);
        await persistWorkerRecord(kv, {
            id,
            createdAt,
            actor: actor.email || "backend-user",
            request: message,
            response: fallback,
            error: openai.error
        });
        return json({
            ok: false,
            error: openai.error,
            upstreamRequestId: openai.upstreamRequestId || "",
            record: { id, createdAt, response: fallback }
        }, openai.status || 502);
    }

    let response;
    const outputText = extractOutputText(openai.payload);
    try {
        response = normalizeWorkerResponse(JSON.parse(outputText));
    } catch (error) {
        response = fallbackWorkerResponse("The cloud worker returned malformed structured output. Use local triage fallback and inspect the worker log.");
    }

    const record = {
        id,
        createdAt,
        actor: actor.email || "backend-user",
        conversationId,
        request: message,
        model: openai.model,
        usage: openai.payload.usage || null,
        response
    };
    await persistWorkerRecord(kv, record);
    return json({ ok: true, record });
}
