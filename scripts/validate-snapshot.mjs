import { readFile } from "node:fs/promises";

import { SNAPSHOT_ALGORITHM_VERSION } from "../lib/mooncakes-exports.mjs";

const snapshotFile = process.argv[2] || "public/data/latest.json";
const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
const modules = snapshot.modules || [];
const moduleHistory = snapshot.module_history || {};
const ownerHistory = snapshot.owner_history || {};
const statistics = snapshot.statistics || {};
const derived = snapshot.derived_metrics || {};
const windows = snapshot.publication_windows || {};
const sourceIntegrity = snapshot.source_integrity || {};

function ownerOf(moduleName) {
  return String(moduleName || "").split("/")[0] || "(unknown)";
}

function dayKey(value) {
  return String(value || "").slice(0, 10);
}

function daysBetween(left, right) {
  return Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86400000);
}

function inWindow(value, minAge, maxAge) {
  const age = daysBetween(dayKey(value), snapshot.date);
  return age >= minAge && age < maxAge;
}

function utcDateOffset(date, offset) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sum(items, selector) {
  return items.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

function findSensitiveKeys(value, path = [], matches = []) {
  if (!value || typeof value !== "object") return matches;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    const normalizedKey = key.toLowerCase();
    const isSensitive = normalizedKey !== "email_public"
      && /(?:^|_)(?:password|passwd|secret|access_token|refresh_token|oauth_token|github_token|token|email|phone|mobile)(?:_|$)/i.test(normalizedKey);
    const isRawPrivateExportField = /^(?:user_id|gh_id|signup_time|meta_json|authors)$/i.test(key);
    if (isSensitive || isRawPrivateExportField) {
      matches.push(nextPath.join("."));
    }
    findSensitiveKeys(child, nextPath, matches);
  }
  return matches;
}

function findSecretLikeValues(value, path = [], matches = []) {
  if (typeof value === "string") {
    if (/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|https?:\/\/[^\s/:]+:[^\s/@]+@)/.test(value)) {
      matches.push(path.join("."));
    }
    return matches;
  }
  if (!value || typeof value !== "object") return matches;
  for (const [key, child] of Object.entries(value)) findSecretLikeValues(child, [...path, key], matches);
  return matches;
}

assert(snapshot.timezone === "UTC", `timezone must be UTC, got ${snapshot.timezone}`);
assert(/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date || ""), `invalid snapshot date: ${snapshot.date}`);
assert(Number.isFinite(Date.parse(snapshot.captured_at)), `invalid captured_at: ${snapshot.captured_at}`);
assert(dayKey(snapshot.captured_at) === snapshot.date, `captured_at date differs from snapshot date: ${snapshot.captured_at}`);
assert(derived.algorithm_version === SNAPSHOT_ALGORITHM_VERSION, `unexpected algorithm version: ${derived.algorithm_version}`);
assert(snapshot.data_quality?.status === "pass", `data quality is ${snapshot.data_quality?.status || "missing"}`);
const sensitiveKeys = findSensitiveKeys(snapshot);
assert(sensitiveKeys.length === 0, `sensitive fields found in public snapshot: ${sensitiveKeys.slice(0, 5).join(", ")}`);
const secretLikeValues = findSecretLikeValues(snapshot);
assert(secretLikeValues.length === 0, `secret-like values found in public snapshot: ${secretLikeValues.slice(0, 5).join(", ")}`);
assert(modules.length === Number(statistics.total_modules), `module count mismatch: ${modules.length} != ${statistics.total_modules}`);
assert(new Set(modules.map((module) => module.name)).size === modules.length, "module list contains duplicate names");
assert(Object.keys(moduleHistory).length === modules.length, "module history does not cover every module");

