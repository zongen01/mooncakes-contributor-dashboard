import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const snapshotDir = path.join(__dirname, "data", "snapshots");
const profileDir = path.join(__dirname, "data", "github-profiles");
const port = Number(process.env.PORT || 4177);
const MOONCAKES_MODULES = "https://mooncakes.io/api/v0/modules";
const MOONCAKES_STATS = "https://mooncakes.io/api/v0/modules/statistics";
const GITHUB_CACHE_DAYS = Number(process.env.GITHUB_CACHE_DAYS || 7);
const GITHUB_UNAUTH_FETCH_LIMIT = Number(process.env.GITHUB_UNAUTH_FETCH_LIMIT || 55);

function resolveGithubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000
    }).trim();
  } catch {
    return "";
  }
}

const GITHUB_TOKEN = resolveGithubToken();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "mooncakes-contributor-dashboard/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json();
}

function ownerOf(moduleName) {
  return String(moduleName || "").split("/")[0] || "(unknown)";
}

function safeProfileName(login) {
  return encodeURIComponent(login).replaceAll("%", "_");
}

function profilePath(login) {
  return path.join(profileDir, `${safeProfileName(login)}.json`);
}

function profileAgeDays(profile) {
  if (!profile || !profile.fetched_at) return Infinity;
  return (Date.now() - new Date(profile.fetched_at).getTime()) / 86400000;
}

async function readCachedProfile(login) {
  try {
    return JSON.parse(await readFile(profilePath(login), "utf8"));
  } catch {
    return null;
  }
}

async function fetchGithubProfile(login) {
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "mooncakes-contributor-dashboard/1.0",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  const response = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers });
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (response.status === 404) {
    return {
      login,
      exists: false,
      fetched_at: new Date().toISOString(),
      rate_remaining: remaining === null ? null : Number(remaining)
    };
  }
  if (!response.ok) {
    const message = response.status === 403 ? "GitHub API rate limit reached" : `GitHub returned ${response.status}`;
    throw new Error(message);
  }
  const data = await response.json();
  return {
    login: data.login || login,
    name: data.name || "",
    type: data.type || "",
    company: data.company || "",
    blog: data.blog || "",
    location: data.location || "",
    email_public: Boolean(data.email),
    bio: data.bio || "",
    twitter_username: data.twitter_username || "",
    public_repos: data.public_repos || 0,
    followers: data.followers || 0,
    following: data.following || 0,
    created_at: data.created_at || "",
    updated_at: data.updated_at || "",
    html_url: data.html_url || `https://github.com/${login}`,
    avatar_url: data.avatar_url || "",
    exists: true,
    fetched_at: new Date().toISOString(),
    rate_remaining: remaining === null ? null : Number(remaining)
  };
}

async function enrichGithubProfiles(modules, force = false) {
  await mkdir(profileDir, { recursive: true });
  const byOwner = new Map();
  for (const module of modules) {
    const owner = ownerOf(module.name);
    byOwner.set(owner, (byOwner.get(owner) || 0) + 1);
  }
  const owners = Array.from(byOwner.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([owner]) => owner);

  const profiles = {};
  let fetched = 0;
  let fromCache = 0;
  let failed = 0;
  let limitHit = false;
  let stopFetching = false;
  const maxFetch = GITHUB_TOKEN ? owners.length : GITHUB_UNAUTH_FETCH_LIMIT;

  for (const owner of owners) {
    const cached = await readCachedProfile(owner);
    const freshEnough = cached && profileAgeDays(cached) <= GITHUB_CACHE_DAYS;
    if (!force && freshEnough) {
      profiles[owner] = cached;
      fromCache += 1;
      continue;
    }
    if (stopFetching || (!GITHUB_TOKEN && fetched >= maxFetch)) {
      if (cached) {
        profiles[owner] = cached;
        fromCache += 1;
      }
      limitHit = true;
      continue;
    }
    try {
      const profile = await fetchGithubProfile(owner);
      profiles[owner] = profile;
      await writeFile(profilePath(owner), JSON.stringify(profile, null, 2));
      fetched += 1;
      if (profile.rate_remaining === 0) {
        limitHit = true;
        stopFetching = true;
      }
      if (!GITHUB_TOKEN && profile.rate_remaining !== null && profile.rate_remaining <= 2) {
        limitHit = true;
        stopFetching = true;
      }
    } catch (error) {
      failed += 1;
      if (cached) {
        profiles[owner] = cached;
        fromCache += 1;
      }
      if (String(error.message || error).includes("rate limit")) {
        limitHit = true;
        stopFetching = true;
      }
    }
  }

  return {
    profiles,
    meta: {
      total_owners: owners.length,
      profiles_available: Object.keys(profiles).length,
      fetched,
      from_cache: fromCache,
      failed,
      limit_hit: limitHit,
      authenticated: Boolean(GITHUB_TOKEN),
      cache_days: GITHUB_CACHE_DAYS,
      unauth_fetch_limit: GITHUB_UNAUTH_FETCH_LIMIT
    }
  };
}

async function makeSnapshot(force = false) {
  await mkdir(snapshotDir, { recursive: true });
  const date = todayInShanghai();
  const file = path.join(snapshotDir, `${date}.json`);

  if (!force) {
    try {
      const cached = JSON.parse(await readFile(file, "utf8"));
      const ownerCount = Array.isArray(cached.modules) ? new Set(cached.modules.map((module) => ownerOf(module.name))).size : 0;
      const profileCount = cached.github_meta?.profiles_available || Object.keys(cached.github_profiles || {}).length;
      const shouldUpgradeGithub = Array.isArray(cached.modules) && (!cached.github_profiles || (GITHUB_TOKEN && profileCount < ownerCount));
      if (shouldUpgradeGithub) {
        const github = await enrichGithubProfiles(cached.modules, false);
        const upgraded = {
          ...cached,
          source: {
            ...(cached.source || {}),
            github_profiles: "https://api.github.com/users/{owner}"
          },
          github_profiles: github.profiles,
          github_meta: github.meta
        };
        await writeFile(file, JSON.stringify(upgraded, null, 2));
        return { ...upgraded, cached: true };
      }
      return { ...cached, cached: true };
    } catch {
      // No daily snapshot yet.
    }
  }

  const [modules, statistics] = await Promise.all([
    fetchJson(MOONCAKES_MODULES),
    fetchJson(MOONCAKES_STATS)
  ]);
  const github = await enrichGithubProfiles(modules, force);
  const snapshot = {
    date,
    captured_at: new Date().toISOString(),
    source: {
      modules: MOONCAKES_MODULES,
      statistics: MOONCAKES_STATS,
      github_profiles: "https://api.github.com/users/{owner}"
    },
    modules,
    statistics,
    github_profiles: github.profiles,
    github_meta: github.meta
  };
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
      await sendJson(res, await fetchJson(MOONCAKES_MODULES));
      return;
    }
    if (url.pathname === "/api/statistics") {
      await sendJson(res, await fetchJson(MOONCAKES_STATS));
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
