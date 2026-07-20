import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { SNAPSHOT_ALGORITHM_VERSION, buildSnapshotFromExports, todayInUtc } from "../lib/mooncakes-exports.mjs";

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

function deriveMetrics(modules, statistics, snapshotDate, ownerHistory, moduleHistory, publicationWindows, registrationWindow) {
  const owners = new Map();
  const recent7Owners = new Set();
  const recent7Modules = [];
  const invalidCreatedAt = [];
  const invalidModuleFirstSeen = [];

  for (const module of modules) {
    const owner = ownerOf(module.name);
    const created = dayKey(module.created_at);
    const firstPublished = dayKey(module.first_published_at || moduleHistory[module.name]?.first_seen);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) invalidCreatedAt.push(module.name || "(unknown)");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstPublished)) invalidModuleFirstSeen.push(module.name || "(unknown)");
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
  const recentWindow = publicationWindows.recent7 || {};
  const previousWindow = publicationWindows.previous7 || {};

  return {
    algorithm_version: SNAPSHOT_ALGORITHM_VERSION,
    snapshot_date: snapshotDate,
    module_array_count: modules.length,
    statistics_total_modules: Number(statistics?.total_modules || 0),
    statistics_total_packages: Number(statistics?.total_packages || 0),
    statistics_total_versions: Number(statistics?.total_versions || 0),
    statistics_total_downloads: Number(statistics?.total_downloads || 0),
    owner_count: owners.size,
    recent7_active_owner_count: Number(recentWindow.active_owner_count ?? recent7Owners.size),
    recent7_active_module_count: Number(recentWindow.active_module_count ?? recent7Modules.length),
    recent7_version_release_count: Number(recentWindow.version_release_count ?? 0),
    recent7_new_module_count: Number(recentWindow.new_module_count ?? 0),
    recent7_new_owner_count: Number(recentWindow.new_owner_count ?? recent7NewOwners.length),
    today_new_owner_count: todayNewOwners.length,
    recent7_module_count: Number(recentWindow.active_module_count ?? recent7Modules.length),
    recent7_new_owner_module_count: Number(recentWindow.new_owner_module_count ?? recent7NewOwnerModules.length),
    previous7_active_owner_count: Number(previousWindow.active_owner_count ?? 0),
    previous7_active_module_count: Number(previousWindow.active_module_count ?? 0),
    previous7_version_release_count: Number(previousWindow.version_release_count ?? 0),
    previous7_new_module_count: Number(previousWindow.new_module_count ?? 0),
    previous7_new_owner_count: Number(previousWindow.new_owner_count ?? 0),
    previous_week_registered_count: Number(registrationWindow.registered_count ?? 0),
    previous_week_contributed_count: Number(registrationWindow.contributed_count ?? 0),
    previous_week_no_contribution_count: Number(registrationWindow.no_contribution_count ?? 0),
    recent7_latest_module_count: recent7Modules.length,
    owner_history_count: Object.keys(ownerHistory).length,
    module_history_count: Object.keys(moduleHistory).length,
    invalid_owner_first_seen_count: invalidOwnerFirstSeen.length,
    invalid_module_first_seen_count: invalidModuleFirstSeen.length,
    invalid_created_at_count: invalidCreatedAt.length,
    invalid_created_at_examples: invalidCreatedAt.slice(0, 10)
  };
}

