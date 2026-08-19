import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(scriptDirectory, "../../cloudflare-news-signal-container/src/index.ts");
const outputPath = path.resolve(scriptDirectory, "../news/api/dashboard.html");
const source = await readFile(sourcePath, "utf8");
const marker = "const DASHBOARD_HTML = `";
const start = source.indexOf(marker);
if (start < 0) throw new Error(`Dashboard template marker not found in ${sourcePath}`);
const contentStart = start + marker.length;
const end = source.indexOf("`;", contentStart);
if (end < 0) throw new Error(`Dashboard template terminator not found in ${sourcePath}`);
const rawDashboard = source.slice(contentStart, end);
if (rawDashboard.includes("${") || rawDashboard.includes("`")) {
  throw new Error("Dashboard template is no longer static; update the synchronizer before evaluating it");
}
const dashboard = Function(`"use strict"; return \`${rawDashboard}\`;`)();
if (!dashboard.startsWith("<!doctype html>") || !dashboard.trimEnd().endsWith("</html>")) {
  throw new Error("Extracted dashboard did not pass HTML boundary validation");
}
await writeFile(outputPath, dashboard, "utf8");
console.log(`Synchronized ${dashboard.length} dashboard characters to ${outputPath}`);