const ownerNames = new Set(modules.map((module) => ownerOf(module.name)));
assert(Object.keys(ownerHistory).length === ownerNames.size, "owner history does not cover every owner");
assert(Number(statistics.total_uploaders) === ownerNames.size, "total_uploaders does not match unique owners");
assert(sum(modules, (module) => module.package_count) === Number(statistics.total_packages), "total_packages does not match current package_count sum");
assert(sum(modules, (module) => module.line_count) === Number(statistics.total_lines), "total_lines does not match current line_count sum");
assert(sum(modules, (module) => module.downloads) === Number(statistics.total_downloads), "total_downloads does not match module download sum");
assert(sum(Object.values(moduleHistory), (entry) => entry.version_count) === Number(statistics.total_versions), "module version history does not match total_versions");
assert(sum(Object.values(ownerHistory), (entry) => entry.version_count) === Number(statistics.total_versions), "owner version history does not match total_versions");
assert(Number(sourceIntegrity.non_yanked_version_rows) === Number(statistics.total_versions), "source non-yanked versions do not match total_versions");
for (const field of [
  "duplicate_package_id_count",
  "duplicate_user_id_count",
  "duplicate_username_count",
  "package_user_mapping_mismatch_count",
  "malformed_module_name_count",
  "owner_case_collision_count",
  "invalid_created_at_count",
  "future_created_at_count",
  "owner_username_mismatch_count",
  "duplicate_download_module_count",
  "missing_download_module_count",
  "orphan_download_module_count",
  "invalid_download_value_count",
  "invalid_download_updated_at_count",
  "owner_without_user_row_count"
]) {
  assert(Number(sourceIntegrity[field] ?? 0) === 0, `source integrity failed: ${field}=${sourceIntegrity[field]}`);
}
assert(Number.isFinite(Date.parse(sourceIntegrity.download_updated_at_max)), "download_updated_at_max is invalid");
assert(Date.parse(sourceIntegrity.download_updated_at_max) <= Date.parse(snapshot.captured_at), "download data timestamp is later than snapshot capture");

const ownerRollup = new Map();
for (const module of modules) {
  const history = moduleHistory[module.name];
  assert(history, `missing module history: ${module.name}`);
  assert(Date.parse(history.first_seen) <= Date.parse(history.last_seen), `module history is reversed: ${module.name}`);
  assert(module.first_published_at === history.first_seen, `first_published_at mismatch: ${module.name}`);
  assert(module.last_published_at === history.last_seen, `last_published_at mismatch: ${module.name}`);
  assert(module.created_at === history.last_seen, `created_at must be latest publication time: ${module.name}`);
  assert(Number(module.version_count) === Number(history.version_count), `version_count mismatch: ${module.name}`);
  assert(sum(Object.values(history.release_days || {}), (count) => count) === Number(history.version_count), `release_days mismatch: ${module.name}`);
  assert(dayKey(module.last_published_at) <= snapshot.date, `future module publication: ${module.name}`);

  const owner = ownerOf(module.name);
  if (!ownerRollup.has(owner)) ownerRollup.set(owner, { first: history.first_seen, last: history.last_seen, versions: 0, modules: 0 });
  const entry = ownerRollup.get(owner);
  if (Date.parse(history.first_seen) < Date.parse(entry.first)) entry.first = history.first_seen;
  if (Date.parse(history.last_seen) > Date.parse(entry.last)) entry.last = history.last_seen;
  entry.versions += Number(history.version_count || 0);
  entry.modules += 1;
}

for (const [owner, rollup] of ownerRollup) {
  const history = ownerHistory[owner];
  assert(history, `missing owner history: ${owner}`);
  assert(history.first_seen === rollup.first, `owner first_seen mismatch: ${owner}`);
  assert(history.last_seen === rollup.last, `owner last_seen mismatch: ${owner}`);
  assert(Number(history.version_count) === rollup.versions, `owner version_count mismatch: ${owner}`);
  assert(Number(history.module_count) === rollup.modules, `owner module_count mismatch: ${owner}`);
}

