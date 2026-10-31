#!/usr/bin/env bash
# Publish newton.camera now: runs the "Publish site" workflow on GitHub, which syncs your
# Lightroom albums, builds the site and deploys it. Use it after editing an album in Lightroom.
#
#   scripts/publish.sh            start a publish
#   scripts/publish.sh --watch    start one and follow it until it's live
#
# Sign-in (nothing secret is ever stored in this repo). The first that works is used:
#   1. The GitHub CLI, if you're logged in:   brew install gh && gh auth login
#   2. $GITHUB_TOKEN in your environment
#   3. A token saved in your macOS Keychain under the name "newton-camera-publish":
#        security add-generic-password -a "$USER" -s newton-camera-publish -w
#      (it asks for the token, so it never lands in your shell history)
# For 2 and 3, make a fine-grained token at github.com/settings/personal-access-tokens:
# only this repository, permission "Actions: Read and write". Nothing else.
set -euo pipefail
cd "$(dirname "$0")/.."

WORKFLOW="publish.yml"
BRANCH="main"
REPO="$(git remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')"
WATCH=false; [[ "${1:-}" == "--watch" ]] && WATCH=true

# The workflow builds what's on GitHub, not what's on this computer.
git fetch -q origin "$BRANCH" 2>/dev/null || true
ahead="$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 0)"
if [[ "$ahead" != "0" ]]; then
  echo "Note: $ahead local commit(s) aren't pushed yet. This publish won't include them (run git push first)."
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Note: you have uncommitted changes. This publish won't include them."
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh workflow run "$WORKFLOW" --repo "$REPO" --ref "$BRANCH"
  echo "Publishing $REPO. Progress: https://github.com/$REPO/actions/workflows/$WORKFLOW"
  if $WATCH; then
    sleep 4
    run_id="$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --limit 1 --json databaseId --jq '.[0].databaseId')"
    gh run watch "$run_id" --repo "$REPO" --exit-status && echo "Published."
  fi
  exit 0
fi

token="${GITHUB_TOKEN:-}"; source_name="GITHUB_TOKEN (set in your shell)"
if [[ -z "$token" ]] && command -v security >/dev/null 2>&1; then
  token="$(security find-generic-password -s newton-camera-publish -w 2>/dev/null || true)"
  source_name='your Keychain ("newton-camera-publish")'
fi
token="$(printf '%s' "$token" | tr -d '[:space:]')"   # stray spaces/newlines from pasting
if [[ -z "$token" ]]; then
  echo "Can't sign in to GitHub. Either log in with the GitHub CLI (gh auth login), or save a token:" >&2
  echo "  security add-generic-password -a \"\$USER\" -s newton-camera-publish -w" >&2
  echo "See the comments at the top of $0 for what kind of token." >&2
  exit 1
fi

status="$(curl -sS -o /tmp/newton-publish.$$ -w '%{http_code}' -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $token" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO/actions/workflows/$WORKFLOW/dispatches" \
  -d "{\"ref\":\"$BRANCH\"}")"
body="$(cat /tmp/newton-publish.$$ 2>/dev/null || true)"; rm -f /tmp/newton-publish.$$

if [[ "$status" == "204" ]]; then
  echo "Signed in with the token from $source_name."
  echo "Publishing $REPO. Progress: https://github.com/$REPO/actions/workflows/$WORKFLOW"
  $WATCH && echo "(--watch needs the GitHub CLI; open the link above to follow along.)"
else
  echo "GitHub said $status: $body" >&2
  if [[ "$status" == "401" ]]; then
    echo "GitHub doesn't recognise the token from $source_name (wrong, incomplete, expired or revoked)." >&2
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
      echo "To use the Keychain token instead, clear the shell one:  unset GITHUB_TOKEN" >&2
      echo "(and remove any 'export GITHUB_TOKEN=' line from ~/.zshrc)" >&2
    else
      echo "Replace the saved token with:  security add-generic-password -U -a \"\$USER\" -s newton-camera-publish -w" >&2
    fi
  fi
  [[ "$status" == "403" || "$status" == "404" ]] && echo "Check the token covers $REPO with \"Actions: Read and write\"." >&2
  exit 1
fi
