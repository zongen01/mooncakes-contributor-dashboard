const DEFAULT_EXPORTS_BASE_URL = "http://192.168.86.2:18080";
const SOURCE_SIGNUP_TIMEZONE = "Asia/Shanghai";
const SOURCE_SIGNUP_OFFSET = "+08:00";
export const SNAPSHOT_ALGORITHM_VERSION = "2026-07-20.4-registration-cohort";

export function todayInUtc() {
  return new Date().toISOString().slice(0, 10);
}

export function exportsBaseUrl() {
  return String(
    process.env.MOONCAKES_EXPORTS_BASE_URL ||
      process.env.BUSINESS_ANALYTICS_EXPORTS_BASE_URL ||
      DEFAULT_EXPORTS_BASE_URL
  ).replace(/\/+$/, "");
}

function exportUrl(pathname, baseUrl = exportsBaseUrl()) {
  return new URL(pathname, `${baseUrl}/`).toString();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/csv,application/json;q=0.9,*/*;q=0.8",
      "User-Agent": "mooncakes-contributor-dashboard/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.text();
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header = [], ...body] = rows;
  return body
    .filter((values) => values.some((value) => String(value || "").trim()))
    .map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] || ""])));
}

async function fetchCsvRows(pathname, baseUrl) {
  return parseCsv(await fetchText(exportUrl(pathname, baseUrl)));
}

function parseInteger(value) {
  const number = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function parseBoolean(value) {
  return ["1", "t", "true", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function parseMetaJson(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function ownerOf(moduleName) {
  return String(moduleName || "").split("/")[0] || "(unknown)";
}

function normalizeDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalizedText = text.replace(" ", "T");
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalizedText) ? normalizedText : `${normalizedText}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
}

function normalizeSignupDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalizedText = text.replace(" ", "T");
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalizedText)
    ? normalizedText
    : `${normalizedText}${SOURCE_SIGNUP_OFFSET}`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? normalized : parsed.toISOString();
}

function dayKey(value) {
  return normalizeDateTime(value).slice(0, 10);
}

function daysBetween(left, right) {
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86400000);
}

function utcDateOffset(date, offset) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

function previousUtcCalendarWeek(snapshotDate) {
  const current = new Date(`${snapshotDate}T00:00:00Z`);
  const weekday = current.getUTCDay() || 7;
  const thisMonday = utcDateOffset(snapshotDate, -(weekday - 1));
  return {
    from: utcDateOffset(thisMonday, -7),
    to: utcDateOffset(thisMonday, -1)
  };
}

function publicationTimestamp(row) {
  const rowTimestamp = normalizeDateTime(row.created_at);
  if (rowTimestamp && Number.isFinite(Date.parse(rowTimestamp))) return rowTimestamp;
  return normalizeDateTime(parseMetaJson(row.meta_json).created_at);
}

function normalizeRepository(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^github\.com\//i.test(text)) return `https://${text}`;
  return text;
}

function latestPackageRow(left, right) {
  const leftTime = Date.parse(normalizeDateTime(left.created_at));
  const rightTime = Date.parse(normalizeDateTime(right.created_at));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime > leftTime ? right : left;
  }

  const leftId = parseInteger(left.package_id);
  const rightId = parseInteger(right.package_id);
  return rightId >= leftId ? right : left;
}

function buildLatestPackageRows(packageRows) {
  const latestByModule = new Map();
  for (const row of packageRows) {
    if (parseBoolean(row.yanked)) continue;
    const moduleName = String(row.module_name || "").trim();
    if (!moduleName) continue;
    const previous = latestByModule.get(moduleName);
    latestByModule.set(moduleName, previous ? latestPackageRow(previous, row) : row);
  }
  return Array.from(latestByModule.values()).sort((left, right) =>
    String(left.module_name || "").localeCompare(String(right.module_name || ""))
  );
}

function buildPublicationHistory(packageRows, snapshotDate) {
  const modules = new Map();
  const owners = new Map();
  const events = [];
  const packageIds = new Set();
  const duplicatePackageIds = new Set();
  const invalidCreatedAt = [];
  const futureCreatedAt = [];
  const ownerUsernameMismatches = [];
  const metaCreatedAtMismatches = [];
  let yankedVersionRows = 0;

  for (const row of packageRows) {
    const packageId = String(row.package_id || "");
    if (packageIds.has(packageId)) duplicatePackageIds.add(packageId);
    packageIds.add(packageId);
    if (parseBoolean(row.yanked)) {
      yankedVersionRows += 1;
      continue;
    }

    const moduleName = String(row.module_name || "").trim();
    if (!moduleName) continue;
    const owner = ownerOf(moduleName);
    const createdAt = publicationTimestamp(row);
    if (!createdAt || !Number.isFinite(Date.parse(createdAt))) {
      invalidCreatedAt.push(moduleName);
      continue;
    }
    if (dayKey(createdAt) > snapshotDate) futureCreatedAt.push(moduleName);
    if (row.username && String(row.username) !== owner) ownerUsernameMismatches.push(moduleName);

    const metaCreatedAt = normalizeDateTime(parseMetaJson(row.meta_json).created_at);
    const rowCreatedAt = normalizeDateTime(row.created_at);
    if (rowCreatedAt && metaCreatedAt && rowCreatedAt !== metaCreatedAt) metaCreatedAtMismatches.push(moduleName);

    events.push({ module: moduleName, owner, created_at: createdAt });
    if (!modules.has(moduleName)) {
      modules.set(moduleName, { owner, first_seen: createdAt, last_seen: createdAt, version_count: 0, release_days: new Map() });
    }
    const moduleEntry = modules.get(moduleName);
    if (Date.parse(createdAt) < Date.parse(moduleEntry.first_seen)) moduleEntry.first_seen = createdAt;
    if (Date.parse(createdAt) > Date.parse(moduleEntry.last_seen)) moduleEntry.last_seen = createdAt;
    moduleEntry.version_count += 1;
    const releaseDay = dayKey(createdAt);
    moduleEntry.release_days.set(releaseDay, (moduleEntry.release_days.get(releaseDay) || 0) + 1);

    if (!owners.has(owner)) {
      owners.set(owner, { first_seen: createdAt, last_seen: createdAt, version_count: 0, modules: new Set() });
    }
    const ownerEntry = owners.get(owner);
    if (Date.parse(createdAt) < Date.parse(ownerEntry.first_seen)) ownerEntry.first_seen = createdAt;
    if (Date.parse(createdAt) > Date.parse(ownerEntry.last_seen)) ownerEntry.last_seen = createdAt;
    ownerEntry.version_count += 1;
    ownerEntry.modules.add(moduleName);
  }

  const moduleHistory = Object.fromEntries(
    Array.from(modules.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, entry]) => [name, {
        owner: entry.owner,
        first_seen: entry.first_seen,
        last_seen: entry.last_seen,
        version_count: entry.version_count,
        release_days: Object.fromEntries(Array.from(entry.release_days.entries()).sort(([left], [right]) => left.localeCompare(right)))
      }])
  );
  const ownerHistory = Object.fromEntries(
    Array.from(owners.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([owner, entry]) => [owner, {
        first_seen: entry.first_seen,
        last_seen: entry.last_seen,
        version_count: entry.version_count,
        module_count: entry.modules.size
      }])
  );

  function summarizeWindow(minAge, maxAge) {
    const windowEvents = events.filter((event) => {
      const age = daysBetween(dayKey(event.created_at), snapshotDate);
      return age >= minAge && age < maxAge;
    });
    const newOwners = new Set(
      Object.entries(ownerHistory)
        .filter(([, entry]) => {
          const age = daysBetween(dayKey(entry.first_seen), snapshotDate);
          return age >= minAge && age < maxAge;
        })
        .map(([owner]) => owner)
    );
    return {
      from: utcDateOffset(snapshotDate, -(maxAge - 1)),
      to: utcDateOffset(snapshotDate, -minAge),
      version_release_count: windowEvents.length,
      active_module_count: new Set(windowEvents.map((event) => event.module)).size,
      active_owner_count: new Set(windowEvents.map((event) => event.owner)).size,
      new_module_count: Object.values(moduleHistory).filter((entry) => {
        const age = daysBetween(dayKey(entry.first_seen), snapshotDate);
        return age >= minAge && age < maxAge;
      }).length,
      new_owner_count: newOwners.size,
      new_owner_module_count: new Set(
        windowEvents.filter((event) => newOwners.has(event.owner)).map((event) => event.module)
      ).size
    };
  }

  return {
    moduleHistory,
    ownerHistory,
    publicationWindows: {
      recent7: summarizeWindow(0, 7),
      previous7: summarizeWindow(7, 14)
    },
    integrity: {
      non_yanked_version_rows: events.length,
      yanked_version_rows: yankedVersionRows,
      duplicate_package_id_count: duplicatePackageIds.size,
      invalid_created_at_count: invalidCreatedAt.length,
      invalid_created_at_examples: invalidCreatedAt.slice(0, 10),
      future_created_at_count: futureCreatedAt.length,
      future_created_at_examples: futureCreatedAt.slice(0, 10),
      owner_username_mismatch_count: ownerUsernameMismatches.length,
      owner_username_mismatch_examples: ownerUsernameMismatches.slice(0, 10),
      meta_created_at_mismatch_count: metaCreatedAtMismatches.length,
      meta_created_at_mismatch_examples: metaCreatedAtMismatches.slice(0, 10)
    }
  };
}

function buildDownloadMap(downloadRows) {
  return new Map(
    downloadRows
      .filter((row) => row.module_name)
      .map((row) => [String(row.module_name), parseInteger(row.downloads)])
  );
}

function buildUserMap(userRows) {
  return new Map(
    userRows
      .filter((row) => row.username)
      .map((row) => [String(row.username), row])
  );
}

function normalizeKeywords(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function moduleFromPackageRow(row, downloadMap, moduleHistory) {
  const meta = parseMetaJson(row.meta_json);
  const name = String(row.module_name || meta.name || "").trim();
  const history = moduleHistory[name] || {};
  return {
    name,
    version: String(row.version || meta.version || ""),
    created_at: publicationTimestamp(row),
    first_published_at: history.first_seen || publicationTimestamp(row),
    last_published_at: history.last_seen || publicationTimestamp(row),
    version_count: history.version_count || 1,
    license: String(meta.license || ""),
    repository: normalizeRepository(meta.repository),
    keywords: normalizeKeywords(meta.keywords),
    description: String(meta.description || ""),
    preferred_target: String(meta.preferred_target || meta.preferredTarget || ""),
    supported_targets: String(meta.supported_targets || meta["supported-targets"] || ""),
    line_count: parseInteger(row.line_count),
    package_count: parseInteger(row.package_count),
    downloads: downloadMap.get(name) || 0,
    owner: ownerOf(name),
    pkg_name: String(row.pkg_name || "")
  };
}

function buildStatistics(modules, packageRows, downloadRows) {
  return {
    total_modules: modules.length,
    total_packages: modules.reduce((sum, module) => sum + parseInteger(module.package_count), 0),
    total_downloads: downloadRows.reduce((sum, row) => sum + parseInteger(row.downloads), 0),
    total_lines: modules.reduce((sum, module) => sum + parseInteger(module.line_count), 0),
    total_uploaders: new Set(modules.map((module) => ownerOf(module.name))).size,
    total_versions: packageRows.filter((row) => !parseBoolean(row.yanked)).length
  };
}

function profileFromUser(row, owner) {
  const login = String(row?.gh_login || "").trim();
  const name = String(row?.gh_name || "").trim();
  const avatar = String(row?.gh_avatar || "").trim();
  return {
    login: login || owner,
    name,
    type: "",
    company: "",
    blog: "",
    location: "",
    email_public: false,
    bio: "",
    twitter_username: "",
    public_repos: 0,
    followers: 0,
    following: 0,
    created_at: "",
    updated_at: "",
    html_url: login ? `https://github.com/${encodeURIComponent(login)}` : "",
    avatar_url: avatar,
    exists: Boolean(login),
    fetched_at: new Date().toISOString(),
    source: "business-analytics users.csv",
    mooncakes_username: owner
  };
}

function buildProfiles(modules, userRows) {
  const userMap = buildUserMap(userRows);
  const profiles = {};
  for (const owner of new Set(modules.map((module) => ownerOf(module.name)))) {
    profiles[owner] = profileFromUser(userMap.get(owner), owner);
  }
  return profiles;
}

function buildRegistrationAnalysis(userRows, ownerHistory, snapshotDate) {
  const previousWeek = previousUtcCalendarWeek(snapshotDate);
  const normalizedUsers = [];
  let missingSignupTime = 0;
  let invalidSignupTime = 0;
  let futureSignupTime = 0;
  let contributionBeforeRegistration = 0;

  for (const row of userRows) {
    const rawSignupTime = String(row.signup_time || "").trim();
    if (!rawSignupTime) {
      missingSignupTime += 1;
      continue;
    }
    const registeredAt = normalizeSignupDateTime(rawSignupTime);
    if (!registeredAt || !Number.isFinite(Date.parse(registeredAt))) {
      invalidSignupTime += 1;
      continue;
    }
    const username = String(row.username || "").trim();
    const registeredOn = registeredAt.slice(0, 10);
    if (registeredOn > snapshotDate) futureSignupTime += 1;
    if (ownerHistory[username]?.first_seen && Date.parse(ownerHistory[username].first_seen) < Date.parse(registeredAt)) {
      contributionBeforeRegistration += 1;
    }
    normalizedUsers.push({ row, username, registeredAt, registeredOn });
  }

  const registeredLastWeek = normalizedUsers.filter(({ registeredOn }) =>
    registeredOn >= previousWeek.from && registeredOn <= previousWeek.to
  );
  const enabledLastWeek = registeredLastWeek.filter(({ row }) => !parseBoolean(row.disabled));
  const withoutContribution = enabledLastWeek
    .filter(({ username }) => !ownerHistory[username])
    .sort((left, right) => right.registeredOn.localeCompare(left.registeredOn) || left.username.localeCompare(right.username))
    .map(({ row, username, registeredOn }) => {
      const githubLogin = String(row.gh_login || "").trim();
      return {
        username,
        registered_on: registeredOn,
        status: "registered_no_contribution",
        github_login: githubLogin,
        github_url: githubLogin ? `https://github.com/${encodeURIComponent(githubLogin)}` : ""
      };
    });

  return {
    window: {
      from: previousWeek.from,
      to: previousWeek.to,
      source_timezone: SOURCE_SIGNUP_TIMEZONE,
      display_timezone: "UTC",
      registered_count: registeredLastWeek.length,
      enabled_registered_count: enabledLastWeek.length,
      disabled_registered_count: registeredLastWeek.length - enabledLastWeek.length,
      contributed_count: enabledLastWeek.length - withoutContribution.length,
      no_contribution_count: withoutContribution.length
    },
    users: withoutContribution,
    integrity: {
      missing_signup_time_count: missingSignupTime,
      invalid_signup_time_count: invalidSignupTime,
      future_signup_time_count: futureSignupTime,
      contribution_before_registration_count: contributionBeforeRegistration
    }
  };
}

function duplicateValues(rows, field) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const value = String(row[field] || "").trim();
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

function buildSourceIntegrity({ packageIntegrity, registrationIntegrity, moduleHistory, ownerHistory, userRows, packageRows, latestPackageRows, downloadRows }) {
  const moduleNames = new Set(Object.keys(moduleHistory));
  const ownerNames = new Set(Object.keys(ownerHistory));
  const userNames = new Set(userRows.filter((row) => row.username).map((row) => String(row.username)));
  const userById = new Map(userRows.filter((row) => row.user_id).map((row) => [String(row.user_id), String(row.username || "")]));
  const downloadNames = new Set();
  const duplicateDownloadNames = new Set();
  const invalidDownloadUpdates = [];
  const invalidDownloadValues = [];
  const downloadUpdateTimes = [];

  for (const row of downloadRows) {
    const name = String(row.module_name || "");
    if (downloadNames.has(name)) duplicateDownloadNames.add(name);
    downloadNames.add(name);
    if (!/^\d+$/.test(String(row.downloads || "").trim())) invalidDownloadValues.push(name);
    const updatedAt = normalizeDateTime(row.updated_at);
    if (updatedAt && Number.isFinite(Date.parse(updatedAt))) downloadUpdateTimes.push(updatedAt);
    else invalidDownloadUpdates.push(name);
  }

  const missingDownloads = Array.from(moduleNames).filter((name) => !downloadNames.has(name));
  const orphanDownloads = Array.from(downloadNames).filter((name) => !moduleNames.has(name));
  const ownersWithoutUsers = Array.from(ownerNames).filter((owner) => !userNames.has(owner));
  const packageUserMappingMismatches = packageRows.filter((row) => userById.get(String(row.user_id || "")) !== String(row.username || ""));
  const malformedModuleNames = packageRows.filter((row) => {
    const name = String(row.module_name || "").trim();
    return !name.includes("/") || !ownerOf(name) || ownerOf(name) === "(unknown)";
  });
  const ownerCaseGroups = new Map();
  for (const owner of ownerNames) {
    const key = owner.toLowerCase();
    ownerCaseGroups.set(key, [...(ownerCaseGroups.get(key) || []), owner]);
  }
  const ownerCaseCollisions = Array.from(ownerCaseGroups.values()).filter((owners) => owners.length > 1);
  const latestMissingLineCount = latestPackageRows.filter((row) => !String(row.line_count || "").trim());
  const latestMissingPackageCount = latestPackageRows.filter((row) => !String(row.package_count || "").trim());
  downloadUpdateTimes.sort();

  return {
    ...packageIntegrity,
    ...registrationIntegrity,
    duplicate_user_id_count: duplicateValues(userRows, "user_id").size,
    duplicate_username_count: duplicateValues(userRows, "username").size,
    package_user_mapping_mismatch_count: packageUserMappingMismatches.length,
    malformed_module_name_count: malformedModuleNames.length,
    owner_case_collision_count: ownerCaseCollisions.length,
    duplicate_download_module_count: duplicateDownloadNames.size,
    missing_download_module_count: missingDownloads.length,
    missing_download_module_examples: missingDownloads.slice(0, 10),
    orphan_download_module_count: orphanDownloads.length,
    orphan_download_module_examples: orphanDownloads.slice(0, 10),
    invalid_download_value_count: invalidDownloadValues.length,
    invalid_download_updated_at_count: invalidDownloadUpdates.length,
    latest_module_missing_line_count: latestMissingLineCount.length,
    latest_module_missing_line_examples: latestMissingLineCount.slice(0, 10).map((row) => String(row.module_name || "")),
    latest_module_missing_package_count: latestMissingPackageCount.length,
    latest_module_missing_package_examples: latestMissingPackageCount.slice(0, 10).map((row) => String(row.module_name || "")),
    owner_without_user_row_count: ownersWithoutUsers.length,
    owner_without_user_row_examples: ownersWithoutUsers.slice(0, 10),
    download_updated_at_min: downloadUpdateTimes[0] || "",
    download_updated_at_max: downloadUpdateTimes.at(-1) || ""
  };
}

export async function buildSnapshotFromExports(options = {}) {
  const baseUrl = String(options.baseUrl || exportsBaseUrl()).replace(/\/+$/, "");
  const snapshotDate = options.snapshotDate || todayInUtc();
  const [userRows, packageRows, downloadRows] = await Promise.all([
    fetchCsvRows("/exports/users.csv", baseUrl),
    fetchCsvRows("/exports/packages.csv", baseUrl),
    fetchCsvRows("/exports/module-download-totals.csv", baseUrl)
  ]);
  const latestPackageRows = buildLatestPackageRows(packageRows);
  const publicationHistory = buildPublicationHistory(packageRows, snapshotDate);
  const registrationAnalysis = buildRegistrationAnalysis(userRows, publicationHistory.ownerHistory, snapshotDate);
  const downloadMap = buildDownloadMap(downloadRows);
  const modules = latestPackageRows.map((row) => moduleFromPackageRow(row, downloadMap, publicationHistory.moduleHistory));
  const sourceIntegrity = buildSourceIntegrity({
    packageIntegrity: publicationHistory.integrity,
    registrationIntegrity: registrationAnalysis.integrity,
    moduleHistory: publicationHistory.moduleHistory,
    ownerHistory: publicationHistory.ownerHistory,
    userRows,
    packageRows,
    latestPackageRows,
    downloadRows
  });
  const statistics = buildStatistics(modules, packageRows, downloadRows);
  const githubProfiles = buildProfiles(modules, userRows);

  return {
    date: snapshotDate,
    captured_at: new Date().toISOString(),
    timezone: "UTC",
    source: {
      exports_base_url: baseUrl,
      users: exportUrl("/exports/users.csv", baseUrl),
      packages: exportUrl("/exports/packages.csv", baseUrl),
      module_download_totals: exportUrl("/exports/module-download-totals.csv", baseUrl),
      manifest: exportUrl("/exports/manifest.json", baseUrl)
    },
    modules,
    module_history: publicationHistory.moduleHistory,
    owner_history: publicationHistory.ownerHistory,
    publication_windows: publicationHistory.publicationWindows,
    registration_window: registrationAnalysis.window,
    registered_non_contributors: registrationAnalysis.users,
    source_integrity: sourceIntegrity,
    statistics,
    github_profiles: githubProfiles,
    github_meta: {
      total_owners: Object.keys(githubProfiles).length,
      profiles_available: Object.values(githubProfiles).filter((profile) => profile.exists !== false).length,
      fetched: Object.keys(githubProfiles).length,
      from_cache: 0,
      failed: 0,
      not_found: Object.values(githubProfiles).filter((profile) => profile.exists === false).length,
      limit_hit: false,
      authenticated: false,
      generated_by: "business-analytics-exports"
    },
    export_meta: {
      user_rows: userRows.length,
      package_version_rows: packageRows.length,
      non_yanked_package_version_rows: sourceIntegrity.non_yanked_version_rows,
      yanked_package_version_rows: sourceIntegrity.yanked_version_rows,
      latest_module_rows: modules.length,
      module_download_rows: downloadRows.length
    }
  };
}
