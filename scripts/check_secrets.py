#!/usr/bin/env python3
"""Scan new Git additions locally/CI; never print secret values or call providers."""
import argparse
import base64
import json
import os
import re
import subprocess
import sys

PATTERNS = {
    "private-key": r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----",
    "github-token": r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b",
    "supabase-secret": r"\bsb_secret_[A-Za-z0-9_-]{20,}",
    "supabase-access-token": r"\bsbp_[A-Za-z0-9_-]{20,}\b",
    "openai-anthropic-token": r"\bsk-(?:proj-|admin-|ant-)?[A-Za-z0-9_-]{20,}",
    "google-api-key": r"\bAIza[0-9A-Za-z_-]{35}\b",
    "stripe-secret": r"\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b",
    "resend-key": r"\bre_[A-Za-z0-9]{20,}\b",
}
COMPILED = {name: re.compile(pattern) for name, pattern in PATTERNS.items()}
JWT = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
ASSIGNMENT = re.compile(
    r"\b(?:[A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET_KEY|SERVICE_ROLE_KEY|SERVICE_KEY|PASSWORD)|FAL_KEY)"
    r"[\"']?\s*[:=]\s*[\"']?([A-Za-z0-9_+/.=-]{20,})"
)
PLACEHOLDER = re.compile(r"(?i)^(?:your[_-]|example|placeholder|replace|changeme|process\.|Deno\.|import\.|secrets\.|env\.)")


def kinds(line):
    found = {name for name, pattern in COMPILED.items() if pattern.search(line)}
    for token in JWT.findall(line):
        try:
            payload = token.split(".")[1]
            data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            if isinstance(data, dict) and data.get("role") == "service_role":
                found.add("supabase-service-role-jwt")
        except (ValueError, TypeError, UnicodeDecodeError):
            pass
    for value in ASSIGNMENT.findall(line):
        if not PLACEHOLDER.search(value):
            found.add("hardcoded-secret-assignment")
    return sorted(found)


def git(*args):
    result = subprocess.run(["git", "--no-pager", *args], capture_output=True)
    if result.returncode:
        # Git errors may include sensitive paths/content: fail without echoing them.
        raise RuntimeError("Git could not read the requested revision or diff.")
    return result.stdout.decode("utf-8", errors="replace")


def revision(ref):
    return git("rev-parse", "--verify", "--end-of-options", ref + "^{commit}").strip()


def scan_patch(patch, label):
    path, line_number, failures, in_hunk = "(unknown)", 0, 0, False
    for line in patch.splitlines():
        if line.startswith("diff --git "):
            in_hunk = False
        elif line.startswith("+++ ") and not in_hunk:
            path = line[4:]
            if path.startswith("b/"):
                path = path[2:]
        elif line.startswith("@@ "):
            in_hunk = True
            match = re.search(r"\+(\d+)", line)
            if match:
                line_number = int(match.group(1))
        elif line.startswith("+"):
            for kind in kinds(line[1:]):
                # JSON escapes filenames/control characters; no line content is emitted.
                print(f"BLOCKED {kind}: {json.dumps(path)}:{line_number} ({label})")
                failures += 1
            line_number += 1
        elif line.startswith(" "):
            line_number += 1
    return failures


def event_base():
    with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as stream:
        event = json.load(stream)
    if os.environ.get("GITHUB_EVENT_NAME") == "pull_request":
        return event["pull_request"]["base"]["sha"]
    before = event.get("before", "")
    if before and set(before) != {"0"}:
        return before
    branch = event.get("repository", {}).get("default_branch", "main")
    if event.get("ref") == "refs/heads/" + branch:
        # First-ever push to the default branch must scan its whole ancestry.
        return None
    # A new branch starts from the existing default branch, not all legacy history.
    return git("merge-base", "HEAD", "refs/remotes/origin/" + branch).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--staged", action="store_true")
    mode.add_argument("--base", help="scan every new commit since this ancestor")
    mode.add_argument("--event", action="store_true", help="derive base from GitHub push/PR event")
    mode.add_argument("--all-history", action="store_true", help="audit legacy history too; not the CI baseline")
    options = parser.parse_args()
    try:
        if options.staged:
            patch = git("diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=0", "--")
            failures = scan_patch(patch, "staged")
        else:
            event_ancestor = event_base() if options.event else None
            if options.all_history or (options.event and event_ancestor is None):
                commits = git("rev-list", "--reverse", "--all" if options.all_history else "HEAD").splitlines()
            else:
                base = revision(event_ancestor if options.event else options.base)
                head = revision("HEAD")
                ancestor = subprocess.run(["git", "merge-base", "--is-ancestor", base, head], capture_output=True)
                if ancestor.returncode:
                    raise RuntimeError("Base is not an ancestor of HEAD; choose a reviewed ancestor.")
                commits = git("rev-list", "--reverse", base + ".." + head).splitlines()
            failures = 0
            for commit in commits:
                parents = git("rev-list", "--parents", "-n", "1", commit).split()
                if len(parents) > 1:
                    patch = git("diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=0", parents[1], commit, "--")
                else:
                    patch = git("show", "--format=", "--root", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=0", commit, "--")
                failures += scan_patch(patch, commit[:12])
    except (RuntimeError, OSError, KeyError, ValueError):
        print("ERROR: secret check could not complete; nothing was approved.")
        return 2
    if failures:
        print(f"Secret check failed: {failures} finding(s). Values are never displayed. Remove new occurrences; rotate real exposed credentials.")
        return 1
    print("Secret check passed for the requested additions. Legacy history and provider validity are separate checks.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
