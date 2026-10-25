"""Secretless diagnostics for a fixed public source release; never publishes an app."""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
import time
import zipfile

APP_ID = "com.context.minuteledger"
REPO = "https://github.com/khushbakhtm-star/context"
CATALOG = "dbd57558e5e687a018116b4242c42dd52d00124a"
EXPO_TEMPLATE_SHA = "fd958ca9b434d114ccc70c010d5404b537d49cd6ff09e239c917793ef4872991"
HERMES_EXCEPTION = "apps/mobile/node_modules/.pnpm/hermes-compiler@260318099.0.4/node_modules/hermes-compiler/hermesc/linux64-bin/hermesc"


def source_pin():
    value = os.environ.get("CONTEXT_SOURCE_COMMIT", "")
    if not re.fullmatch(r"[a-f0-9]{40}", value):
        raise ValueError("CONTEXT_SOURCE_COMMIT must be a reviewed full immutable public commit hash")
    return value


def release_identity(source):
    config = json.loads((source / "apps/mobile/app.json").read_text())["expo"]
    version, code = config.get("version"), config.get("android", {}).get("versionCode")
    if config.get("android", {}).get("package") != APP_ID or not re.fullmatch(r"\d+\.\d+\.\d+", version or "") or type(code) is not int or code < 1:
        raise ValueError("Pinned source has invalid Context native release identity")
    return {"version": version, "versionCode": code}


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
        if commit != source_pin():
            raise ValueError("Refusing to verify a different or mutable source commit")
        self.release = release_identity(source)
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
                "release": self.release,
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


def checked_candidate(path, identity):
    import yaml
    raw = path.read_text()
    app = yaml.safe_load(raw)
    builds = app.get("Builds", [])
    if (app.get("Repo") != REPO or app.get("RepoType") != "git" or len(builds) != 1 or
        builds[0].get("commit") != source_pin() or builds[0].get("versionCode") != identity["versionCode"] or
        builds[0].get("versionName") != identity["version"] or not builds[0].get("disable")):
        raise ValueError("Disabled candidate must exactly match the immutable source commit and native version/code")
    if builds[0].get("scandelete") or builds[0].get("scanignore") != [HERMES_EXCEPTION]:
        raise ValueError("Only the exact documented, hash-verified official Hermes compiler exception is allowed")
    return raw, app


def source_scanner_summary(report, version_code):
    """2.4.5 forgets its source-mode nonzero exit; preserve and validate the actual JSON."""
    build = report.get(APP_ID, {}).get(str(version_code))
    if not isinstance(build, dict) or any(not isinstance(build.get(key), list) for key in ("errors", "warnings", "infos")):
        raise ValueError("Source scanner did not emit the expected structured findings")
    categories = {}
    for entry in build["errors"]:
        if not isinstance(entry, list) or not entry or not isinstance(entry[0], str):
            raise ValueError("Malformed source scanner error entry")
        categories[entry[0]] = categories.get(entry[0], 0) + 1
    return {"errorCount": len(build["errors"]), "warningCount": len(build["warnings"]),
            "infoCount": len(build["infos"]), "errorCategories": categories,
            "successful": not build["errors"],
            "notice": "fdroidserver 2.4.5 source mode can exit zero despite these errors; JSON findings determine this check."}


def bootstrap_build_checkout():
    """Work around the pinned server's pre-clone SOURCE_DATE_EPOCH bug through its own VCS API."""
    from fdroidserver import common, metadata
    parser = argparse.ArgumentParser()
    common.setup_global_opts(parser)
    metadata.add_metadata_arguments(parser)
    sys.argv = ["fdroid-checkout-bootstrap"]
    options = common.parse_args(parser)
    metadata.warnings_action = options.W
    common.get_config()
    app = metadata.parse_metadata(Path(f"metadata/{APP_ID}.yml"))
    build = app.Builds[0]
    if app.Repo != REPO or build.commit != source_pin():
        raise ValueError("Bootstrap candidate identity differs from the immutable source release")
    Path("build").mkdir(exist_ok=True)
    directory = common.get_build_dir(app)
    vcs = common.getvcs(app.RepoType, app.Repo, directory)
    vcs.gotorevision(build.commit)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=directory, text=True).strip()
    epoch = common.get_source_date_epoch(directory)
    if commit != source_pin() or not isinstance(epoch, str) or not epoch.isdigit():
        raise ValueError("F-Droid's own checkout bootstrap did not establish the expected source epoch")
    print(f"Official F-Droid VCS checkout prepared: {commit}, SOURCE_DATE_EPOCH={epoch}")


