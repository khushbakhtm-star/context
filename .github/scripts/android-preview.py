"""Build evidence for a pinned unsigned Wear-enabled phone; never accesses signing keys."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import zipfile

SOURCE = "4c92502370158dfd7422471d17ffff9c5e15f87f"
VERSION = "0.1.13"
CODE = 14
APP_ID = "com.context.minuteledger"
MARKER = "// Context unsigned Wear-phone preview: local publisher signing is separate"
NATIVE_RULE_MARKER = "# Context audited native module identities for packaging verification"
NATIVE_MODULES = (
    "expo.modules.print.PrintModule",
    "expo.modules.sharing.SharingModule",
    "expo.modules.contextcalendarcolors.ContextCalendarColorsModule",
)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(command, cwd=None, expected=0):
    result = subprocess.run([str(item) for item in command], cwd=cwd, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode != expected:
        raise ValueError(f"{Path(str(command[0])).name} returned {result.returncode}; expected {expected}")
    return result.stdout


def source_identity(source):
    if run(["git", "rev-parse", "HEAD"], source).strip() != SOURCE:
        raise ValueError("Source checkout is not the one reviewed immutable commit")
    mobile = source / "apps/mobile"
    app = json.loads((mobile / "app.json").read_text())["expo"]
    package = json.loads((mobile / "package.json").read_text())
    plan = json.loads((source / ".github/release-plan.json").read_text())
    if (app["version"] != VERSION or package["version"] != VERSION or
            app["android"]["package"] != APP_ID or app["android"]["versionCode"] != CODE or
            app["ios"]["buildNumber"] != str(CODE) or plan["version"] != VERSION or
            plan["sourceAndroidVersionCode"] != CODE or plan["sourceIosBuildNumber"] != str(CODE)):
        raise ValueError("Source version/native identities do not match the pinned preview")
    wanted = {"EXPO_PUBLIC_CONTEXT_DISTRIBUTION": "store",
              "EXPO_PUBLIC_CONTEXT_RELEASE_CHANNEL": "standalone-wear",
              "EAS_BUILD_PROFILE": "wear-phone-preview", "EAS_BUILD_PLATFORM": "android",
              "CONTEXT_REQUIRE_GOOGLE_OAUTH": "1"}
    if any(os.environ.get(key) != value for key, value in wanted.items()) or os.environ.get("CONTEXT_WEAR_BUILD"):
        raise ValueError("Expected the Google/Wear phone environment, without the pure-watch build flag")
    return mobile


def unsigned_gradle(text):
    if "com.android.application" not in text or MARKER in text:
        raise ValueError("Unexpected or already-patched generated Android app Gradle file")
    return text + "\n" + MARKER + "\nandroid {\n    buildTypes {\n        release {\n            signingConfig = null\n        }\n    }\n}\n"


def has_signing_block(data):
    end = data.rfind(b"PK\x05\x06", max(0, len(data) - 65557))
    if end < 0 or end + 22 > len(data):
        raise ValueError("Missing ZIP footer")
    central = struct.unpack_from("<I", data, end + 16)[0]
    return central >= 24 and data[central - 16:central] == b"APK Sig Block 42"


def contains(data, text):
    return text.encode("utf-8") in data or text.encode("utf-16le") in data


def native_identity_rules(text):
    if NATIVE_RULE_MARKER in text:
        raise ValueError("Audited native module rules are already present")
    # Expo core permits Module subclasses to be obfuscated. Preserve only these
    # audited identities so actual DEX checks do not mistake renamed code for absence.
    rules = "\n".join(f"-keep class {module} {{ *; }}" for module in NATIVE_MODULES)
    return text.rstrip() + "\n\n" + NATIVE_RULE_MARKER + "\n" + rules + "\n"


def prepare(source, reports):
    mobile = source_identity(source)
    target = mobile / "android/app/build.gradle"
    original = target.read_text()
    patched = unsigned_gradle(original)
    target.write_text(patched)
    proguard = mobile / "android/app/proguard-rules.pro"
    original_rules = proguard.read_text()
    audited_rules = native_identity_rules(original_rules)
    proguard.write_text(audited_rules)
    (reports / "audited-native-proguard-rules.pro").write_text(audited_rules)
    receipt = {"schemaVersion": 1, "status": "prepared-not-built", "sourceCommit": SOURCE,
               "controllerCommit": os.environ.get("GITHUB_SHA"), "version": VERSION,
               "androidVersionCode": CODE, "applicationId": APP_ID, "distribution": "store",
               "releaseChannel": "standalone-wear", "signing": "disabled; no key supplied to CI",
               "originalGeneratedGradleSha256": sha(original.encode()),
               "unsignedGeneratedGradleSha256": sha(patched.encode()),
               "originalProguardRulesSha256": sha(original_rules.encode()),
               "auditedProguardRulesSha256": sha(audited_rules.encode()),
               "preservedNativeModuleIdentities": list(NATIVE_MODULES),
               "lockfileSha256": sha((mobile / "pnpm-lock.yaml").read_bytes()),
               "scope": "Unsigned build only; not signed, installed, or publicly released."}
    return receipt


def verify(source, reports, receipt):
    mobile = source_identity(source)
    if receipt.get("sourceCommit") != SOURCE or receipt.get("status") != "prepared-not-built":
        raise ValueError("Missing exact-source unsigned preparation receipt")
    if receipt["lockfileSha256"] != sha((mobile / "pnpm-lock.yaml").read_bytes()):
        raise ValueError("The frozen lockfile changed during the native build")
    if receipt.get("auditedProguardRulesSha256") != sha((mobile / "android/app/proguard-rules.pro").read_bytes()):
        raise ValueError("The audited native module rules changed during the build")
    tools = Path(os.environ["ANDROID_HOME"]) / "build-tools/37.0.0"
    original = mobile / "android/app/build/outputs/apk/release/app-release-unsigned.apk"
    apk = reports / "context-0.1.13-wear-phone-unsigned.apk"
    run([tools / "zipalign", "-P", "16", "-f", "4", original, apk])
    run([tools / "zipalign", "-c", "-P", "16", "-v", "4", apk])
    data = apk.read_bytes()
    if has_signing_block(data):
        raise ValueError("Unexpected APK signing block; refusing a debug/publisher-signed CI artifact")
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if archive.testzip() is not None or "AndroidManifest.xml" not in names:
            raise ValueError("APK ZIP integrity failed")
        if any(re.match(r"^META-INF/[^/]+\.(?:SF|RSA|DSA|EC)$", name, re.I) for name in names):
            raise ValueError("Unexpected v1/JAR signature in an intended unsigned artifact")
        config = json.loads(archive.read("assets/app.config"))
        if (config.get("version") != VERSION or config.get("android", {}).get("versionCode") != CODE or
                config.get("android", {}).get("package") != APP_ID or
                config.get("extra", {}).get("distribution") != "store"):
            raise ValueError("Embedded phone configuration differs from the expected store edition")
        bundle = archive.read("assets/index.android.bundle")
        clients = {}
        for key in ("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID", "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID"):
            value = os.environ.get(key, "")
            if not value or not contains(bundle, value):
                raise ValueError(f"Configured {key} was not found in the actual application bundle")
            clients[key] = {"presentInBundle": True, "sha256": sha(value.encode())}
        if not contains(bundle, "standalone-wear"):
            raise ValueError("Actual bundle is missing the Wear-phone update channel")
        dex = b"".join(archive.read(name) for name in names if re.match(r"^classes\d*\.dex$", name))
        for marker in (b"ContextWear", b"setEnabledAsync", b"scanPendingAsync",
                       b"Lcom/google/android/gms/auth/api/signin/"):
            if marker not in dex:
                raise ValueError("Actual Wear/Google native module marker missing")
        native_markers = {
            "printNativeMarkerVerified": b"Lexpo/modules/print/PrintModule;",
            "sharingNativeMarkerVerified": b"Lexpo/modules/sharing/SharingModule;",
            "calendarColorNativeMarkerVerified": b"Lexpo/modules/contextcalendarcolors/ContextCalendarColorsModule;",
        }
        for name, marker in native_markers.items():
            if marker not in dex:
                raise ValueError(f"Actual native module descriptor is missing: {name}")
    identity = run([tools / "aapt2", "dump", "badging", apk])
    wanted = f"package: name='{APP_ID}' versionCode='{CODE}' versionName='{VERSION}'"
    if wanted not in identity:
        raise ValueError("Actual native APK package/version differs from the source identities")
    (reports / "native-package-identity.txt").write_text(identity)
    negative = run([tools / "apksigner", "verify", "--verbose", apk], expected=1)
    (reports / "expected-unsigned-signature-check.txt").write_text(negative)
    receipt.update({"status": "unsigned-build-verified", "finishedAt": datetime.now(timezone.utc).isoformat(),
                    "apk": {"filename": apk.name, "bytes": len(data), "sha256": sha(data)},
                    "zipIntegrity": True, "zipAlignment": "16 KB native libraries; checked before signing",
                    "nativeIdentityVerified": True, "noApkSigningBlock": True, "noJarSignature": True,
                    "apksignerExpectedUnsignedExit": 1, "googleClientIds": clients,
                    "wearAndGoogleNativeMarkers": True,
                    **{name: True for name in native_markers}, "bundleSha256": sha(bundle),
                    "scope": "Unsigned aligned APK only. Publisher signing, signature verification and phone Google sign-in testing remain separate. No Expo/EAS build service or signing credential was used."})
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("prepare", "verify"))
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--reports", type=Path, required=True)
    args = parser.parse_args()
    source, reports = args.source.resolve(), args.reports.resolve()
    reports.mkdir(parents=True, exist_ok=True)
    path = reports / "build-receipt.json"
    receipt = json.loads(path.read_text()) if path.exists() else {}
    try:
        receipt = prepare(source, reports) if args.mode == "prepare" else verify(source, reports, receipt)
    except Exception as error:
        # A failed verifier may have produced an aligned intermediate. Retain diagnostics,
        # but never let upload-artifact expose that APK as a usable unsigned build.
        if args.mode == "verify":
            (reports / "context-0.1.13-wear-phone-unsigned.apk").unlink(missing_ok=True)
        receipt.update({"status": "failed", "scope": "Not a verified build; never install or publish this output.",
                        "error": str(error)})
        path.write_text(json.dumps(receipt, indent=2) + "\n")
        raise
    path.write_text(json.dumps(receipt, indent=2) + "\n")
    print(f"Context preview evidence: {receipt['status']} ({SOURCE})")


if __name__ == "__main__":
    main()
