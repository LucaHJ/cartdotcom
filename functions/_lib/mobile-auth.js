import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse
} from "@simplewebauthn/server";

const EMAIL_HEADER = "cf-access-authenticated-user-email";
const ACCESS_IDENTITY_MISSING_ERROR = [
    "Cloudflare Access identity is missing.",
    "Protect mobile-approval.html and /api/mobile/* in the same Cloudflare Access application,",
    "then reload after signing in. If Access login succeeds, confirm the API Function is receiving",
    "a valid Cf-Access-Jwt-Assertion."
].join(" ");
const KEY_PREFIX = "mobile-auth";

export function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store"
        }
    });
}

export function normalizeString(value, maxLength = 4000) {
    return String(value || "").trim().slice(0, maxLength);
}

export function base64URLStringToBuffer(value) {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

export function bufferToBase64URLString(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256Base64URL(value) {
    const data = new TextEncoder().encode(String(value || ""));
    const digest = await crypto.subtle.digest("SHA-256", data);
    return bufferToBase64URLString(new Uint8Array(digest));
}

export function getKV(env) {
    if (!env.MOBILE_AUTH_KV) {
        return null;
    }
    return env.MOBILE_AUTH_KV;
}

function getAccessPayloadEmail(data) {
    return normalizeString(data?.cloudflareAccess?.JWT?.payload?.email, 320).toLowerCase();
}

export function getActor(request, env, data = {}) {
    const email = normalizeString(request.headers.get(EMAIL_HEADER), 320).toLowerCase()
        || getAccessPayloadEmail(data);
    if (!email) {
        return { ok: false, error: ACCESS_IDENTITY_MISSING_ERROR };
    }

    const allowList = normalizeString(env.ALLOWED_ACCESS_EMAILS, 4000)
        .split(",")
        .map(item => item.trim().toLowerCase())
        .filter(Boolean);

    if (allowList.length && !allowList.includes(email)) {
        return { ok: false, error: "This Access identity is not allowed to use mobile approval." };
    }

    return { ok: true, email };
}

export function getRelyingParty(request, env) {
    const url = new URL(request.url);
    const rpID = normalizeString(env.WEBAUTHN_RP_ID, 255) || url.hostname;
    const origin = normalizeString(env.WEBAUTHN_ORIGIN, 255) || url.origin;
    return {
        rpName: normalizeString(env.WEBAUTHN_RP_NAME, 80) || "cartdotcom Remote Approval",
        rpID,
        origin
    };
}

export function keys(email) {
    return {
        credential: `${KEY_PREFIX}:credential:${email}`,
        registration: `${KEY_PREFIX}:challenge:registration:${email}`,
        authenticationPrefix: `${KEY_PREFIX}:challenge:authentication:${email}:`
    };
}

export function approvalKey(jobId) {
    return `${KEY_PREFIX}:approval:${jobId}`;
}

export async function getCredential(kv, email) {
    return kv.get(keys(email).credential, "json");
}

export async function putCredential(kv, email, credential) {
    await kv.put(keys(email).credential, JSON.stringify(credential));
}

export async function createRegistrationOptions(request, env, data = {}) {
    const kv = getKV(env);
    if (!kv) return json({ error: "MOBILE_AUTH_KV binding is required." }, 503);

    const actor = getActor(request, env, data);
    if (!actor.ok) return json({ error: actor.error }, 401);

    const existing = await getCredential(kv, actor.email);
    if (existing) {
        return json({
            registered: true,
            email: actor.email,
            rpID: getRelyingParty(request, env).rpID
        });
    }

    const { rpName, rpID } = getRelyingParty(request, env);
    const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userID: new TextEncoder().encode(actor.email),
        userName: actor.email,
        userDisplayName: actor.email,
        attestationType: "none",
        excludeCredentials: [],
        authenticatorSelection: {
            residentKey: "preferred",
            userVerification: "required"
        },
        preferredAuthenticatorType: "localDevice",
        supportedAlgorithmIDs: [-7, -257]
    });

    await kv.put(keys(actor.email).registration, JSON.stringify(options), { expirationTtl: 300 });
    return json({ options, email: actor.email, rpID });
}