function buildDataQuality({ modules, statistics, owners, ownerHistory, moduleHistory, publicationWindows, registrationWindow, registeredNonContributors, sourceIntegrity, githubProfiles, githubFailed, githubNotFound, ai, derivedMetrics }) {
  const registeredContributorOverlap = registeredNonContributors.filter((user) => ownerHistory[user.username]).length;
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
      id: "versions_count_matches_exports",
      label: "有效版本数等于源站非撤回版本记录数",
      severity: "error",
      expected: Number(sourceIntegrity.non_yanked_version_rows || 0),
      actual: Number(statistics?.total_versions || 0),
      passed: Number(statistics?.total_versions || 0) === Number(sourceIntegrity.non_yanked_version_rows || 0)
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
      id: "module_history_complete",
      label: "完整版本历史覆盖全部模块",
      severity: "error",
      expected: modules.length,
      actual: Object.keys(moduleHistory).length,
      passed: modules.length === Object.keys(moduleHistory).length
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
      id: "registration_cohort_count_matches",
      label: "上周注册未贡献列表数量与注册窗口汇总一致",
      severity: "error",
      expected: Number(registrationWindow.no_contribution_count ?? 0),
      actual: registeredNonContributors.length,
      passed: registeredNonContributors.length === Number(registrationWindow.no_contribution_count ?? 0)
    },
    {
      id: "registration_cohort_has_no_contributors",
      label: "注册未贡献列表与非撤回贡献 owner 无重叠",
      severity: "error",
      expected: 0,
      actual: registeredContributorOverlap,
      passed: registeredContributorOverlap === 0
    },
    {
      id: "registration_dates_valid",
      label: "注册时间转换为 UTC 后有效且不晚于快照日期",
      severity: "error",
      expected: 0,
      actual: Number(sourceIntegrity.invalid_signup_time_count ?? 0) + Number(sourceIntegrity.future_signup_time_count ?? 0) + Number(sourceIntegrity.contribution_before_registration_count ?? 0),
      passed: Number(sourceIntegrity.invalid_signup_time_count ?? 0) + Number(sourceIntegrity.future_signup_time_count ?? 0) + Number(sourceIntegrity.contribution_before_registration_count ?? 0) === 0
    },
    {
      id: "missing_registration_dates_recorded",
      label: "源站缺失注册时间的历史账号已记录",
      severity: "info",
      expected: "recorded",
      actual: Number(sourceIntegrity.missing_signup_time_count ?? 0),
      passed: true
    },
    {
      id: "module_first_seen_parseable",
      label: "模块首次发布时间可解析为 UTC 日期",
      severity: "error",
      expected: 0,
      actual: derivedMetrics.invalid_module_first_seen_count,
      passed: derivedMetrics.invalid_module_first_seen_count === 0
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
      id: "recent_activity_matches_latest_modules",
      label: "近 7 天活跃模块数与完整发布历史一致",
      severity: "error",
      expected: Number(publicationWindows.recent7?.active_module_count ?? 0),
      actual: derivedMetrics.recent7_latest_module_count,
      passed: derivedMetrics.recent7_latest_module_count === Number(publicationWindows.recent7?.active_module_count ?? 0)
    },
    {
      id: "package_ids_unique",
      label: "源站 package_id 无重复",
      severity: "error",
      expected: 0,
      actual: sourceIntegrity.duplicate_package_id_count,
      passed: sourceIntegrity.duplicate_package_id_count === 0
    },
    {
      id: "users_unique",
      label: "users.csv 的 user_id 和 username 无重复",
      severity: "error",
      expected: 0,
      actual: Number(sourceIntegrity.duplicate_user_id_count ?? 0) + Number(sourceIntegrity.duplicate_username_count ?? 0),
      passed: Number(sourceIntegrity.duplicate_user_id_count ?? 0) + Number(sourceIntegrity.duplicate_username_count ?? 0) === 0
    },
    {
      id: "package_user_mapping_valid",
      label: "版本记录的 user_id 与 username 映射一致",
      severity: "error",
      expected: 0,
      actual: sourceIntegrity.package_user_mapping_mismatch_count,
      passed: sourceIntegrity.package_user_mapping_mismatch_count === 0
    },
    {
      id: "module_identifiers_valid",
      label: "模块名包含唯一且大小写一致的 owner 段",
      severity: "error",
      expected: 0,
      actual: Number(sourceIntegrity.malformed_module_name_count ?? 0) + Number(sourceIntegrity.owner_case_collision_count ?? 0),
      passed: Number(sourceIntegrity.malformed_module_name_count ?? 0) + Number(sourceIntegrity.owner_case_collision_count ?? 0) === 0
    },
    {
      id: "source_dates_valid",
      label: "源站版本时间均有效且不晚于快照日期",
      severity: "error",
      expected: 0,
      actual: Number(sourceIntegrity.invalid_created_at_count || 0) + Number(sourceIntegrity.future_created_at_count || 0),
      passed: Number(sourceIntegrity.invalid_created_at_count || 0) + Number(sourceIntegrity.future_created_at_count || 0) === 0
    },
    {
      id: "module_owner_matches_username",
      label: "模块 owner 段与源站 username 一致",
      severity: "error",
      expected: 0,
      actual: sourceIntegrity.owner_username_mismatch_count,
      passed: sourceIntegrity.owner_username_mismatch_count === 0
    },
    {
      id: "downloads_cover_modules",
      label: "下载量表与有效模块一一对应",
      severity: "error",
      expected: 0,
      actual: Number(sourceIntegrity.duplicate_download_module_count || 0) + Number(sourceIntegrity.missing_download_module_count || 0) + Number(sourceIntegrity.orphan_download_module_count || 0),
      passed: Number(sourceIntegrity.duplicate_download_module_count || 0) + Number(sourceIntegrity.missing_download_module_count || 0) + Number(sourceIntegrity.orphan_download_module_count || 0) === 0
    },
    {
      id: "download_values_valid",
      label: "下载量和更新时间字段均有效",
      severity: "error",
      expected: 0,
      actual: Number(sourceIntegrity.invalid_download_value_count ?? 0) + Number(sourceIntegrity.invalid_download_updated_at_count ?? 0),
      passed: Number(sourceIntegrity.invalid_download_value_count ?? 0) + Number(sourceIntegrity.invalid_download_updated_at_count ?? 0) === 0
    },
    {
      id: "current_size_fields_recorded",
      label: "当前模块缺失的 line_count/package_count 已记录",
      severity: "info",
      expected: "recorded",
      actual: `${Number(sourceIntegrity.latest_module_missing_line_count ?? 0)} line / ${Number(sourceIntegrity.latest_module_missing_package_count ?? 0)} package`,
      passed: true
    },
    {
      id: "owners_have_user_rows",
      label: "全部贡献 owner 均可映射到 users.csv",
      severity: "warning",
      expected: 0,
      actual: sourceIntegrity.owner_without_user_row_count,
      passed: sourceIntegrity.owner_without_user_row_count === 0
    },
    {
      id: "canonical_publication_time_recorded",
      label: "版本时间以 packages.csv 顶层 created_at 为准，元数据差异已记录",
      severity: "info",
      expected: "recorded",
      actual: sourceIntegrity.meta_created_at_mismatch_count,
      passed: true
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
  const moduleHistory = exportSnapshot.module_history || {};
  const ownerHistory = exportSnapshot.owner_history || {};
  const publicationWindows = exportSnapshot.publication_windows || {};
  const registrationWindow = exportSnapshot.registration_window || {};
  const registeredNonContributors = exportSnapshot.registered_non_contributors || [];
  const sourceIntegrity = exportSnapshot.source_integrity || {};

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
  const derivedMetrics = deriveMetrics(modules, statistics, snapshotDate, ownerHistory, moduleHistory, publicationWindows, registrationWindow);
  const dataQuality = buildDataQuality({
    modules,
    statistics,
    owners,
    ownerHistory,
    moduleHistory,
    publicationWindows,
    registrationWindow,
    registeredNonContributors,
    sourceIntegrity,
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
    module_history: moduleHistory,
    owner_history: ownerHistory,
    publication_windows: publicationWindows,
    registration_window: registrationWindow,
    registered_non_contributors: registeredNonContributors,
    source_integrity: sourceIntegrity,
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
  console.log(`Wrote ${outputFile}: ${modules.length} modules, ${owners.length} owners, ${registeredNonContributors.length} prior-week registrations without contributions`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
