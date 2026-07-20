import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSnapshotFromExports, exportsBaseUrl, todayInShanghai } from "./lib/mooncakes-exports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const snapshotDir = path.join(__dirname, "data", "snapshots");
const port = Number(process.env.PORT || 4177);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function isCurrentExportSnapshot(snapshot) {
  return snapshot?.source?.exports_base_url === exportsBaseUrl();
}

async function makeSnapshot(force = false) {
  await mkdir(snapshotDir, { recursive: true });
  const date = todayInShanghai();
  const file = path.join(snapshotDir, `${date}.json`);

  if (!force) {
    try {
      const cached = JSON.parse(await readFile(file, "utf8"));
      if (isCurrentExportSnapshot(cached)) return { ...cached, cached: true };
    } catch {
      // No daily snapshot yet.
    }
  }

  const snapshot = await buildSnapshotFromExports({ snapshotDate: date });
  await writeFile(file, JSON.stringify(snapshot, null, 2));
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
  const resolved = path.normalize(path.join(publicDir, pathname));
  if (!resolved.startsWith(publicDir)) {
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
  console.log(`Data source: ${exportsBaseUrl()}`);
  makeSnapshot(false).catch((error) => {
    console.error("Initial daily snapshot failed:", error.message || error);
  });
  setInterval(() => {
    makeSnapshot(false).catch((error) => {
      console.error("Scheduled daily snapshot failed:", error.message || error);
    });
  }, 60 * 60 * 1000);
});
