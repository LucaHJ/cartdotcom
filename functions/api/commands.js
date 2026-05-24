import { createPendingApproval } from "../_lib/mobile-auth.js";

const ALLOWED_ACTIONS = new Set([
    "small_note",
    "wiki_research",
    "repo_edit",
    "agent_rule_change",
    "deploy",
    "general"
]);

const ACTION_POLICY = {
    small_note: { risk: "low", approval: "capture_only", approvalRequired: false },
    wiki_research: { risk: "medium", approval: "research_only", approvalRequired: false },
    repo_edit: { risk: "high", approval: "run_local_codex", approvalRequired: true },
    agent_rule_change: { risk: "high", approval: "draft_changes", approvalRequired: true },
    deploy: { risk: "critical", approval: "deploy", approvalRequired: true },
    general: { risk: "medium", approval: "draft_changes", approvalRequired: true }
};

const SECRET_PATTERNS = [
    /api[_-]?key\s*[:=]\s*\S+/i,
    /secret\s*[:=]\s*\S+/i,
    /token\s*[:=]\s*\S+/i,
    /password\s*[:=]\s*\S+/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/
];

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store"
        }
    });
}

function normalizeString(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
}

async function sha256(value) {
    const data = new TextEncoder().encode(String(value || ""));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function isAllowedSubmitter(request, env) {
    const email = request.headers.get("cf-access-authenticated-user-email");
    if (!email) return { ok: false, email: "" };

    const allowList = normalizeString(env.ALLOWED_ACCESS_EMAILS, 4000)
        .split(",")
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);

    if (allowList.length && !allowList.includes(email.toLowerCase())) {
        return { ok: false, email };
    }

    return { ok: true, email };
}

function fetchMetadataLooksSafe(request) {
    const site = request.headers.get("sec-fetch-site");
    if (!site) return true;
    return ["same-origin", "same-site", "none"].includes(site);
}

function containsLikelySecret(value) {
    return SECRET_PATTERNS.some(pattern => pattern.test(value));
}

function parseRepo(value) {
    const repo = normalizeString(value, 200);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
    return repo;
}

function buildIssueBody(job, submitter) {
    return [
        "## Remote Command Job",
        "",
        "| Field | Value |",
        "|---|---|",
        `| Job ID | \`${job.job_id}\` |`,
        `| Submitted by | ${submitter || "Cloudflare Access user"} |`,
        `| Submitted at | ${job.submitted_at} |`,
        `| Action class | \`${job.action_class}\` |`,
        `| Target | ${job.target} |`,
        `| Risk | \`${job.risk_level}\` |`,
        `| Approval level | \`${job.approval_level}\` |`,
        `| Approval required | \`${job.approval_required}\` |`,
        `| Result channel | \`${job.result_channel}\` |`,
        `| Prompt hash | \`sha256:${job.prompt_hash}\` |`,
        "",
        "## Prompt",
        "",
        "```text",
        job.prompt,
        "```",
        "",
        "## Success Criteria",
        "",
        "```text",
        job.success_criteria,
        "```",
        "",
        "## Runner Policy",
        "",
        "- Process this as a queued WAR ROOM remote command.",
        "- Do not expose Codex app-server to the public internet.",
        "- For heavy actions, require verified mobile approval before execution.",
        "- Execute locally under WAR ROOM `AGENTS.md` rules.",
        "- Report results here or through the selected result channel."
    ].join("\n");
}

export async function onRequestOptions() {
    return json({ ok: true });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    if (!fetchMetadataLooksSafe(request)) {
        return json({ error: "Cross-site command submissions are blocked." }, 403);
    }

    const submitter = isAllowedSubmitter(request, env);
    if (!submitter.ok && env.ALLOW_UNAUTHENTICATED_COMMANDS !== "true") {
        return json({ error: "Cloudflare Access authentication is required before remote command submission." }, 401);
    }

    let input;
    try {
        input = await request.json();
    } catch (error) {
        return json({ error: "Invalid JSON body." }, 400);
    }

    const actionClass = normalizeString(input.action_class, 80);
    if (!ALLOWED_ACTIONS.has(actionClass)) {
        return json({ error: "Unsupported action class." }, 400);
    }

    const prompt = normalizeString(input.prompt, 8000);
    if (!prompt) {
        return json({ error: "Prompt is required." }, 400);
    }

    if (containsLikelySecret(prompt)) {
        return json({ error: "Prompt appears to contain a secret. Remove credentials before submitting." }, 400);
    }

    const computedHash = await sha256(prompt);
    if (input.prompt_hash && String(input.prompt_hash).replace(/^sha256:/, "") !== computedHash) {
        return json({ error: "Prompt hash mismatch." }, 400);
    }

    const policy = ACTION_POLICY[actionClass] || ACTION_POLICY.general;
    const job = {
        job_id: normalizeString(input.job_id, 80) || `cmd_${crypto.randomUUID().slice(0, 8)}`,
        submitted_at: normalizeString(input.submitted_at, 40) || new Date().toISOString(),
        action_class: actionClass,
        target: normalizeString(input.target, 200) || "WAR ROOM",
        prompt,
        prompt_hash: computedHash,
        success_criteria: normalizeString(input.success_criteria, 4000) || "State practical success criteria, verify them, and iterate until they pass or document blockers.",
        risk_level: policy.risk,
        approval_level: normalizeString(input.approval_level, 80) || policy.approval,
        approval_required: Boolean(policy.approvalRequired || input.approval_required),
        result_channel: normalizeString(input.result_channel, 80) || "github_issue"
    };

    const queueRepo = parseRepo(env.COMMAND_QUEUE_REPO || "");
    if (!queueRepo || !env.GITHUB_TOKEN) {
        return json({
            error: "Queue backend is not configured. Set COMMAND_QUEUE_REPO and GITHUB_TOKEN in Cloudflare Pages.",
            jobId: job.job_id,
            promptHash: job.prompt_hash
        }, 503);
    }

    const labels = env.ENABLE_COMMAND_LABELS === "true"
        ? [
            "remote-command",
            `remote-${job.action_class}`,
            job.approval_required ? "approval-required" : "approval-not-required",
            `risk-${job.risk_level}`
        ]
        : [];

    const response = await fetch(`https://api.github.com/repos/${queueRepo}/issues`, {
        method: "POST",
        headers: {
            "accept": "application/vnd.github+json",
            "authorization": `Bearer ${env.GITHUB_TOKEN}`,
            "content-type": "application/json",
            "user-agent": "cartdotcom-remote-command-inbox",
            "x-github-api-version": "2022-11-28"
        },
        body: JSON.stringify({
            title: `[Remote Command] ${job.action_class.replaceAll("_", " ")}: ${job.target}`,
            body: buildIssueBody(job, submitter.email),
            ...(labels.length ? { labels } : {})
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        return json({
            error: "GitHub issue creation failed.",
            detail: payload.message || "Unknown GitHub API error."
        }, 502);
    }

    return json({
        ok: true,
        jobId: job.job_id,
        promptHash: job.prompt_hash,
        issueNumber: payload.number,
        issueUrl: payload.html_url,
        approvalRequired: job.approval_required,
        ...(job.approval_required
            ? await createPendingApproval(context, job, {
                submitter: submitter.email,
                issueNumber: payload.number,
                issueUrl: payload.html_url
            })
            : {})
    });
}
