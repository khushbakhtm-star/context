"""Secretless diagnostics for a fixed public source release; never publishes an app."""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
import time
import zipfile

APP_ID = "com.context.minuteledger"
SOURCE = "eae2abdb22afb092c273acef4e60cbdb17c2743f"
REPO = "https://github.com/khushbakhtm-star/context"
CATALOG = "dbd57558e5e687a018116b4242c42dd52d00124a"
EXPO_TEMPLATE_SHA = "fd958ca9b434d114ccc70c010d5404b537d49cd6ff09e239c917793ef4872991"


class Diagnostics:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.reports = self.root / "reports"
        self.reports.mkdir(parents=True, exist_ok=True)
        self.results: list[dict] = []

    def run(self, name, command, cwd, *, timeout=5400, expected=(0,)):
        started = time.monotonic()
        stdout = self.reports / f"{name}.stdout.txt"
        stderr = self.reports / f"{name}.stderr.txt"
        print(f"Running {name}: {' '.join(map(str, command))}", flush=True)
        with stdout.open("wb") as out, stderr.open("wb") as err:
            process = subprocess.Popen(list(map(str, command)), cwd=cwd,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       start_new_session=True)
            def pump(stream, destination, label):
                for line in iter(stream.readline, b""):
                    destination.write(line)
                    destination.flush()
                    text = line.decode(errors="replace").rstrip()
                    print(f"[{name}:{label}] {text[:3000]}" +
                          (" [full line retained in artifact]" if len(text) > 3000 else ""), flush=True)
            threads = [threading.Thread(target=pump, args=(process.stdout, out, "stdout"), daemon=True),
                       threading.Thread(target=pump, args=(process.stderr, err, "stderr"), daemon=True)]
            for thread in threads:
                thread.start()
            try:
                status = process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                if os.name == "posix":
                    os.killpg(process.pid, signal.SIGKILL)
                else:
                    process.kill()
                process.wait()
                status = 124
                err.write(b"\nDiagnostic command timed out.\n")
            for thread in threads:
                thread.join(timeout=10)
        record = {"name": name, "command": list(map(str, command)), "exitCode": status,
                  "expectedExitCodes": list(expected), "successful": status in expected,
                  "seconds": round(time.monotonic() - started, 2),
                  "stdout": stdout.name, "stderr": stderr.name}
        self.results.append(record)
        self.save()
        print(f"{name}: exit {status}; logs retained in {self.reports}", flush=True)
        for log in (stdout, stderr):
            lines = log.read_text(errors="replace").splitlines()
            if lines:
                print(f"--- {log.name}: final 35 lines ---\n" + "\n".join(lines[-35:]), flush=True)
        return record["successful"]

    def save(self):
        (self.reports / "results.json").write_text(json.dumps(self.results, indent=2) + "\n")

    def config(self, directory):
        import yaml
        directory.mkdir(parents=True, exist_ok=True)
        sdk = Path(os.environ["ANDROID_HOME"])
        config = {"sdk_path": str(sdk), "java_paths": {"17": os.environ["JAVA_HOME"]},
                  "gradle": str(self.root / "gradle-9.4.1/bin/gradle"),
                  "ndk_paths": {"27.1.12297006": str(sdk / "ndk/27.1.12297006")},
                  "cachedir": str(self.root / "cache"), "cachedir_scanner": str(self.root / "cache/scanner")}
        (directory / "config.yml").write_text(yaml.safe_dump(config, sort_keys=False))

    def provenance(self, source):
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
        if commit != SOURCE or os.environ.get("CONTEXT_SOURCE_COMMIT") != SOURCE:
            raise ValueError("Refusing to verify a different or mutable source commit")
        for name, command in [("python-version", [sys.executable, "--version"]),
                              ("fdroid-version", ["fdroid", "--version"]),
                              ("node-version", ["node", "--version"]),
                              ("corepack-version", ["corepack", "--version"]),
                              ("pnpm-version", ["corepack", "pnpm", "--version"]),
                              ("java-version", ["java", "-version"]),
                              ("gradle-version", [self.root / "gradle-9.4.1/bin/gradle", "--version"])]:
            self.run(name, command, source, timeout=120)
        data = {"sourceRepository": REPO, "sourceCommit": commit, "fdroidserverVersion": "2.4.5",
                "fdroidserverSourceCommit": "92229a9152a31d005503bac64d773551f0655494",
                "fdroidserverSdistSha256": os.environ["FDROID_SERVER_SHA256"], "fdroiddataConfigCommit": CATALOG,
                "gradleDistributionSha256": os.environ["GRADLE_SHA256"],
                "runnerImage": os.environ.get("ImageVersion"),
                "notice": "GitHub Ubuntu diagnostics, not F-Droid's official build-server image or acceptance."}
        (self.reports / "provenance.json").write_text(json.dumps(data, indent=2) + "\n")

    def signature_evidence(self):
        cache = self.root / "cache"
        hashes = {}
        if cache.exists():
            for file in cache.rglob("*.json"):
                if file.is_file() and file.stat().st_size <= 16 * 1024 * 1024:
                    relative = file.relative_to(cache)
                    hashes[str(relative)] = hashlib.sha256(file.read_bytes()).hexdigest()
                    target = self.reports / "scanner-cache" / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(file, target)
        (self.reports / "scanner-cache-sha256.json").write_text(json.dumps(hashes, indent=2) + "\n")


