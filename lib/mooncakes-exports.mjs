const DEFAULT_EXPORTS_BASE_URL = "http://192.168.86.2:18080";

export function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
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
  if (text.includes("T")) return text;
  return `${text.replace(" ", "T")}+00:00`;
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

function moduleFromPackageRow(row, downloadMap) {
  const meta = parseMetaJson(row.meta_json);
  const name = String(row.module_name || meta.name || "").trim();
  return {
    name,
    version: String(row.version || meta.version || ""),
    created_at: normalizeDateTime(meta.created_at || row.created_at),
    license: String(meta.license || ""),
    repository: normalizeRepository(meta.repository),
    keywords: normalizeKeywords(meta.keywords),
    description: String(meta.description || ""),
    preferred_target: String(meta.preferred_target || meta.preferredTarget || ""),
    supported_targets: String(meta.supported_targets || meta["supported-targets"] || ""),
    line_count: parseInteger(row.line_count),
    package_count: parseInteger(row.package_count),
    downloads: downloadMap.get(name) || 0,
    owner: String(row.username || ownerOf(name)),
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

export async function buildSnapshotFromExports(options = {}) {
  const baseUrl = String(options.baseUrl || exportsBaseUrl()).replace(/\/+$/, "");
  const snapshotDate = options.snapshotDate || todayInShanghai();
  const [userRows, packageRows, downloadRows] = await Promise.all([
    fetchCsvRows("/exports/users.csv", baseUrl),
    fetchCsvRows("/exports/packages.csv", baseUrl),
    fetchCsvRows("/exports/module-download-totals.csv", baseUrl)
  ]);
  const latestPackageRows = buildLatestPackageRows(packageRows);
  const downloadMap = buildDownloadMap(downloadRows);
  const modules = latestPackageRows.map((row) => moduleFromPackageRow(row, downloadMap));
  const statistics = buildStatistics(modules, packageRows, downloadRows);
  const githubProfiles = buildProfiles(modules, userRows);

  return {
    date: snapshotDate,
    captured_at: new Date().toISOString(),
    source: {
      exports_base_url: baseUrl,
      users: exportUrl("/exports/users.csv", baseUrl),
      packages: exportUrl("/exports/packages.csv", baseUrl),
      module_download_totals: exportUrl("/exports/module-download-totals.csv", baseUrl),
      manifest: exportUrl("/exports/manifest.json", baseUrl)
    },
    modules,
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
      latest_module_rows: modules.length,
      module_download_rows: downloadRows.length
    }
  };
}
