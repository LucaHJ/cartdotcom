import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const deadline = Number(process.env.REEL_STRESS_DEADLINE_EPOCH || 0) * 1000;
const root = process.env.REEL_STRESS_ROOT || "/runs/health-gate";
const endpoints = String(process.env.REEL_STRESS_ENDPOINTS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const scratchPath = path.join(root, "scratch.bin");
const statusPath = path.join(root, "stress-status.json");
const eventsPath = path.join(root, "synthetic-jobs.ndjson");
const memoryBlock = randomBytes(96 * 1024 * 1024);

if (!deadline || deadline <= Date.now()) {
  throw new Error("REEL_STRESS_DEADLINE_EPOCH must be in the future");
}

await mkdir(root, { recursive: true });

async function checkEndpoints() {
  const results = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
      results.push({ endpoint, ok: response.ok, status: response.status });
    } catch (error) {
      results.push({ endpoint, ok: false, error: String(error).slice(0, 200) });
    }
  }
  return results;
}

async function exerciseDisk(sequence) {
  const handle = await open(`${scratchPath}.next`, "w");
  try {
    for (let offset = 0; offset < 8 * 1024 * 1024; offset += memoryBlock.length) {
      const remaining = Math.min(memoryBlock.length, 8 * 1024 * 1024 - offset);
      await handle.write(memoryBlock, 0, remaining, offset);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(`${scratchPath}.next`, scratchPath);

  const event = {
    sequence,
    synthetic: true,
    state: "complete",
    bytes_written: (await stat(scratchPath)).size,
    completed_at: new Date().toISOString(),
  };
  const events = await open(eventsPath, "a");
  try {
    await events.write(`${JSON.stringify(event)}\n`);
  } finally {
    await events.close();
  }
}

function exerciseCpu(milliseconds = 600) {
  const end = Date.now() + milliseconds;
  let digest = memoryBlock;
  while (Date.now() < end) {
    digest = createHash("sha256").update(digest).update(memoryBlock).digest();
  }
  return digest.toString("hex");
}

let sequence = 0;
while (Date.now() < deadline) {
  sequence += 1;
  const startedAt = new Date().toISOString();
  const digest = exerciseCpu();
  if (sequence === 1 || sequence % 20 === 0) {
    await exerciseDisk(sequence);
  }
  const endpointsState = await checkEndpoints();
  const status = {
    state: endpointsState.every((item) => item.ok) ? "running" : "degraded",
    synthetic: true,
    sequence,
    started_at: startedAt,
    checked_at: new Date().toISOString(),
    deadline: new Date(deadline).toISOString(),
    digest,
    endpoints: endpointsState,
  };
  await writeFile(`${statusPath}.next`, JSON.stringify(status, null, 2));
  await rename(`${statusPath}.next`, statusPath);
  await new Promise((resolve) => setTimeout(resolve, 900));
}

await writeFile(
  statusPath,
  JSON.stringify({ state: "complete", synthetic: true, sequence, completed_at: new Date().toISOString() }, null, 2),
);
