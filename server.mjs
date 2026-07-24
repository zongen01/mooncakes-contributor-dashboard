import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { SNAPSHOT_ALGORITHM_VERSION, todayInUtc } from "./lib/mooncakes-exports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const snapshotDir = path.join(__dirname, "data", "snapshots");
const buildScript = path.join(__dirname, "scripts", "build-snapshot.mjs");
const publicSnapshotFile = path.join(publicDir, "data", "latest.json");
const port = Number(process.env.PORT || 4177);
const execFileAsync = promisify(execFile);
let snapshotBuildInFlight = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function isCurrentExportSnapshot(snapshot, date) {
  return snapshot?.source?.provider === "business-analytics-exports"
    && snapshot?.date === date
    && snapshot?.timezone === "UTC"
    && snapshot?.derived_metrics?.algorithm_version === SNAPSHOT_ALGORITHM_VERSION
    && snapshot?.data_quality?.status === "pass";
}

async function readCurrentSnapshot(file, date) {
  try {
    const snapshot = JSON.parse(await readFile(file, "utf8"));
    return isCurrentExportSnapshot(snapshot, date) ? snapshot : null;
  } catch {
    return null;
  }
}

function newestSnapshot(snapshots) {
  return snapshots
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.captured_at || 0) - Date.parse(left.captured_at || 0))[0] || null;
}

async function buildSnapshot(file) {
  if (!snapshotBuildInFlight) {
    snapshotBuildInFlight = (async () => {
      await execFileAsync(process.execPath, [buildScript, file], {
        cwd: __dirname,
        env: process.env,
        maxBuffer: 4 * 1024 * 1024
      });
      return JSON.parse(await readFile(file, "utf8"));
    })().finally(() => {
      snapshotBuildInFlight = null;
    });
  }
  return snapshotBuildInFlight;
}

async function makeSnapshot(force = false) {
  await mkdir(snapshotDir, { recursive: true });
  const date = todayInUtc();
  const file = path.join(snapshotDir, `${date}.json`);

  if (!force) {
    const cached = newestSnapshot(await Promise.all([
      readCurrentSnapshot(file, date),
      readCurrentSnapshot(publicSnapshotFile, date)
    ]));
    if (cached) return { ...cached, cached: true };
  }

  const snapshot = await buildSnapshot(file);
  return { ...snapshot, cached: false };
}

async function sendJson(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const resolved = path.resolve(publicDir, `.${pathname}`);
  if (resolved !== publicDir && !resolved.startsWith(`${publicDir}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("Not a file");
    const ext = path.extname(resolved);
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(await readFile(resolved));
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/analyze") {
      const force = url.searchParams.get("force") === "1";
      await sendJson(res, await makeSnapshot(force));
      return;
    }
    if (url.pathname === "/api/modules") {
      await sendJson(res, (await makeSnapshot(false)).modules || []);
      return;
    }
    if (url.pathname === "/api/statistics") {
      await sendJson(res, (await makeSnapshot(false)).statistics || {});
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    await sendJson(res, { error: String(error.message || error) }, 500);
  }
}).listen(port, () => {
  console.log(`Mooncakes contributor dashboard: http://localhost:${port}`);
  makeSnapshot(false).catch((error) => {
    console.error("Initial daily snapshot failed:", error.message || error);
  });
  setInterval(() => {
    makeSnapshot(false).catch((error) => {
      console.error("Scheduled daily snapshot failed:", error.message || error);
    });
  }, 60 * 60 * 1000);
});
