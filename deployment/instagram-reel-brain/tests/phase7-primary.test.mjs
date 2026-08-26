import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

test("Phase 7 migration object surface is authenticated, GET-only, and read-only", () => {
  const start = source.indexOf('if (url.pathname === "/api/phase7/object")');
  const end = source.indexOf('if (url.pathname === "/api/test/jobs"', start);
  assert.ok(start > 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /request\.method !== "GET"/);
  assert.match(body, /timingSafeEqual\(bearer\(request\), env\.PHASE7_ORIGIN_TOKEN\)/);
  assert.match(body, /env\.REEL_ARCHIVE\.get\(key\)/);
  assert.doesNotMatch(body, /REEL_ARCHIVE\.(?:put|delete|createMultipartUpload)/);
  assert.match(body, /segment === "\.\."/);
});

test("Phase 7 library writes carry bounded gallery metadata to the private origin", () => {
  const start = source.indexOf("async function putPhase7Origin(");
  const end = source.indexOf("async function putPhase7MirroredObject", start);
  assert.ok(start > 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /x-phase7-library-metadata/);
  assert.match(body, /toBase64Url\(JSON\.stringify\(libraryMetadata\)\)/);

  const libraryStart = source.indexOf("async function putReelLibraryHtml(");
  const libraryEnd = source.indexOf("async function refreshReelLibraryManifest", libraryStart);
  const libraryBody = source.slice(libraryStart, libraryEnd);
  assert.match(libraryBody, /kind: String\(metadata\.kind \|\| "file"\)/);
  assert.match(libraryBody, /job_id: String\(metadata\.job_id/);
  assert.match(libraryBody, /media_type: String\(metadata\.media_type/);
  assert.match(libraryBody, /encoded\.byteLength, digest, phase7Metadata\);/);
});
