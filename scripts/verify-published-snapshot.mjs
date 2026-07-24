import { readFile } from "node:fs/promises";

const snapshotFile = process.argv[2] || "public/data/latest.json";
const publicUrl = process.env.MOONCAKES_PUBLIC_SNAPSHOT_URL ||
  "https://zongen01.github.io/mooncakes-contributor-dashboard/data/latest.json";
const attempts = Number(process.env.PUBLISHED_SNAPSHOT_VERIFY_ATTEMPTS || 30);
const intervalMs = Number(process.env.PUBLISHED_SNAPSHOT_VERIFY_INTERVAL_MS || 10_000);
const expected = JSON.parse(await readFile(snapshotFile, "utf8"));

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function findSensitiveKeys(value, matches = []) {
  if (!value || typeof value !== "object") return matches;
  for (const [key, child] of Object.entries(value)) {
    if (/(?:^|_)(?:password|passwd|secret|access_token|refresh_token|oauth_token|github_token|token|email|phone|mobile)(?:_|$)/i.test(key)) {
      matches.push(key);
    }
    findSensitiveKeys(child, matches);
  }
  return matches;
}

function isPrivateNetworkHostname(hostname) {
  const normalized = String(hostname || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  if (/^(?:127|10)\./.test(normalized) || /^192\.168\./.test(normalized)) return true;
  const private172 = normalized.match(/^172\.(\d{1,3})\./);
  return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}

function hasPrivateNetworkUrl(value) {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    try {
      return isPrivateNetworkHostname(new URL(value).hostname);
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(hasPrivateNetworkUrl);
}

function snapshotMismatch(actual) {
  const mismatches = [];
  if (actual.date !== expected.date) mismatches.push("snapshot date");
  if (actual.captured_at !== expected.captured_at) mismatches.push("capture timestamp");
  if (actual.timezone !== "UTC") mismatches.push("timezone");
  if (actual.source?.provider !== "business-analytics-exports") mismatches.push("sanitized source");
  if (actual.data_quality?.status !== "pass") mismatches.push("quality status");
  for (const field of ["total_uploaders", "total_modules", "total_versions", "total_downloads"]) {
    if (Number(actual.statistics?.[field]) !== Number(expected.statistics?.[field])) {
      mismatches.push(field);
    }
  }
  if (findSensitiveKeys(actual).length) mismatches.push("sensitive keys");
  if (hasPrivateNetworkUrl(actual)) mismatches.push("private network URL");
  return mismatches;
}

let lastError = "online snapshot was not checked";
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const separator = publicUrl.includes("?") ? "&" : "?";
    const response = await fetch(`${publicUrl}${separator}verify=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const actual = await response.json();
    const mismatches = snapshotMismatch(actual);
    if (!mismatches.length) {
      console.log(JSON.stringify({
        verified: true,
        date: actual.date,
        captured_at: actual.captured_at,
        owners: actual.statistics.total_uploaders,
        modules: actual.statistics.total_modules,
        versions: actual.statistics.total_versions,
        quality: actual.data_quality.status
      }));
      process.exit(0);
    }
    lastError = `online snapshot mismatch: ${mismatches.join(", ")}`;
  } catch (error) {
    lastError = String(error.message || error);
  }
  if (attempt < attempts) await wait(intervalMs);
}

throw new Error(`Published snapshot verification failed after ${attempts} attempts: ${lastError}`);
