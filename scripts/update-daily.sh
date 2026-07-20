#!/bin/zsh

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export MOONCAKES_EXPORTS_BASE_URL="http://192.168.86.2:18080"

repo_dir="${MOONCAKES_DASHBOARD_REPO_DIR:-/Users/zongen/Documents/New project/mooncakes-contributor-dashboard}"
temp_root="$(mktemp -d /tmp/mooncakes-dashboard-update.XXXXXX)"
worktree_dir="$temp_root/repo"

cleanup() {
  if [[ -e "$worktree_dir/.git" ]]; then
    git -C "$repo_dir" worktree remove --force "$worktree_dir" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$temp_root"
}
trap cleanup EXIT

echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Starting Mooncakes dashboard update"

git -C "$repo_dir" fetch origin main
git -C "$repo_dir" worktree add --detach "$worktree_dir" origin/main

cd "$worktree_dir"
npm run build:data
npm run validate:data

node -e "const s=require('./public/data/latest.json'); if(s.source?.exports_base_url!==process.env.MOONCAKES_EXPORTS_BASE_URL) throw new Error('Unexpected exports source');"

if git diff --quiet -- public/data/latest.json; then
  echo "No data changes to publish"
  exit 0
fi

git config user.name "zongen01"
git config user.email "zongen01@users.noreply.github.com"
git add -- public/data/latest.json
git commit -m "Update dashboard data $(date -u '+%Y-%m-%d')"
git push origin HEAD:main

echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] Mooncakes dashboard update published"