def metadata_checks(diag, candidate):
    import yaml
    raw, app = checked_candidate(candidate, diag.release)
    target = f"{APP_ID}:{diag.release['versionCode']}"
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
    diag.run("source-scanner", ["fdroid", "scanner", "--force", "--exit-code", "--json", target], scratch,
             timeout=1800)
    summary = source_scanner_summary(json.loads((diag.reports / "source-scanner.stdout.txt").read_text()), diag.release["versionCode"])
    (diag.reports / "source-scanner-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    diag.results.append({"name": "source-scanner-structured-findings", "type": "report-validation", **summary})
    diag.save()
    print(f"Source report contains {summary['errorCount']} errors and {summary['warningCount']} warnings; "
          "the scanner's raw exit code is preserved separately.", flush=True)
    android = scratch / "build" / APP_ID / "apps/mobile/android"
    wrappers = {name: (android / name).exists() for name in
                ("gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.jar")}
    (diag.reports / "post-scanner-wrapper-state.json").write_text(json.dumps(wrappers, indent=2) + "\n")
    audit = scratch / "build" / APP_ID / "apps/mobile/.context-fdroid-input-audit.json"
    if audit.exists():
        shutil.copyfile(audit, diag.reports / "source-input-audit.json")
    record_wear_pruning(diag, scratch / "build" / APP_ID / "apps/mobile", "source-wear-pruning.json")
    # Run the real recipe, with only disable removed in an ephemeral copy. The sole
    # compiler exception was strictly validated above; source errors still stop this build.
    original = json.loads(json.dumps(app))
    del app["Builds"][0]["disable"]
    original_command = "cd android && EXPO_PUBLIC_CONTEXT_DISTRIBUTION=fdroid gradle --no-daemon assembleRelease"
    if app["Builds"][0].get("build") != [original_command]:
        raise ValueError("The recipe must use pinned system Gradle rather than the removed wrapper")
    gradle = diag.root / "gradle-9.4.1/bin/gradle"
    if Path(shutil.which("gradle") or "").resolve() != gradle.resolve():
        raise ValueError("Proposed recipe requires the hash-verified Gradle 9.4.1 executable on PATH")
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
    if diag.run("integrated-checkout-bootstrap", [sys.executable, Path(__file__).resolve(), "bootstrap",
            "--root", diag.root], integrated, timeout=600):
        diag.run("integrated-fdroid-build", ["fdroid", "build", "--test", "--stop", "--scan-binary", target], integrated,
                 timeout=3600)


def record_wear_pruning(diag, mobile, report_name):
    inventory = json.loads((mobile / "fdroid/wear-source-inputs.json").read_text())
    prepared = json.loads((mobile / ".context-fdroid-prepared.json").read_text())
    expected = {item["path"]: item["sha256"] for item in inventory["files"]}
    removed = prepared.get("wearRemoved", [])
    actual = {item["path"]: item["sha256"] for item in removed}
    if not expected or len(actual) != len(removed) or actual != expected:
        raise ValueError("Optional Wear source pruning differs from its reviewed inventory")
    if any((mobile / relative).exists() for relative in expected):
        raise ValueError("An optional Wear source survived F-Droid preparation")
    (diag.reports / report_name).write_text(json.dumps({"count": len(removed), "removed": removed}, indent=2) + "\n")


def native_checks(diag, source):
    mobile = source / "apps/mobile"
    env = os.environ
    if env.get("EXPO_PUBLIC_CONTEXT_DISTRIBUTION") != "fdroid" or env.get("CONTEXT_FDROID_SOURCE_BUILD") != "1":
        raise ValueError("The independent native build must use the F-Droid source edition")
    commands = [("foss-prepare", ["node", "scripts/prepare-fdroid.cjs", "--apply"]),
                ("locked-install", ["corepack", "pnpm", "install", "--prod", "--frozen-lockfile", "--ignore-scripts"])]
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
    record_wear_pruning(diag, mobile, "native-wear-pruning.json")
    shutil.copyfile(mobile / ".context-fdroid-input-audit.json", diag.reports / "native-input-audit.json")
    shutil.copyfile(mobile / "android/gradle.properties", diag.reports / "source-gradle.properties")
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
    if f"name='{APP_ID}'" not in identity or f"versionCode='{diag.release['versionCode']}'" not in identity or f"versionName='{diag.release['version']}'" not in identity:
        raise ValueError("APK identity differs from the immutable source release")
    if not diag.run("unsigned-signature-check", [sdk / "build-tools/37.0.0/apksigner", "verify", "--verbose", apk], mobile,
                    expected=(1,)):
        return
    copied = diag.reports / f"context-{diag.release['version']}-unsigned-diagnostic.apk"
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
    parser.add_argument("mode", choices=("metadata", "native", "bootstrap"))
    parser.add_argument("--source", type=Path)
    parser.add_argument("--candidate", type=Path)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    if args.mode == "bootstrap":
        bootstrap_build_checkout()
        return 0
    if args.source is None or args.candidate is None:
        parser.error("metadata/native diagnostics require --source and --candidate")
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
