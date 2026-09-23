import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const base = process.argv[2];
const datasets = ["data/open-close-universe.json", "data/pairs-universe.json"];
if (!base) {
    const files = (await readdir(new URL("../.pages-dist/", import.meta.url), { recursive: true }))
        .map((file) => file.replaceAll("\\", "/"));
    assert(!files.some((file) => /(^|\/)(deployment|functions|scripts|node_modules|\.env|\.git)(\/|$)/.test(file)));
    assert(!files.includes("package.json"));
    assert.deepEqual(files.filter((file) => file.startsWith("data/")).sort(), [...datasets].sort());
    console.log("Public asset allowlist verified; private/server files excluded.");
}
for (const file of datasets) {
    let payload;
    if (base) {
        const response = await fetch(new URL(file, base.endsWith("/") ? base : `${base}/`));
        assert.equal(response.status, 200, `${file}: HTTP ${response.status}`);
        assert.match(response.headers.get("content-type") || "", /application\/json/, `${file}: expected JSON`);
        payload = await response.json();
    } else {
        payload = JSON.parse(await readFile(new URL(`../.pages-dist/${file}`, import.meta.url), "utf8"));
    }
    const source = JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), "utf8"));
    assert.deepEqual(payload, source, `${file}: deployed prices differ from the source dataset`);
    console.log(`${file}: ${payload.prices.length} days, ${payload.metadata.symbols.length} symbols, verified`);
}
