const port = Number(process.env.HEALTH_PORT || 3005);
const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(3000) });
if (!response.ok) process.exit(1);
