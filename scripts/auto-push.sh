#!/usr/bin/env bash

set -Eeuo pipefail

print_usage() {
  cat <<'USAGE'
Usage:
  auto-push.sh [options]

Options:
  --once                 Check, commit, and push once, then exit.
  --interval SECONDS    Interval between checks (default: 900).
  --remote NAME         Git remote name (default: origin).
  --branch NAME         Branch to push (default: master).
  --message MESSAGE     Commit message (default: chore: save workspace checkpoint).
  --dry-run             Show whether changes are present without staging or committing.
  --help                Show this help.

Environment variables:
  AUTO_PUSH_REPO_DIR              Repository path (default: current Git repository).
  AUTO_PUSH_INTERVAL_SECONDS      Default interval in seconds.
  AUTO_PUSH_REMOTE                Default remote name.
  AUTO_PUSH_BRANCH                Default branch name.
  AUTO_PUSH_COMMIT_MESSAGE        Default commit message.
  AUTO_PUSH_INCLUDE_RUNTIME_DATA  Set to 1 to include data/simcompanies.sqlite*.
  AUTO_PUSH_VERIFY_COMMAND        Optional command to run before committing.

Authentication is delegated to Git's configured SSH key or credential helper.
This script never accepts or stores a GitHub token.
USAGE
}

fail() {
  printf 'auto-push: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

REMOTE_NAME="${AUTO_PUSH_REMOTE:-origin}"
TARGET_BRANCH="${AUTO_PUSH_BRANCH:-master}"
INTERVAL_SECONDS="${AUTO_PUSH_INTERVAL_SECONDS:-900}"
COMMIT_MESSAGE="${AUTO_PUSH_COMMIT_MESSAGE:-chore: save workspace checkpoint}"
REPO_DIR="${AUTO_PUSH_REPO_DIR:-}"
RUN_ONCE=false
DRY_RUN=false

while (($# > 0)); do
  case "$1" in
    --once)
      RUN_ONCE=true
      shift
      ;;
    --interval)
      (($# >= 2)) || fail "--interval requires a number of seconds"
      INTERVAL_SECONDS="$2"
      shift 2
      ;;
    --interval=*)
      INTERVAL_SECONDS="${1#*=}"
      shift
      ;;
    --remote)
      (($# >= 2)) || fail "--remote requires a remote name"
      REMOTE_NAME="$2"
      shift 2
      ;;
    --remote=*)
      REMOTE_NAME="${1#*=}"
      shift
      ;;
    --branch)
      (($# >= 2)) || fail "--branch requires a branch name"
      TARGET_BRANCH="$2"
      shift 2
      ;;
    --branch=*)
      TARGET_BRANCH="${1#*=}"
      shift
      ;;
    --message)
      (($# >= 2)) || fail "--message requires text"
      COMMIT_MESSAGE="$2"
      shift 2
      ;;
    --message=*)
      COMMIT_MESSAGE="${1#*=}"
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
    *)
      fail "unknown option: $1 (use --help for usage)"
      ;;
  esac
done

is_positive_integer "$INTERVAL_SECONDS" || fail "interval must be a positive integer"
[[ -n "$REMOTE_NAME" ]] || fail "remote name cannot be empty"
[[ -n "$TARGET_BRANCH" ]] || fail "branch name cannot be empty"
[[ -n "$COMMIT_MESSAGE" ]] || fail "commit message cannot be empty"

command -v git >/dev/null 2>&1 || fail "git is not installed"

if [[ -n "$REPO_DIR" ]]; then
  cd "$REPO_DIR"
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "not inside a Git repository"
cd "$REPO_ROOT"

CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
[[ "$CURRENT_BRANCH" == "$TARGET_BRANCH" ]] || fail "current branch is '$CURRENT_BRANCH', expected '$TARGET_BRANCH'"
git remote get-url "$REMOTE_NAME" >/dev/null 2>&1 || fail "Git remote '$REMOTE_NAME' does not exist"

GIT_DIR="$(git rev-parse --git-dir)"
LOCK_DIR="$GIT_DIR/auto-push.lock"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  LOCK_PID="$(<"$LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ -n "$LOCK_PID" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
    fail "another auto-push process is running (pid $LOCK_PID)"
  fi
  fail "lock exists at $LOCK_DIR; remove it only after confirming no auto-push process is running"
fi
printf '%s\n' "$$" > "$LOCK_DIR/pid"
cleanup() {
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

has_worktree_changes() {
  [[ -n "$(git status --porcelain --untracked-files=all)" ]]
}

stage_changes() {
  local -a pathspecs=(
    "."
    ":(exclude).env"
    ":(exclude).env.*"
    ":(exclude)**/.env"
    ":(exclude)**/.env.*"
    ":(exclude)**/*.pem"
    ":(exclude)**/*.key"
    ":(exclude)**/cookies.json"
    ":(exclude)**/storage-state.json"
    ":(exclude)**/auth-state.json"
  )

  if [[ "${AUTO_PUSH_INCLUDE_RUNTIME_DATA:-0}" != "1" ]]; then
    pathspecs+=(
      ":(exclude)data/simcompanies.sqlite"
      ":(exclude)data/simcompanies.sqlite-shm"
      ":(exclude)data/simcompanies.sqlite-wal"
    )
  fi

  git add -A -- "${pathspecs[@]}"
}

push_pending_commits() {
  local remote_ref="refs/remotes/${REMOTE_NAME}/${TARGET_BRANCH}"

  if git show-ref --verify --quiet "$remote_ref"; then
    local ahead_count
    ahead_count="$(git rev-list --count "${REMOTE_NAME}/${TARGET_BRANCH}..HEAD")"
    ((ahead_count > 0)) || return 0
  fi

  log "pushing HEAD to $REMOTE_NAME/$TARGET_BRANCH"
  if ! git push "$REMOTE_NAME" "HEAD:$TARGET_BRANCH"; then
    log "push failed; local commits are preserved and will be retried"
    return 1
  fi
  log "push completed"
}

push_changes_once() {
  if ! has_worktree_changes; then
    if push_pending_commits; then
      log "no worktree changes and no pending commits"
    fi
    return 0
  fi

  if [[ "$DRY_RUN" == true ]]; then
    log "dry-run: changes detected; no files were staged or committed"
    git status --short
    return 0
  fi

  if ! stage_changes; then
    log "git add failed; changes remain unstaged"
    return 1
  fi
  if git diff --cached --quiet; then
    log "only excluded files changed; nothing to commit"
    push_pending_commits
    return $?
  fi

  if ! git diff --cached --check; then
    log "staged diff contains whitespace errors; commit was not created"
    return 1
  fi

  if [[ -n "${AUTO_PUSH_VERIFY_COMMAND:-}" ]]; then
    log "running AUTO_PUSH_VERIFY_COMMAND"
    if ! bash -lc "$AUTO_PUSH_VERIFY_COMMAND"; then
      log "verification failed; commit was not created"
      return 1
    fi
  fi

  log "committing staged changes"
  if ! git commit -m "$COMMIT_MESSAGE"; then
    log "commit failed; staged changes are preserved"
    return 1
  fi
  push_pending_commits
}

log "watching $REPO_ROOT on $REMOTE_NAME/$TARGET_BRANCH every ${INTERVAL_SECONDS}s"

while true; do
  if ! push_changes_once; then
    if [[ "$RUN_ONCE" == true ]]; then
      exit 1
    fi
    log "cycle failed; retrying after ${INTERVAL_SECONDS}s"
  fi
  [[ "$RUN_ONCE" == true ]] && break
  sleep "$INTERVAL_SECONDS"
done
