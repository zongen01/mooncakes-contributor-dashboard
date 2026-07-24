import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const repository = process.env.MOONCAKES_GITHUB_REPOSITORY || "zongen01/mooncakes-contributor-dashboard";
const branch = process.env.MOONCAKES_GITHUB_BRANCH || "main";
const snapshotPath = process.env.MOONCAKES_SNAPSHOT_FILE || "public/data/latest.json";
const snapshotFile = path.resolve(snapshotPath);

if (!process.env.GH_TOKEN) {
  throw new Error("GH_TOKEN is required to publish the dashboard snapshot");
}

function githubApi(method, endpoint, payload, jq) {
  const args = ["api"];
  if (method !== "GET") args.push("--method", method);
  args.push(endpoint);
  if (payload !== undefined) args.push("--input", "-");
  if (jq) args.push("--jq", jq);
  const output = execFileSync("gh", args, {
    input: payload === undefined ? undefined : JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
  return output.trim();
}

function gitBlobSha(content) {
  const prefix = Buffer.from(`blob ${content.length}\0`);
  return createHash("sha1").update(prefix).update(content).digest("hex");
}

const content = readFileSync(snapshotFile);
const snapshot = JSON.parse(content.toString("utf8"));
if (snapshot.source?.provider !== "business-analytics-exports" || snapshot.data_quality?.status !== "pass") {
  throw new Error("Refusing to publish a non-sanitized or unvalidated snapshot");
}

const encodedBranch = encodeURIComponent(branch);
const remoteBlobSha = githubApi(
  "GET",
  `/repos/${repository}/contents/${snapshotPath}?ref=${encodedBranch}`,
  undefined,
  ".sha"
);
if (gitBlobSha(content) === remoteBlobSha) {
  console.log(`No snapshot changes to publish for ${snapshot.date}`);
  process.exit(0);
}

const parentSha = githubApi(
  "GET",
  `/repos/${repository}/git/ref/heads/${encodedBranch}`,
  undefined,
  ".object.sha"
);
const baseTreeSha = githubApi(
  "GET",
  `/repos/${repository}/git/commits/${parentSha}`,
  undefined,
  ".tree.sha"
);
const blobSha = githubApi("POST", `/repos/${repository}/git/blobs`, {
  content: content.toString("base64"),
  encoding: "base64"
}, ".sha");
const treeSha = githubApi("POST", `/repos/${repository}/git/trees`, {
  base_tree: baseTreeSha,
  tree: [{
    path: snapshotPath,
    mode: "100644",
    type: "blob",
    sha: blobSha
  }]
}, ".sha");
const commitSha = githubApi("POST", `/repos/${repository}/git/commits`, {
  message: `Update dashboard data ${snapshot.date}`,
  tree: treeSha,
  parents: [parentSha]
}, ".sha");

githubApi("PATCH", `/repos/${repository}/git/refs/heads/${encodedBranch}`, {
  sha: commitSha,
  force: false
});
console.log(`Published ${snapshot.date} snapshot at ${commitSha}`);
