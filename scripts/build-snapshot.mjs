import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputFile = process.argv[2] || "public/data/latest.json";
const MOONCAKES_MODULES = "https://mooncakes.io/api/v0/modules";
const MOONCAKES_STATS = "https://mooncakes.io/api/v0/modules/statistics";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_CONCURRENCY = Number(process.env.GITHUB_CONCURRENCY || 8);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const AI_PORTRAIT_LIMIT = Number(process.env.AI_PORTRAIT_LIMIT || 80);
const AI_CONCURRENCY = Number(process.env.AI_CONCURRENCY || 3);

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

function dayKey(dateLike) {
  return String(dateLike || "").slice(0, 10);
}

function daysBetween(a, b) {
  return Math.max(0, Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000));
}

function truncate(value, max = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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

function buildAiPortraitTargets(modules, githubProfiles, snapshotDate) {
  const byOwner = new Map();
  for (const module of modules) {
    const owner = ownerOf(module.name);
    const created = dayKey(module.created_at);
    if (!byOwner.has(owner)) {
      byOwner.set(owner, {
        owner,
        first_seen: created,
        last_seen: created,
        module_count: 0,
        recent30_count: 0,
        modules: []
      });
    }
    const entry = byOwner.get(owner);
    entry.module_count += 1;
    entry.first_seen = created < entry.first_seen ? created : entry.first_seen;
    entry.last_seen = created > entry.last_seen ? created : entry.last_seen;
    if (daysBetween(created, snapshotDate) <= 30) entry.recent30_count += 1;
    entry.modules.push({
      name: module.name || "",
      version: module.version || "",
      created_at: module.created_at || "",
      license: module.license || "",
      repository: module.repository || "",
      keywords: (module.keywords || []).slice(0, 8),
      description: truncate(module.description, 240)
    });
  }

  return Array.from(byOwner.values())
    .filter((entry) => daysBetween(entry.first_seen, snapshotDate) <= 30)
    .sort((a, b) => b.first_seen.localeCompare(a.first_seen) || b.module_count - a.module_count || a.owner.localeCompare(b.owner))
    .slice(0, AI_PORTRAIT_LIMIT)
    .map((entry) => {
      const profile = githubProfiles[entry.owner] || null;
      return {
        owner: entry.owner,
        first_seen: entry.first_seen,
        last_seen: entry.last_seen,
        module_count: entry.module_count,
        recent30_count: entry.recent30_count,
        github_profile: profile && profile.exists !== false && !profile.error ? {
          login: profile.login || entry.owner,
          name: profile.name || "",
          type: profile.type || "",
          company: profile.company || "",
          location: profile.location || "",
          bio: truncate(profile.bio, 360),
          blog: profile.blog || "",
          public_repos: profile.public_repos || 0,
          followers: profile.followers || 0,
          following: profile.following || 0,
          created_at: profile.created_at || "",
          updated_at: profile.updated_at || ""
        } : null,
        modules: entry.modules
          .sort((a, b) => dayKey(b.created_at).localeCompare(dayKey(a.created_at)))
          .slice(0, 12)
      };
    });
}

function aiPortraitSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      identity_label: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      priority: { type: "string", enum: ["P0", "P1", "P2"] },
      summary: { type: "string" },
      evidence: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 5
      },
      risks: {
        type: "array",
        items: { type: "string" },
        maxItems: 4
      },
      suggested_action: { type: "string" },
      tags: {
        type: "array",
        items: { type: "string" },
        maxItems: 6
      }
    },
    required: ["identity_label", "confidence", "priority", "summary", "evidence", "risks", "suggested_action", "tags"]
  };
}

function extractResponseText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

async function fetchAiPortrait(target) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: [
              "你是 MoonBit 社区贡献者画像分析助手。",
              "只使用输入里的 GitHub 公开字段和 Mooncakes 模块元数据。",
              "不要猜测敏感属性，不要根据姓名推断国籍、性别、年龄、民族、政治或宗教。",
              "location/company/bio 没有明确证据时，必须降低 confidence，并在 evidence 或 risks 里说明信息不足。",
              "输出中文，简洁、可运营落地。"
            ].join("\n")
          }]
        },
        {
          role: "user",
          content: [{
            type: "input_text",
            text: JSON.stringify(target)
          }]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "mooncakes_contributor_portrait",
          strict: true,
          schema: aiPortraitSchema()
        }
      }
    })
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI returned ${response.status}: ${truncate(message, 300)}`);
  }
  const data = await response.json();
  const parsed = JSON.parse(extractResponseText(data));
  return {
    ...parsed,
    model: OPENAI_MODEL,
    generated_at: new Date().toISOString()
  };
}

async function buildAiPortraits(modules, githubProfiles, snapshotDate) {
  if (!OPENAI_API_KEY || AI_PORTRAIT_LIMIT <= 0) {
    return {
      portraits: {},
      meta: {
        enabled: false,
        reason: OPENAI_API_KEY ? "AI_PORTRAIT_LIMIT is 0" : "OPENAI_API_KEY not configured",
        model: OPENAI_MODEL,
        requested: 0,
        succeeded: 0,
        failed: 0
      }
    };
  }

  const targets = buildAiPortraitTargets(modules, githubProfiles, snapshotDate);
  let failed = 0;
  const portraits = {};
  await mapLimit(targets, AI_CONCURRENCY, async (target) => {
    try {
      portraits[target.owner] = await fetchAiPortrait(target);
    } catch (error) {
      failed += 1;
      portraits[target.owner] = {
        error: String(error.message || error),
        model: OPENAI_MODEL,
        generated_at: new Date().toISOString()
      };
    }
  });

  return {
    portraits,
    meta: {
      enabled: true,
      model: OPENAI_MODEL,
      requested: targets.length,
      succeeded: Object.values(portraits).filter((portrait) => !portrait.error).length,
      failed,
      limit: AI_PORTRAIT_LIMIT
    }
  };
}

async function main() {
  const [modules, statistics] = await Promise.all([
    fetchJson(MOONCAKES_MODULES),
    fetchJson(MOONCAKES_STATS)
  ]);
  const snapshotDate = todayInShanghai();

  const ownerCounts = new Map();
  for (const module of modules) {
    const owner = ownerOf(module.name);
    ownerCounts.set(owner, (ownerCounts.get(owner) || 0) + 1);
  }
  const owners = Array.from(ownerCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([owner]) => owner);

  let failed = 0;
  let notFound = 0;
  const githubProfiles = {};
  await mapLimit(owners, GITHUB_CONCURRENCY, async (owner) => {
    try {
      githubProfiles[owner] = await fetchGithubProfile(owner);
      if (githubProfiles[owner]?.exists === false) notFound += 1;
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
  const ai = await buildAiPortraits(modules, githubProfiles, snapshotDate);

  const snapshot = {
    date: snapshotDate,
    captured_at: new Date().toISOString(),
    source: {
      modules: MOONCAKES_MODULES,
      statistics: MOONCAKES_STATS,
      github_profiles: "https://api.github.com/users/{owner}",
      ai_portraits: OPENAI_API_KEY ? "https://api.openai.com/v1/responses" : null
    },
    modules,
    statistics,
    github_profiles: githubProfiles,
    ai_portraits: ai.portraits,
    ai_meta: ai.meta,
    github_meta: {
      total_owners: owners.length,
      profiles_available: Object.values(githubProfiles).filter((profile) => profile?.exists !== false && !profile?.error).length,
      fetched: Object.keys(githubProfiles).length,
      from_cache: 0,
      failed,
      not_found: notFound,
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
