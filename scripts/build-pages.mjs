import { execFileSync } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, ".pages-dist");
const publicDirectories = new Set(["assets", "backend", "efb228-study-app", "management"]);
const publicExtensions = new Set([
    ".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".woff", ".woff2"
]);
const publicData = ["data/open-close-universe.json", "data/pairs-universe.json"];
const specialFiles = new Set(["_headers", "_redirects", "_routes.json", "robots.txt", "sitemap.xml"]);
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean);
const files = tracked.filter((file) => {
    if (publicData.includes(file) || specialFiles.has(file)) return true;
    const parts = file.split("/");
    if (parts.some((part) => part.startsWith("."))) return false;
    return (parts.length === 1 || publicDirectories.has(parts[0])) && publicExtensions.has(path.extname(file));
});

// Validate required assets before replacing the last successful build.
for (const file of publicData) {
    if (!files.includes(file)) throw new Error(`Required public dataset is not tracked: ${file}`);
    const data = JSON.parse(await readFile(path.join(root, file), "utf8"));
    if (!data.metadata?.symbols?.length || !data.prices?.length) {
        throw new Error(`Required public dataset is empty or invalid: ${file}`);
    }
}
for (const file of files) {
    if (!(await lstat(path.join(root, file))).isFile()) throw new Error(`Not a regular public file: ${file}`);
}
const previous = await lstat(output).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
});
if (previous && !previous.isDirectory()) throw new Error(`Refusing to replace non-directory: ${output}`);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) {
    const destination = path.join(output, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(root, file), destination);
}
console.log(`Built ${files.length} public assets in .pages-dist, including both backtest datasets.`);