export async function verifyRegistration(request, env, data = {}) {
    const kv = getKV(env);
    if (!kv) return json({ error: "MOBILE_AUTH_KV binding is required." }, 503);

    const actor = getActor(request, env, data);
    if (!actor.ok) return json({ error: actor.error }, 401);

    const body = await request.json().catch(() => null);
    if (!body?.response) return json({ error: "Registration response is required." }, 400);

    const currentOptions = await kv.get(keys(actor.email).registration, "json");
    if (!currentOptions) return json({ error: "Registration challenge expired. Start again." }, 400);

    const { rpID, origin } = getRelyingParty(request, env);
    let verification;
    try {
        verification = await verifyRegistrationResponse({
            response: body.response,
            expectedChallenge: currentOptions.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: true
        });
    } catch (error) {
        return json({ error: error.message || "Registration verification failed." }, 400);
    }

    if (!verification.verified || !verification.registrationInfo) {
        return json({ verified: false, error: "Registration was not verified." }, 400);
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await putCredential(kv, actor.email, {
        id: credential.id,
        publicKey: bufferToBase64URLString(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports || body.response.response.transports || [],
        webauthnUserID: currentOptions.user.id,
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        registeredAt: new Date().toISOString(),
        email: actor.email
    });
    await kv.delete(keys(actor.email).registration);

    return json({ verified: true, email: actor.email });
}

export async function createPendingApproval(context, job, metadata = {}) {
    const kv = getKV(context.env);
    if (!kv) {
        return { configured: false, warning: "MOBILE_AUTH_KV binding is not configured." };
    }

    const owner = normalizeString(metadata.submitter, 320).toLowerCase() || normalizeString(job.submitted_by, 320).toLowerCase();
    const approval = {
        job_id: job.job_id,
        owner,
        status: "pending",
        action_class: job.action_class,
        target: job.target,
        prompt: job.prompt,
        attachments: job.attachments || [],
        prompt_hash: job.prompt_hash,
        success_criteria: job.success_criteria,
        risk_level: job.risk_level,
        approval_level: job.approval_level,
        result_channel: job.result_channel,
        issueNumber: metadata.issueNumber || null,
        issueUrl: metadata.issueUrl || "",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };

    await kv.put(approvalKey(job.job_id), JSON.stringify(approval), { expirationTtl: 7 * 24 * 60 * 60 });
    return {
        configured: true,
        approval,
        approvalUrl: `/mobile-approval.html?job=${encodeURIComponent(job.job_id)}`
    };
}

export async function listPendingApprovals(request, env, data = {}) {
    const kv = getKV(env);
    if (!kv) return json({ error: "MOBILE_AUTH_KV binding is required." }, 503);

    const actor = getActor(request, env, data);
    if (!actor.ok) return json({ error: actor.error }, 401);

    const listed = await kv.list({ prefix: `${KEY_PREFIX}:approval:` });
    const approvals = [];
    for (const key of listed.keys || []) {
        const approval = await kv.get(key.name, "json");
        if (!approval || approval.status !== "pending") continue;
        if (approval.owner && approval.owner !== actor.email && env.MOBILE_APPROVAL_ALLOW_ALL !== "true") continue;
        approvals.push(approval);
    }

    approvals.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const credential = await getCredential(kv, actor.email);
    return json({
        email: actor.email,
        registered: Boolean(credential),
        approvals
    });
}

export async function createApprovalOptions(request, env, data = {}) {
    const kv = getKV(env);
    if (!kv) return json({ error: "MOBILE_AUTH_KV binding is required." }, 503);

    const actor = getActor(request, env, data);
    if (!actor.ok) return json({ error: actor.error }, 401);

    const body = await request.json().catch(() => null);
    const jobId = normalizeString(body?.job_id, 120);
    const decision = normalizeString(body?.decision, 20) || "approve";
    if (!jobId || !["approve", "reject"].includes(decision)) return json({ error: "Valid job_id and decision are required." }, 400);

    const approval = await kv.get(approvalKey(jobId), "json");
    if (!approval || approval.status !== "pending") return json({ error: "Pending approval was not found." }, 404);
    if (approval.owner && approval.owner !== actor.email && env.MOBILE_APPROVAL_ALLOW_ALL !== "true") {
        return json({ error: "This approval is assigned to another Access identity." }, 403);
    }

    const credential = await getCredential(kv, actor.email);
    if (!credential) return json({ error: "Register a mobile passkey before approving jobs." }, 400);

    const { rpID } = getRelyingParty(request, env);
    const canonical = [
        jobId,
        approval.prompt_hash,
        approval.action_class,
        approval.target,
        approval.approval_level,
        decision,
        crypto.randomUUID()
    ].join("|");
    const challenge = await sha256Base64URL(canonical);
    const options = await generateAuthenticationOptions({
        rpID,
        challenge,
        userVerification: "required",
        allowCredentials: [{ id: credential.id, transports: credential.transports }]
    });

    await kv.put(
        `${keys(actor.email).authenticationPrefix}${jobId}`,
        JSON.stringify({ challenge: options.challenge, jobId, decision, createdAt: new Date().toISOString() }),
        { expirationTtl: 300 }
    );

    return json({ options, approval });
}

async function postGitHubComment(env, approval, decision, actorEmail) {
    if (!env.GITHUB_TOKEN || !env.COMMAND_QUEUE_REPO || !approval.issueNumber) return;
    await fetch(`https://api.github.com/repos/${env.COMMAND_QUEUE_REPO}/issues/${approval.issueNumber}/comments`, {
        method: "POST",
        headers: {
            "accept": "application/vnd.github+json",
            "authorization": `Bearer ${env.GITHUB_TOKEN}`,
            "content-type": "application/json",
            "user-agent": "cartdotcom-mobile-approval",
            "x-github-api-version": "2022-11-28"
        },
        body: JSON.stringify({
            body: [
                `Mobile approval **${decision}** by \`${actorEmail}\`.`,
                "",
                `- Job ID: \`${approval.job_id}\``,
                `- Prompt hash: \`sha256:${approval.prompt_hash}\``,
                `- Action class: \`${approval.action_class}\``,
                `- Approval gate: \`${approval.approval_level}\``
            ].join("\n")
        })
    });
}

export async function verifyApproval(request, env, data = {}) {
    const kv = getKV(env);
    if (!kv) return json({ error: "MOBILE_AUTH_KV binding is required." }, 503);

    const actor = getActor(request, env, data);
    if (!actor.ok) return json({ error: actor.error }, 401);

    const body = await request.json().catch(() => null);
    const jobId = normalizeString(body?.job_id, 120);
    const decision = normalizeString(body?.decision, 20) || "approve";
    if (!jobId || !body?.response || !["approve", "reject"].includes(decision)) {
        return json({ error: "job_id, decision, and passkey response are required." }, 400);
    }

    const pendingChallenge = await kv.get(`${keys(actor.email).authenticationPrefix}${jobId}`, "json");
    if (!pendingChallenge || pendingChallenge.decision !== decision) {
        return json({ error: "Approval challenge expired or does not match this decision." }, 400);
    }

    const approval = await kv.get(approvalKey(jobId), "json");
    if (!approval || approval.status !== "pending") return json({ error: "Pending approval was not found." }, 404);
    if (approval.owner && approval.owner !== actor.email && env.MOBILE_APPROVAL_ALLOW_ALL !== "true") {
        return json({ error: "This approval is assigned to another Access identity." }, 403);
    }

    const credential = await getCredential(kv, actor.email);
    if (!credential || credential.id !== body.response.id) {
        return json({ error: "Registered passkey was not found for this Access identity." }, 400);
    }

    const { rpID, origin } = getRelyingParty(request, env);
    let verification;
    try {
        verification = await verifyAuthenticationResponse({
            response: body.response,
            expectedChallenge: pendingChallenge.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: true,
            credential: {
                id: credential.id,
                publicKey: base64URLStringToBuffer(credential.publicKey),
                counter: credential.counter,
                transports: credential.transports
            }
        });
    } catch (error) {
        return json({ error: error.message || "Approval verification failed." }, 400);
    }

    if (!verification.verified) return json({ verified: false, error: "Passkey authentication was not verified." }, 400);

    const nextApproval = {
        ...approval,
        status: decision === "approve" ? "approved" : "rejected",
        mobile_approval: {
            decision,
            actor: actor.email,
            verified_at: new Date().toISOString(),
            method: "webauthn-passkey",
            prompt_hash: approval.prompt_hash
        }
    };
    await kv.put(approvalKey(jobId), JSON.stringify(nextApproval), { expirationTtl: 30 * 24 * 60 * 60 });
    await putCredential(kv, actor.email, {
        ...credential,
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date().toISOString()
    });
    await kv.delete(`${keys(actor.email).authenticationPrefix}${jobId}`);
    await postGitHubComment(env, approval, decision, actor.email);

    return json({
        verified: true,
        decision,
        job_id: jobId,
        issueUrl: approval.issueUrl || ""
    });
}