def checked_candidate(path):
    import yaml
    raw = path.read_text()
    app = yaml.safe_load(raw)
    builds = app.get("Builds", [])
    if (app.get("Repo") != REPO or app.get("RepoType") != "git" or len(builds) != 1 or
        builds[0].get("commit") != SOURCE or builds[0].get("versionCode") != 1 or
        builds[0].get("versionName") != "0.1.0" or not builds[0].get("disable")):
        raise ValueError("Candidate must remain disabled and point at the exact public 0.1.0 source release")
    if any(builds[0].get(key) for key in ("scanignore", "scandelete")):
        raise ValueError("This diagnostic does not allow scanner exclusions")
    return raw, app


def metadata_checks(diag, candidate):
    import yaml
    raw, app = checked_candidate(candidate)
    (diag.reports / "original-disabled-candidate.yml").write_text(raw)
    catalog = diag.root / "catalog"
    catalog.mkdir()
    for name, args in [("catalog-init", ["git", "init"]),
                       ("catalog-remote", ["git", "remote", "add", "origin", "https://gitlab.com/fdroid/fdroiddata.git"]),
                       ("catalog-sparse", ["git", "sparse-checkout", "set", "--cone", "config"]),
                       ("catalog-fetch", ["git", "fetch", "--depth=1", "--filter=blob:none", "origin", CATALOG]),
                       ("catalog-checkout", ["git", "checkout", "--detach", "FETCH_HEAD"])]:
        if not diag.run(name, args, catalog, timeout=600):
            return
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=catalog, text=True).strip() != CATALOG:
        raise ValueError("Catalog checkout does not match its pinned commit")
    for directory in (diag.root / "metadata-check", diag.root / "integrated-check"):
        diag.config(directory)
        shutil.copytree(catalog / "config", directory / "config")
        (directory / "metadata").mkdir()
        (directory / "metadata" / f"{APP_ID}.yml").write_text(raw)
    scratch = diag.root / "metadata-check"
    diag.run("metadata-lint", ["fdroid", "lint", APP_ID], scratch)
    diag.run("source-scanner", ["fdroid", "scanner", "--force", "--exit-code", "--json", f"{APP_ID}:1"], scratch,
             timeout=1800)
    android = scratch / "build" / APP_ID / "apps/mobile/android"
    wrappers = {name: (android / name).exists() for name in
                ("gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.jar")}
    (diag.reports / "post-scanner-wrapper-state.json").write_text(json.dumps(wrappers, indent=2) + "\n")
    (diag.reports / "recipe-wrapper-issue.txt").write_text(
        "Original candidate manually invokes ./gradlew. fdroidserver removes wrappers during source scanning.\n"
        "Consequently that build command needs an approved pinned system Gradle command before the recipe can work.\n"
        "Independent native assembly below uses Gradle 9.4.1 directly and does not prove this original recipe.\n")
    # Normal F-Droid build, with only its disabled flag removed in an ephemeral copy.
    # No --force, --skip-scan, scanignore, or scandelete; scanner findings stop this build normally.
    original = json.loads(json.dumps(app))
    del app["Builds"][0]["disable"]
    expected = json.loads(json.dumps(original))
    del expected["Builds"][0]["disable"]
    if app != expected:
        raise ValueError("Unexpected metadata transformation")
    enabled = yaml.safe_dump(app, sort_keys=False, allow_unicode=True)
    integrated = diag.root / "integrated-check"
    (integrated / "metadata" / f"{APP_ID}.yml").write_text(enabled)
    (diag.reports / "ephemeral-build-candidate.yml").write_text(enabled)
    (diag.reports / "ephemeral-candidate.diff").write_text("".join(difflib.unified_diff(
        raw.splitlines(keepends=True), enabled.splitlines(keepends=True),
        fromfile="original-disabled-candidate", tofile="ephemeral-enabled-copy")))
    diag.run("integrated-fdroid-build", ["fdroid", "build", "--test", "--stop", "--scan-binary", f"{APP_ID}:1"], integrated,
             timeout=3600)


