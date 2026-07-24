#!/bin/zsh

set -euo pipefail

export PATH="$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [[ -z "${MOONCAKES_EXPORTS_BASE_URL:-}" && -z "${BUSINESS_ANALYTICS_EXPORTS_BASE_URL:-}" ]]; then
  echo "MOONCAKES_EXPORTS_BASE_URL is required" >&2
  exit 1
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "GH_TOKEN is required" >&2
  exit 1
fi

echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Mooncakes dashboard update"

repo_dir="${MOONCAKES_DASHBOARD_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$repo_dir"
npm run build:data
npm run validate:data
node scripts/publish-snapshot.mjs

echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Mooncakes dashboard update published"
