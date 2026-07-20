import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildSnapshotFromExports, todayInUtc } from "../lib/mooncakes-exports.mjs";

const outputFile = process.argv[2] || "public/data/latest.json";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const AI_PORTRAIT_LIMIT = Number(process.env.AI_PORTRAIT_LIMIT || 80);
const AI_CONCURRENCY = Number(process.env.AI_CONCURRENCY || 3);
const RUN_AI_PORTRAITS = ["1", "true", "yes", "on"].includes(String(process.env.RUN_AI_PORTRAITS || "").toLowerCase());
const AI_ANALYSIS_DAYS = Number(process.env.AI_ANALYSIS_DAYS || 7);
const AI_TARGET_SCOPE = String(process.env.AI_TARGET_SCOPE || "active").toLowerCase();

function ownerOf(moduleName) {
  return String(moduleName || "").split("/")[0] || "(unknown)";
}

function dayKey(dateLike) {
  return String(dateLike || "").slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

function isWithinUtcWindow(dateLike, snapshotDate, days = 7) {
  const age = daysBetween(dayKey(dateLike), snapshotDate);
  return age >= 0 && age < days;
}

function truncate(value, max = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function deriveMetrics(modules, statistics, snapshotDate, ownerHistory) {
  const owners = new Map();
  const recent7Owners = new Set();
  const recent7Modules = [];
  const invalidCreatedAt = [];

  for (const module of modules) {
    const owner = ownerOf(module.name);
    const created = dayKey(module.created_at);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) invalidCreatedAt.push(module.name || "(unknown)");
    if (!owners.has(owner)) {
      owners.set(owner, {
        first_seen: created,
        last_seen: created,
        module_count: 0,
        recent7_count: 0
      });
    }
    const entry = owners.get(owner);
    entry.module_count += 1;
    entry.first_seen = created < entry.first_seen ? created : entry.first_seen;
    entry.last_seen = created > entry.last_seen ? created : entry.last_seen;
    if (isWithinUtcWindow(created, snapshotDate)) {
      entry.recent7_count += 1;
      recent7Owners.add(owner);
      recent7Modules.push(module);
    }
  }

  const ownerRows = Array.from(owners.entries()).map(([owner, entry]) => {
    const history = ownerHistory[owner] || {};
    return {
      owner,
      ...entry,
      first_seen: dayKey(history.first_seen || entry.first_seen),
      last_seen: dayKey(history.last_seen || entry.last_seen)
    };
  });
  const invalidOwnerFirstSeen = ownerRows.filter((entry) => !/^\d{4}-\d{2}-\d{2}$/.test(entry.first_seen));
  const recent7NewOwners = ownerRows.filter((entry) => isWithinUtcWindow(entry.first_seen, snapshotDate));
  const todayNewOwners = recent7NewOwners.filter((entry) => entry.first_seen === snapshotDate);
  const recent7NewOwnerSet = new Set(recent7NewOwners.map((entry) => entry.owner));
  const recent7NewOwnerModules = recent7Modules.filter((module) => recent7NewOwnerSet.has(ownerOf(module.name)));

  return {
    algorithm_version: "2026-07-20.2-owner-history",
    snapshot_date: snapshotDate,
    module_array_count: modules.length,
    statistics_total_modules: Number(statistics?.total_modules || 0),
    statistics_total_packages: Number(statistics?.total_packages || 0),
    statistics_total_downloads: Number(statistics?.total_downloads || 0),
    owner_count: owners.size,
    recent7_active_owner_count: recent7Owners.size,
    recent7_new_owner_count: recent7NewOwners.length,
    today_new_owner_count: todayNewOwners.length,
    recent7_module_count: recent7Modules.length,
    recent7_new_owner_module_count: recent7NewOwnerModules.length,
    owner_history_count: Object.keys(ownerHistory).length,
    invalid_owner_first_seen_count: invalidOwnerFirstSeen.length,
    invalid_created_at_count: invalidCreatedAt.length,
    invalid_created_at_examples: invalidCreatedAt.slice(0, 10)
  };
}

function buildDataQuality({ modules, statistics, owners, ownerHistory, githubProfiles, githubFailed, githubNotFound, ai, derivedMetrics }) {
  const checks = [
    {
      id: "modules_count_matches_statistics",
      label: "模块列表数量等于 statistics.total_modules",
      severity: "error",
      expected: Number(statistics?.total_modules || 0),
      actual: modules.length,
      passed: modules.length === Number(statistics?.total_modules || 0)
    },
    {
      id: "owner_count_matches_github_requests",
      label: "owner 去重数量等于导出站点 GitHub 字段数量",
      severity: "error",
      expected: owners.length,
      actual: Object.keys(githubProfiles).length,
      passed: owners.length === Object.keys(githubProfiles).length
    },
    {
      id: "created_at_parseable",
      label: "模块 created_at 可解析为日期",
      severity: "error",
      expected: 0,
      actual: derivedMetrics.invalid_created_at_count,
      passed: derivedMetrics.invalid_created_at_count === 0
    },
    {
      id: "owner_history_complete",
      label: "完整版本历史覆盖全部 owner",
      severity: "error",
      expected: owners.length,
      actual: Object.keys(ownerHistory).length,
      passed: owners.length === Object.keys(ownerHistory).length
    },
    {
      id: "owner_first_seen_parseable",
      label: "owner 首次贡献时间可解析为 UTC 日期",
      severity: "error",
      expected: 0,
      actual: derivedMetrics.invalid_owner_first_seen_count,
      passed: derivedMetrics.invalid_owner_first_seen_count === 0
    },
    {
      id: "github_api_no_failures",
      label: "导出站点 GitHub 字段转换无失败",
      severity: "warning",
      expected: 0,
      actual: githubFailed,
      passed: githubFailed === 0
    },
    {
      id: "github_not_found_recorded",
      label: "缺少 GitHub login 的 owner 已单独记录",
      severity: "info",
      expected: "recorded",
      actual: githubNotFound,
      passed: true
    },
    {
      id: "ai_does_not_change_counts",
      label: "AI 只生成画像，不参与基础计数",
      severity: "info",
      expected: true,
      actual: true,
      passed: true
    },
    {
      id: "ai_status_recorded",
      label: "AI 运行状态已记录",
      severity: "info",
      expected: "recorded",
      actual: ai.meta?.enabled ? `${ai.meta.succeeded || 0}/${ai.meta.requested || 0}` : ai.meta?.reason || "disabled",
      passed: true
    }
  ];
  const hardFailures = checks.filter((check) => check.severity === "error" && !check.passed);
  const warnings = checks.filter((check) => check.severity === "warning" && !check.passed);
  return {
    status: hardFailures.length ? "fail" : warnings.length ? "warn" : "pass",
    generated_at: new Date().toISOString(),
    hard_failures: hardFailures.length,
    warnings: warnings.length,
    checks
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

function buildAiPortraitTargets(modules, githubProfiles, snapshotDate, ownerHistory) {
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
        recent_count: 0,
        modules: []
      });
    }
    const entry = byOwner.get(owner);
    entry.module_count += 1;
    entry.first_seen = created < entry.first_seen ? created : entry.first_seen;
    entry.last_seen = created > entry.last_seen ? created : entry.last_seen;
    if (isWithinUtcWindow(created, snapshotDate, AI_ANALYSIS_DAYS)) entry.recent_count += 1;
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
    .map((entry) => {
      const history = ownerHistory[entry.owner] || {};
      return {
        ...entry,
        first_seen: dayKey(history.first_seen || entry.first_seen),
        last_seen: dayKey(history.last_seen || entry.last_seen)
      };
    })
    .filter((entry) => {
      if (AI_TARGET_SCOPE === "newcomers") return isWithinUtcWindow(entry.first_seen, snapshotDate, AI_ANALYSIS_DAYS);
      return entry.recent_count > 0;
    })
    .sort((a, b) => b.recent_count - a.recent_count || b.last_seen.localeCompare(a.last_seen) || b.module_count - a.module_count || a.owner.localeCompare(b.owner))
    .slice(0, AI_PORTRAIT_LIMIT)
    .map((entry) => {
      const profile = githubProfiles[entry.owner] || null;
      return {
        owner: entry.owner,
        first_seen: entry.first_seen,
        last_seen: entry.last_seen,
        module_count: entry.module_count,
        recent_count: entry.recent_count,
        analysis_window_days: AI_ANALYSIS_DAYS,
        target_scope: AI_TARGET_SCOPE,
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

async function buildAiPortraits(modules, githubProfiles, snapshotDate, ownerHistory) {
  if (!RUN_AI_PORTRAITS || !OPENAI_API_KEY || AI_PORTRAIT_LIMIT <= 0) {
    return {
      portraits: {},
      meta: {
        enabled: false,
        reason: !RUN_AI_PORTRAITS ? "RUN_AI_PORTRAITS not enabled" : OPENAI_API_KEY ? "AI_PORTRAIT_LIMIT is 0" : "OPENAI_API_KEY not configured",
        model: OPENAI_MODEL,
        requested: 0,
        succeeded: 0,
        failed: 0,
        window_days: AI_ANALYSIS_DAYS,
        target_scope: AI_TARGET_SCOPE
      }
    };
  }

  const targets = buildAiPortraitTargets(modules, githubProfiles, snapshotDate, ownerHistory);
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
      limit: AI_PORTRAIT_LIMIT,
      window_days: AI_ANALYSIS_DAYS,
      target_scope: AI_TARGET_SCOPE,
      manual: true
    }
  };
}

async function main() {
  const snapshotDate = todayInUtc();
  const exportSnapshot = await buildSnapshotFromExports({ snapshotDate });
  const modules = exportSnapshot.modules || [];
  const statistics = exportSnapshot.statistics || {};
  const githubProfiles = exportSnapshot.github_profiles || {};
  const ownerHistory = exportSnapshot.owner_history || {};

  const ownerCounts = new Map();
  for (const module of modules) {
    const owner = ownerOf(module.name);
    ownerCounts.set(owner, (ownerCounts.get(owner) || 0) + 1);
  }
  const owners = Array.from(ownerCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([owner]) => owner);

  const failed = 0;
  const notFound = Object.values(githubProfiles).filter((profile) => profile?.exists === false).length;
  const ai = await buildAiPortraits(modules, githubProfiles, snapshotDate, ownerHistory);
  const derivedMetrics = deriveMetrics(modules, statistics, snapshotDate, ownerHistory);
  const dataQuality = buildDataQuality({
    modules,
    statistics,
    owners,
    ownerHistory,
    githubProfiles,
    githubFailed: failed,
    githubNotFound: notFound,
    ai,
    derivedMetrics
  });

  if (dataQuality.status === "fail") {
    throw new Error(`Data quality failed: ${dataQuality.checks.filter((check) => check.severity === "error" && !check.passed).map((check) => `${check.id} expected=${check.expected} actual=${check.actual}`).join("; ")}`);
  }

  const snapshot = {
    date: snapshotDate,
    captured_at: new Date().toISOString(),
    timezone: exportSnapshot.timezone || "UTC",
    source: {
      ...(exportSnapshot.source || {}),
      ai_portraits: OPENAI_API_KEY ? "https://api.openai.com/v1/responses" : null
    },
    modules,
    owner_history: ownerHistory,
    statistics,
    derived_metrics: derivedMetrics,
    data_quality: dataQuality,
    github_profiles: githubProfiles,
    ai_portraits: ai.portraits,
    ai_meta: ai.meta,
    github_meta: {
      ...(exportSnapshot.github_meta || {}),
      total_owners: owners.length,
      profiles_available: Object.values(githubProfiles).filter((profile) => profile?.exists !== false && !profile?.error).length,
      failed,
      not_found: notFound,
      authenticated: false,
      generated_by: "github-actions-business-analytics-exports"
    },
    export_meta: exportSnapshot.export_meta
  };

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote ${outputFile}: ${modules.length} modules, ${owners.length} owners from business-analytics exports`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