def native_checks(diag, source):
    mobile = source / "apps/mobile"
    env = os.environ
    if env.get("EXPO_PUBLIC_CONTEXT_DISTRIBUTION") != "fdroid" or env.get("CONTEXT_FDROID_SOURCE_BUILD") != "1":
        raise ValueError("The independent native build must use the F-Droid source edition")
    commands = [("foss-prepare", ["node", "scripts/prepare-fdroid.cjs", "--apply"]),
                ("locked-install", ["corepack", "pnpm", "install", "--frozen-lockfile", "--ignore-scripts"])]
    for name, command in commands:
        if not diag.run(name, command, mobile):
            return
    template = mobile / "node_modules/expo/template.tgz"
    if hashlib.sha256(template.read_bytes()).hexdigest() != EXPO_TEMPLATE_SHA:
        raise ValueError("The locked Expo native template does not match its recorded digest")
    (diag.reports / "expo-template-sha256.txt").write_text(EXPO_TEMPLATE_SHA + "\n")
    if not diag.run("expo-prebuild", ["corepack", "pnpm", "exec", "expo", "prebuild", "--platform", "android",
                                      "--no-install", "--template", str(template)], mobile):
        return
    if not diag.run("unsigned-prepare", ["node", "scripts/prepare-fdroid.cjs", "--unsigned-android"], mobile):
        return
    android = mobile / "android"
    wrapper = (android / "gradle/wrapper/gradle-wrapper.properties").read_text()
    (diag.reports / "generated-gradle-wrapper.properties").write_text(wrapper)
    if "gradle-9.4.1-bin.zip" not in wrapper:
        raise ValueError("Generated native project requests an unexpected Gradle distribution")
    gradle = diag.root / "gradle-9.4.1/bin/gradle"
    if not diag.run("independent-unsigned-assembly", [gradle, "--no-daemon", "assembleRelease"], android):
        return
    apk = android / "app/build/outputs/apk/release/app-release-unsigned.apk"
    if not apk.is_file():
        raise ValueError("Gradle did not produce the expected unsigned APK")
    with zipfile.ZipFile(apk) as archive:
        if "AndroidManifest.xml" not in archive.namelist() or archive.testzip() is not None:
            raise ValueError("APK archive is invalid")
    sdk = Path(env["ANDROID_HOME"])
    if not diag.run("apk-identity", [sdk / "build-tools/37.0.0/aapt2", "dump", "badging", apk], mobile):
        return
    identity = (diag.reports / "apk-identity.stdout.txt").read_text()
    if f"name='{APP_ID}'" not in identity or "versionCode='1'" not in identity or "versionName='0.1.0'" not in identity:
        raise ValueError("APK identity differs from the immutable source release")
    if not diag.run("unsigned-signature-check", [sdk / "build-tools/37.0.0/apksigner", "verify", "--verbose", apk], mobile,
                    expected=(1,)):
        return
    copied = diag.reports / "context-0.1.0-unsigned-diagnostic.apk"
    shutil.copyfile(apk, copied)
    (diag.reports / "unsigned-apk-sha256.txt").write_text(hashlib.sha256(apk.read_bytes()).hexdigest() + "\n")
    binary_root = diag.root / "binary-check"
    diag.config(binary_root)
    diag.run("binary-scanner", ["fdroid", "scanner", "--exit-code", str(apk)], binary_root)
    (diag.reports / "native-scope.txt").write_text(
        "Independent unsigned native assembly from the source tag using pinned Gradle, plus APK binary scan.\n"
        "This is not an official F-Droid build, accepted recipe, signed installable release, or physical-phone test.\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("metadata", "native"))
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    diag = Diagnostics(args.root)
    try:
        diag.provenance(args.source.resolve())
        if args.mode == "metadata":
            metadata_checks(diag, args.candidate.resolve())
        else:
            native_checks(diag, args.source.resolve())
    except Exception as error:
        (diag.reports / "tooling-error.txt").write_text(f"{type(error).__name__}: {error}\n")
        print(f"Diagnostic tooling error: {error}", file=sys.stderr, flush=True)
        return 1
    finally:
        diag.signature_evidence()
        diag.save()
    return 0 if diag.results and all(result["successful"] for result in diag.results) else 1


if __name__ == "__main__":
    sys.exit(main())
