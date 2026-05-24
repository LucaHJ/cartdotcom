import { createPendingApproval } from "../_lib/mobile-auth.js";
import { requireBackendSession } from "../_lib/backend-auth.js";

const REMOTE_PROMPT_POLICY = {
    actionClass: "general",
    target: "WAR ROOM",
    risk: "medium",
    approval: "verified_mobile_gate",
    approvalRequired: true,
    resultChannel: "github_issue"
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

function fetchMetadataLooksSafe(request) {
    const site = request.headers.get("sec-fetch-site");
    if (!site) return true;
    return ["same-origin", "same-site", "none"].includes(site);
}

function containsLikelySecret(value) {
    return SECRET_PATTERNS.some(pattern => pattern.test(value));
}

function normalizeAttachments(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 5).map((attachment) => ({
        name: normalizeString(attachment?.name, 180) || "unnamed",
        type: normalizeString(attachment?.type, 120) || "application/octet-stream",
        size: Math.max(0, Number(attachment?.size) || 0),
        encoding: normalizeString(attachment?.encoding, 40) || "metadata-only",
        content: normalizeString(attachment?.content, 128 * 1024),
        truncated: Boolean(attachment?.truncated)
    }));
}

function parseRepo(value) {
    const repo = normalizeString(value, 200);
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
    return repo;
}

function buildIssueBody(job, submitter) {
    const body = [
        "## Remote Command Job",
        "",
        "| Field | Value |",
        "|---|---|",
        `| Job ID | \`${job.job_id}\` |`,
        `| Submitted by | ${submitter || "backend user"} |`,
        `| Submitted at | ${job.submitted_at} |`,
        `| Action class | \`${job.action_class}\` |`,
        `| Target | ${job.target} |`,
        `| Risk | \`${job.risk_level}\` |`,
        `| Approval gate | \`${job.approval_level}\` |`,
        `| Approval required | \`${job.approval_required}\` |`,
        `| Result channel | \`${job.result_channel}\` |`,
        `| Prompt hash | \`sha256:${job.prompt_hash}\` |`,
        "",
        "## Prompt",
        "",
        "```text",
        job.prompt,
        "```",
        ""
    ];

    if (job.attachments.length) {
        body.push("## Uploads", "");
        job.attachments.forEach((attachment, index) => {
            body.push(`### ${index + 1}. ${attachment.name}`);
            body.push("");
            body.push(`- Type: \`${attachment.type}\``);
            body.push(`- Size: \`${attachment.size}\``);
            body.push(`- Encoding: \`${attachment.encoding}\``);
            body.push(`- Truncated: \`${attachment.truncated}\``);
            if (attachment.content) {
                body.push("");
                body.push("```text");
                body.push(attachment.content);
                body.push("```");
            }
            body.push("");
        });
    }

    body.push(
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
    );

    return body.join("\n");
}

export async function onRequestOptions() {
    return json({ ok: true });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    if (!fetchMetadataLooksSafe(request)) {
        return json({ error: "Cross-site command submissions are blocked." }, 403);
    }

    const submitter = context.data.backendSession?.ok
        ? context.data.backendSession
        : await requireBackendSession(context);
    if (!submitter.ok) {
        return json({ error: submitter.error || "Backend login is required." }, 401);
    }

    let input;
    try {
        input = await request.json();
    } catch (error) {
        return json({ error: "Invalid JSON body." }, 400);
    }

    const prompt = normalizeString(input.prompt, 8000);
    const attachments = normalizeAttachments(input.attachments);
    if (!prompt && !attachments.length) {
        return json({ error: "Prompt or upload is required." }, 400);
    }

    const attachmentText = attachments.map(attachment => attachment.content).join("\n");
    if (containsLikelySecret(`${prompt}\n${attachmentText}`)) {
        return json({ error: "Prompt appears to contain a secret. Remove credentials before submitting." }, 400);
    }

    const computedHash = await sha256(JSON.stringify({ prompt, attachments }));
    if (input.prompt_hash && String(input.prompt_hash).replace(/^sha256:/, "") !== computedHash) {
        return json({ error: "Prompt hash mismatch." }, 400);
    }

    const queueRepo = parseRepo(env.COMMAND_QUEUE_REPO || "");
    const hasGitHubQueue = Boolean(queueRepo && env.GITHUB_TOKEN);
    const job = {
        job_id: normalizeString(input.job_id, 80) || `cmd_${crypto.randomUUID().slice(0, 8)}`,
        submitted_at: normalizeString(input.submitted_at, 40) || new Date().toISOString(),
        action_class: REMOTE_PROMPT_POLICY.actionClass,
        target: REMOTE_PROMPT_POLICY.target,
        prompt,
        attachments,
        prompt_hash: computedHash,
        success_criteria: "Classify this authenticated prompt under WAR ROOM rules, define practical success criteria, verify them, and iterate until they pass or document blockers.",
        risk_level: REMOTE_PROMPT_POLICY.risk,
        approval_level: REMOTE_PROMPT_POLICY.approval,
        approval_required: REMOTE_PROMPT_POLICY.approvalRequired,
        result_channel: hasGitHubQueue ? REMOTE_PROMPT_POLICY.resultChannel : "mobile_auth_kv"
    };

    let issue = null;
    if (hasGitHubQueue) {
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
                title: `[Remote Prompt] ${prompt.replace(/\s+/g, " ").slice(0, 72) || "Uploaded file"}`,
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
        issue = payload;
    }

    const approvalResult = job.approval_required
        ? await createPendingApproval(context, job, {
            submitter: submitter.email,
            issueNumber: issue?.number || null,
            issueUrl: issue?.html_url || ""
        })
        : {};

    if (!issue && !approvalResult.configured) {
        return json({
            error: "Queue backend is not configured. Set MOBILE_AUTH_KV or COMMAND_QUEUE_REPO and GITHUB_TOKEN in Cloudflare Pages.",
            jobId: job.job_id,
            promptHash: job.prompt_hash
        }, 503);
    }

    return json({
        ok: true,
        jobId: job.job_id,
        promptHash: job.prompt_hash,
        queueBackend: issue ? "github_issue" : "mobile_auth_kv",
        issueNumber: issue?.number || null,
        issueUrl: issue?.html_url || "",
        approvalRequired: job.approval_required,
        ...approvalResult
    });
}
