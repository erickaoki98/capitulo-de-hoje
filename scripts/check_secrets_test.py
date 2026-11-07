"""Self-contained synthetic Git cases; never reads project credentials."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile

SCANNER = Path(__file__).with_name("check_secrets.py")
spec = importlib.util.spec_from_file_location("scanner_under_test", SCANNER)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


def token(role):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
    return encode({"alg": "HS256", "typ": "JWT"}) + "." + encode({"role": role, "iss": "supabase"}) + "." + "x" * 43


def main():
    assert "supabase-service-role-jwt" in scanner.kinds(token("service_role"))
    assert not scanner.kinds(token("anon"))
    assert scanner.kinds('FAL_KEY="' + "a" * 32 + '"')
    assert not scanner.kinds("OPENAI_API_KEY=process.env.OPENAI_API_KEY")
    assert not scanner.kinds("OPENAI_API_KEY=your_real_key_placeholder")
    with tempfile.TemporaryDirectory(prefix="secret-check-test-") as folder:
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=folder, stderr=subprocess.DEVNULL, text=True).strip()
        def run(*args, env=None):
            return subprocess.run(["python3", str(SCANNER), *args], cwd=folder, capture_output=True, text=True, env=env)
        git("init", "-b", "main")
        git("config", "user.name", "Scanner Test")
        git("config", "user.email", "scanner@example.invalid")
        sample = Path(folder) / "sample.txt"
        sample.write_text(token("service_role"))
        git("add", ".")
        git("commit", "-qm", "legacy")
        baseline = git("rev-parse", "HEAD")
        sample.write_text("clean\n")
        git("add", ".")
        git("commit", "-qm", "remove legacy")
        assert run("--base", baseline).returncode == 0
        assert run("--all-history").returncode == 1
        sample.write_text(token("anon"))
        git("add", ".")
        assert run("--staged").returncode == 0
        git("commit", "-qm", "public anon")
        sample.write_text(token("service_role"))
        git("add", ".")
        result = run("--staged")
        assert result.returncode == 1
        assert token("service_role") not in result.stdout
        git("commit", "-qm", "new secret")
        sample.write_text("clean\n")
        git("add", ".")
        git("commit", "-qm", "remove new secret")
        assert run("--base", baseline).returncode == 1
        event = Path(folder) / "event.json"
        event.write_text(json.dumps({"before": "0" * 40, "ref": "refs/heads/main", "repository": {"default_branch": "main"}}))
        environment = {**os.environ, "GITHUB_EVENT_PATH": str(event), "GITHUB_EVENT_NAME": "push"}
        assert run("--event", env=environment).returncode == 1
        assert run("--base", "invalid-ref").returncode == 2
        # New-branch event: default-branch legacy history is the baseline.
        git("update-ref", "refs/remotes/origin/main", baseline)
        event.write_text(json.dumps({"before": "0" * 40, "ref": "refs/heads/security", "repository": {"default_branch": "main"}}))
        assert run("--event", env=environment).returncode == 1
        # A PR is checked against the actual base commit, not only its final diff.
        event.write_text(json.dumps({"pull_request": {"base": {"sha": baseline}}}))
        environment["GITHUB_EVENT_NAME"] = "pull_request"
        assert run("--event", env=environment).returncode == 1
    print("PASS: provider/JWT detection, public anon/placeholder exceptions, historical baseline, staged changes, transient secret, first push, new branch, PR, fail-closed, redaction.")


if __name__ == "__main__":
    main()
