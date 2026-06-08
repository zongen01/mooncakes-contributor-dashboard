import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputFile = process.argv[2] || "public/data/latest.json";
const MOONCAKES_MODULES = "https://mooncakes.io/api/v0/modules";
const MOONCAKES_STATS = "https://mooncakes.io/api/v0/modules/statistics";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_CONCURRENCY = Number(process.env.GITHUB_CONCURRENCY || 8);

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

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "mooncakes-contributor-dashboard/1.0",
      ...headers
    }
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

function ownerOf(moduleName) {
  return String(moduleName || "").split("/")[0] || "(unknown)";
}

async function fetchGithubProfile(login) {
  const headers = {
    "Accept": "application/vnd.github+json",
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
  if (!response.ok) throw new Error(`GitHub ${login} returned ${response.status}`);
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

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const [modules, statistics] = await Promise.all([
    fetchJson(MOONCAKES_MODULES),
    fetchJson(MOONCAKES_STATS)
  ]);

  const ownerCounts = new Map();
  for (const module of modules) {
    const owner = ownerOf(module.name);
    ownerCounts.set(owner, (ownerCounts.get(owner) || 0) + 1);
  }
  const owners = Array.from(ownerCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([owner]) => owner);

  let failed = 0;
  const githubProfiles = {};
  await mapLimit(owners, GITHUB_CONCURRENCY, async (owner) => {
    try {
      githubProfiles[owner] = await fetchGithubProfile(owner);
    } catch (error) {
      failed += 1;
      githubProfiles[owner] = {
        login: owner,
        exists: false,
        error: String(error.message || error),
        fetched_at: new Date().toISOString()
      };
    }
  });

  const snapshot = {
    date: todayInShanghai(),
    captured_at: new Date().toISOString(),
    source: {
      modules: MOONCAKES_MODULES,
      statistics: MOONCAKES_STATS,
      github_profiles: "https://api.github.com/users/{owner}"
    },
    modules,
    statistics,
    github_profiles: githubProfiles,
    github_meta: {
      total_owners: owners.length,
      profiles_available: Object.keys(githubProfiles).length,
      fetched: Object.keys(githubProfiles).length,
      from_cache: 0,
      failed,
      limit_hit: false,
      authenticated: Boolean(GITHUB_TOKEN),
      generated_by: "github-actions"
    }
  };

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote ${outputFile}: ${modules.length} modules, ${owners.length} owners, ${failed} GitHub failures`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