function validateWindow(name, minAge, maxAge) {
  const window = windows[name] || {};
  assert(window.from === utcDateOffset(snapshot.date, -(maxAge - 1)), `${name} from boundary mismatch`);
  assert(window.to === utcDateOffset(snapshot.date, -minAge), `${name} to boundary mismatch`);
  const activeModules = modules.filter((module) => Object.keys(moduleHistory[module.name]?.release_days || {}).some((date) => inWindow(date, minAge, maxAge)));
  const newModules = modules.filter((module) => inWindow(module.first_published_at, minAge, maxAge));
  const activeOwners = new Set(activeModules.map((module) => ownerOf(module.name)));
  const newOwners = new Set(Object.entries(ownerHistory).filter(([, history]) => inWindow(history.first_seen, minAge, maxAge)).map(([owner]) => owner));
  const newOwnerModules = modules.filter((module) => newOwners.has(ownerOf(module.name)) && inWindow(module.first_published_at, minAge, maxAge));
  const versionReleases = activeModules.reduce((total, module) => total + Object.entries(moduleHistory[module.name]?.release_days || {}).reduce((subtotal, [date, count]) => subtotal + (inWindow(date, minAge, maxAge) ? Number(count) : 0), 0), 0);

  assert(Number(window.version_release_count) === versionReleases, `${name} version_release_count mismatch`);
  assert(Number(window.active_module_count) === activeModules.length, `${name} active_module_count mismatch`);
  assert(Number(window.new_module_count) === newModules.length, `${name} new_module_count mismatch`);
  assert(Number(window.active_owner_count) === activeOwners.size, `${name} active_owner_count mismatch`);
  assert(Number(window.new_owner_count) === newOwners.size, `${name} new_owner_count mismatch`);
  assert(Number(window.new_owner_module_count) === newOwnerModules.length, `${name} new_owner_module_count mismatch`);
}

validateWindow("recent7", 0, 7);
validateWindow("previous7", 7, 14);
assert(inWindow(utcDateOffset(snapshot.date, -6), 0, 7), "7-day window must include the sixth prior UTC date");
assert(!inWindow(utcDateOffset(snapshot.date, -7), 0, 7), "7-day window must exclude the seventh prior UTC date");

assert(Number(derived.recent7_active_owner_count) === Number(windows.recent7.active_owner_count), "derived recent active owners mismatch");
assert(Number(derived.recent7_active_module_count) === Number(windows.recent7.active_module_count), "derived recent active modules mismatch");
assert(Number(derived.recent7_version_release_count) === Number(windows.recent7.version_release_count), "derived recent releases mismatch");
assert(Number(derived.recent7_new_module_count) === Number(windows.recent7.new_module_count), "derived recent new modules mismatch");
assert(Number(derived.recent7_new_owner_count) === Number(windows.recent7.new_owner_count), "derived recent new owners mismatch");
assert(Number(derived.recent7_new_owner_module_count) === Number(windows.recent7.new_owner_module_count), "derived recent new-owner modules mismatch");
assert(Number(derived.previous7_active_owner_count) === Number(windows.previous7.active_owner_count), "derived previous active owners mismatch");
assert(Number(derived.previous7_active_module_count) === Number(windows.previous7.active_module_count), "derived previous active modules mismatch");
assert(Number(derived.previous7_version_release_count) === Number(windows.previous7.version_release_count), "derived previous releases mismatch");
assert(Number(derived.previous7_new_module_count) === Number(windows.previous7.new_module_count), "derived previous new modules mismatch");
assert(Number(derived.previous7_new_owner_count) === Number(windows.previous7.new_owner_count), "derived previous new owners mismatch");
assert(dayKey(ownerHistory["brother-666"]?.first_seen) <= "2026-07-06", "brother-666 newcomer regression detected");

console.log(JSON.stringify({
  snapshot: snapshot.date,
  modules: modules.length,
  owners: ownerNames.size,
  versions: statistics.total_versions,
  recent7: windows.recent7,
  previous7: windows.previous7,
  quality: snapshot.data_quality.status
}));
