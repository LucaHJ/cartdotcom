const port = Number.parseInt(process.env.HEALTH_PORT || "3004", 10);
const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(4_000) });
if (!response.ok) process.exit(1);
