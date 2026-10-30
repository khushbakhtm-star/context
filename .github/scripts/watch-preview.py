"""Unsigned watch build controller. No key, token, credential or publisher access.

The application source pin is immutable; this controller has no publisher access.
Only generated watch Gradle signing is disabled; application source is untouched.
"""
from __future__ import annotations
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
import zlib
import xml.etree.ElementTree as ET

SOURCE = "0684437feca86ccda22198bf6050e27f1736fb1c"
VERSION = "0.1.14"
CODE = 100015
APP_ID = "com.context.minuteledger"
MARKER = "// Context unsigned watch preview: local publisher signing is separate"
CERTIFICATE = "44075039f7febaab9c6721a75cdc20be419ba93dea9c36c5db7b08e217617772"
MODULES = {
    "activity": "Lcom/context/minuteledger/wear/MinuteActivity;",
    "tile": "Lcom/context/minuteledger/wear/ContextTileService;",
    "tileLayout": "Lcom/context/minuteledger/wear/ContextTileLayout;",
    "transport": "Lcom/context/minuteledger/wear/WatchDataService;",
    "dictationPolicy": "Lcom/context/minuteledger/wear/DictationSavePolicy;",
    "speechDialog": "Lcom/context/minuteledger/wear/WatchDictationDialog;",
    "speechPolicy": "Lcom/context/minuteledger/wear/WatchDictationPolicy;",
    "pendingWork": "Lcom/context/minuteledger/wear/CoalescedPendingWork;",
    "noteDraft": "Lcom/context/minuteledger/wear/WatchDictationNote;",
    "silencePolicy": "Lcom/context/minuteledger/wear/WatchSilencePolicy;",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(command, cwd=None, expected=0):
    result = subprocess.run([str(item) for item in command], cwd=cwd, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode != expected:
        raise ValueError(f"{Path(str(command[0])).name} returned {result.returncode}; expected {expected}")
    return result.stdout


def source_identity(source):
    if not re.fullmatch(r"[a-f0-9]{40}", SOURCE):
        raise ValueError("Pin the final immutable watch source before dispatch")
    if run(["git", "rev-parse", "HEAD"], source).strip() != SOURCE:
        raise ValueError("Source checkout differs from the reviewed watch commit")
    mobile = source / "apps/mobile"
    watch = json.loads((mobile / "wear-support/watch/version.json").read_text())
    if watch != {"version": VERSION, "versionCode": CODE}:
        raise ValueError("Source watch metadata does not match the release identity")
    app = json.loads((mobile / "app.json").read_text())["expo"]
    package = json.loads((mobile / "package.json").read_text())
    plan = json.loads((source / ".github/release-plan.json").read_text())
    if (app.get("android", {}).get("package") != APP_ID or app["version"] != package["version"] or
            app["version"] != plan["version"] or app["android"]["versionCode"] != plan["sourceAndroidVersionCode"]):
        raise ValueError("Phone source metadata is inconsistent; watch versioning must not modify it")
    wanted = {"CONTEXT_WEAR_BUILD": "1", "EXPO_PUBLIC_CONTEXT_DISTRIBUTION": "store",
              "EAS_BUILD_PROFILE": "wear-preview", "EAS_BUILD_PLATFORM": "android"}
    if any(os.environ.get(key) != value for key, value in wanted.items()):
        raise ValueError("This controller requires the dedicated watch environment")
    if os.environ.get("EAS_BUILD_WORKINGDIR") or any((source / item).exists() for item in
            ("credentials.json", "apps/mobile/credentials.json", "apps/mobile/credentials")):
        raise ValueError("Unsigned CI must not receive credential files or an EAS signing directory")
    return mobile


def unsigned_gradle(text):
    if (MARKER in text or "apply plugin: 'com.android.application'" not in text or
            "signingConfig signingConfigs.release" not in text or "minifyEnabled false" not in text or
            text.count("it.name == 'validateSigningRelease'") != 1 or
            f"versionCode {CODE} as int" not in text or f'versionName "{VERSION}"' not in text):
        raise ValueError("Unexpected generated watch identity or signing template")
    return text + "\n" + MARKER + "\nandroid {\n    buildTypes {\n        release {\n            signingConfig = null\n        }\n    }\n}\ntasks.matching { it.name == 'validateSigningRelease' }.configureEach { enabled = false }\n"


def has_signing_block(data):
    end = data.rfind(b"PK\x05\x06", max(0, len(data) - 65557))
    if end < 0 or end + 22 > len(data):
        raise ValueError("Missing ZIP footer")
    central = struct.unpack_from("<I", data, end + 16)[0]
    return central >= 24 and data[central - 16:central] == b"APK Sig Block 42"


def prepare(source, reports):
    mobile = source_identity(source)
    target = mobile / "android/wear/build.gradle"
    original = target.read_text()
    patched = unsigned_gradle(original)
    target.write_text(patched)
    (reports / "unsigned-watch-build.gradle").write_text(patched)
    return {"schemaVersion": 1, "status": "prepared-not-built", "sourceCommit": SOURCE,
            "controllerCommit": os.environ.get("GITHUB_SHA"), "version": VERSION,
            "androidVersionCode": CODE, "applicationId": APP_ID, "kind": "watch",
            "phoneSourceVersion": json.loads((mobile / "app.json").read_text())["expo"]["version"],
            "phoneSourceAndroidCode": json.loads((mobile / "app.json").read_text())["expo"]["android"]["versionCode"],
            "originalGeneratedGradleSha256": sha(original.encode()),
            "unsignedGeneratedGradleSha256": sha(patched.encode()),
            "lockfileSha256": sha((mobile / "pnpm-lock.yaml").read_bytes()),
            "signing": "disabled; no key supplied to CI", "physicalDeviceTestPerformed": False}


def element_blocks(xml, element):
    lines = xml.splitlines()
    for start, line in enumerate(lines):
        match = re.match(r"^( *)E: " + re.escape(element) + r"(?: |$)", line)
        if not match:
            continue
        depth = len(match[1]); end = start + 1
        while end < len(lines):
            other = re.match(r"^( *)E: ", lines[end])
            if other and len(other[1]) <= depth:
                break
            end += 1
        yield "\n".join(lines[start:end])


def speech_manifest_verified(xml):
    def named(block, value):
        lines=block.splitlines()
        depth=len(lines[0])-len(lines[0].lstrip())
        expression=r'^\s*A:\s+(?:android:|http://schemas\.android\.com/apk/res/android:)name(?:\([^)]*\))?\s*=\s*"'+re.escape(value)+r'"(?:\s|$)'
        return any(len(line)-len(line.lstrip())==depth+2 and re.search(expression,line) for line in lines[1:])
    permissions=[item for item in element_blocks(xml,"uses-permission") if named(item,"android.permission.RECORD_AUDIO")]
    actions=[action for query in element_blocks(xml,"queries") for intent in element_blocks(query,"intent")
        for action in element_blocks(intent,"action") if named(action,"android.speech.RecognitionService")]
    if len(permissions)!=1 or len(actions)!=1:
        raise ValueError("Compiled watch microphone permission or exact speech-service query action is missing or duplicated")
    return {"microphonePermissionDeclared":True,"recognitionServiceQueryDeclared":True}


def resource_file(resources, kind, name):
    lines = resources.splitlines()
    pattern = re.compile(r"^\s*resource\s+(0x[0-9a-fA-F]{8})\s+(?:[A-Za-z0-9_.]+:)?" + re.escape(kind + "/" + name) + r"(?:\s|$)")
    found = []
    for index, line in enumerate(lines):
        match = pattern.match(line)
        if not match:
            continue
        end = index + 1
        while end < len(lines) and not re.match(r"^\s*resource\s+0x[0-9a-fA-F]+\s", lines[end]):
            end += 1
        values = re.findall(r"\(([^)]*)\)\s+\(file\)\s+([^\s]+)", "\n".join(lines[index:end]))
        if not 1 <= len(values) <= 16 or len(set(config for config, _ in values)) != len(values):
            raise ValueError(f"Compiled {kind}/{name} must have bounded distinct file configurations")
        files = []
        for config, member in values:
            member = member.strip('"')
            if not member.startswith("res/") or "\\" in member or ":" in member or ".." in member.split("/"):
                raise ValueError("Compiled resource file leaves APK resources")
            files.append({"configuration": config, "member": member})
        found.append({"id": match[1].lower(), "files": files})
    if len(found) != 1:
        raise ValueError(f"Expected one compiled {kind}/{name} resource")
    return found[0]


def tile_resource_files(resources):
    return {"preview": resource_file(resources, "drawable", "context_tile_preview"),
            "logo": resource_file(resources, "drawable", "context_logo")}


def tile_preview_verified(xml, links, require_content=True):
    if len(re.findall(r"^\s*E: layer-list(?: |$)", xml, re.M)) != 1:
        raise ValueError("Compiled Tile preview must be a layer-list")
    if require_content and (not re.search(r"android:drawable[^\n]*@" + re.escape(links["logo"]["id"]), xml, re.I) or
            not re.search(r"android:color[^\n]*(?:0xff000000|#ff000000)(?:\s|$)", xml, re.I)):
        raise ValueError("Compiled Tile preview must show the approved logo on black")
    return True


def tile_preview_versions(links):
    values = []
    for item in links["preview"]["files"]:
        config = item["configuration"]
        if not re.fullmatch(r"(?:v[1-9][0-9]*)?", config):
            raise ValueError("Unexpected non-version Tile preview configuration")
        values.append((item["member"], int(config[1:]) if config else 0))
    supported = [version for _, version in values if version <= 30]
    if not supported:
        raise ValueError("No Tile preview drawable applies to the minimum SDK")
    minimum_choice = max(supported)
    result = {}
    for member, version in values:
        result[member] = result.get(member, False) or version >= minimum_choice
    return result


def tile_manifest_verified(xml, resources):
    blocks = [block for block in element_blocks(xml, "service") if
              re.search(r'android:name[^\n]*="(?:com\.context\.minuteledger\.wear\.ContextTileService|\.ContextTileService)"', block)]
    if len(blocks) != 1:
        raise ValueError("Expected one compiled Tile service")
    block = blocks[0]
    if not ("com.google.android.wearable.permission.BIND_TILE_PROVIDER" in block and
            "androidx.wear.tiles.action.BIND_TILE_PROVIDER" in block and "androidx.wear.tiles.PREVIEW" in block and
            re.search(r'android:exported[^=\n]*=\s*(?:\(type 0x12\))?(?:true|0xffffffff)(?=\s|$)', block)):
        raise ValueError("Compiled Tile service permission/action/preview/export status is invalid")
    preview = tile_resource_files(resources)["preview"]
    previews = [item for item in element_blocks(block, "meta-data") if "androidx.wear.tiles.PREVIEW" in item]
    if len(previews) != 1 or not re.search(r'android:resource[^\n]*@' + re.escape(preview["id"]), previews[0], re.I):
        raise ValueError("Compiled Tile preview must point to its approved-emblem drawable")
    activities = [block for block in element_blocks(xml, "activity") if
                  re.search(r'android:name[^\n]*="(?:com\.context\.minuteledger\.wear\.MinuteActivity|\.MinuteActivity)"', block)]
    if len(activities) != 1 or not re.search(r'android:launchMode[^=\n]*=\s*(?:\(type 0x10\))?(?:0x1|1|"singleTop")(?=\s|$)', activities[0]):
        raise ValueError("Compiled MinuteActivity must use singleTop")
    return True


def verify(source, reports, receipt):
    mobile = source_identity(source)
    if receipt.get("sourceCommit") != SOURCE or receipt.get("status") != "prepared-not-built":
        raise ValueError("Missing exact-source unsigned preparation receipt")
    if (receipt["lockfileSha256"] != sha((mobile / "pnpm-lock.yaml").read_bytes()) or
            receipt["unsignedGeneratedGradleSha256"] != sha((mobile / "android/wear/build.gradle").read_bytes())):
        raise ValueError("The locked inputs or generated unsigned Gradle changed during assembly")
    tools = Path(os.environ["ANDROID_HOME"]) / "build-tools/37.0.0"
    original = mobile / "android/wear/build/outputs/apk/release/wear-release-unsigned.apk"
    apk = reports / f"context-{VERSION}-wear-unsigned.apk"
    run([tools / "zipalign", "-P", "16", "-f", "4", original, apk])
    run([tools / "zipalign", "-c", "-P", "16", "-v", "4", apk])
    data = apk.read_bytes()
    with zipfile.ZipFile(apk) as diagnostic_zip:
        (reports / "apk-zip-entries.json").write_text(json.dumps(diagnostic_zip.namelist(), indent=2) + "\n")
    identity = run([tools / "aapt2", "dump", "badging", apk])
    (reports / "native-package-identity.txt").write_text(identity)
    xml = run([tools / "aapt2", "dump", "xmltree", apk, "--file", "AndroidManifest.xml"])
    (reports / "compiled-watch-manifest.txt").write_text(xml)
    resources = run([tools / "aapt2", "dump", "resources", apk])
    (reports / "compiled-watch-resources.txt").write_text(resources)
    links = tile_resource_files(resources)
    tile_manifest_verified(xml, resources)
    speech = speech_manifest_verified(xml)
    preview_proof = []
    versions = tile_preview_versions(links)
    with zipfile.ZipFile(apk) as resource_zip:
        for item in [entry for resource in links.values() for entry in resource["files"]]:
            if item["member"] not in resource_zip.namelist():
                raise ValueError("A compiled Tile preview/logo file value is missing from the APK")
            item["sha256"] = sha(resource_zip.read(item["member"]))
    for index, item in enumerate(links["preview"]["files"]):
        preview_xml = run([tools / "aapt2", "dump", "xmltree", apk, "--file", item["member"]])
        filename = f"compiled-tile-preview-{index}.txt"
        (reports / filename).write_text(preview_xml)
        required = versions[item["member"]]
        tile_preview_verified(preview_xml, links, required)
        preview_proof.append({"member": item["member"], "configuration": item["configuration"],
                              "applicableAtSupportedSdk": required, "xmlReport": filename,
                              "xmlSha256": sha(preview_xml.encode())})
    if has_signing_block(data):
        raise ValueError("An unsigned watch artifact unexpectedly contains an APK signing block")
    with zipfile.ZipFile(apk) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or archive.testzip() is not None:
            raise ValueError("APK ZIP names/CRC integrity failed")
        if (any(re.fullmatch(r"META-INF/[^/]+\.(?:SF|RSA|DSA|EC)", name, re.I) for name in names) or
                "assets/index.android.bundle" in names or "assets/app.config" in names):
            raise ValueError("The unsigned native watch APK contains a signature or phone bundle")
        dex_files = {name: archive.read(name) for name in names if re.fullmatch(r"classes(?:[2-9]|[1-9][0-9]+)?\.dex", name)}
        classes = verify_required_class_definitions(dex_files, MODULES)
        if not any(b"HH:mm:ss" in value for value in dex_files.values()):
            raise ValueError("Live dictation clock format is absent from actual DEX")
    if (f"package: name='{APP_ID}' versionCode='{CODE}' versionName='{VERSION}'" not in identity or
            "uses-feature: name='android.hardware.type.watch'" not in identity or not re.search(r"^(?:minSdkVersion|sdkVersion):'30'\s*$", identity, re.M)):
        raise ValueError("Actual watch package/version/required feature/minimum SDK differs")
    tests = {"cases": 0, "failures": 0, "errors": 0, "skipped": 0}
    test_files = list((mobile / "android/wear/build/test-results").glob("test*/TEST-*.xml"))
    if not test_files:
        raise ValueError("Actual watch JVM test result files are missing")
    test_reports = reports / "watch-unit-tests"
    test_reports.mkdir(exist_ok=True)
    required_suites = {"com.context.minuteledger.wear.ContextTileLayoutTest",
                       "com.context.minuteledger.wear.JVMLaunchPolicyTest",
                       "com.context.minuteledger.wear.JVMSpeechSessionGuardTest",
                       "com.context.minuteledger.wear.JVMDictationSavePolicyTest",
                       "com.context.minuteledger.wear.JVMWatchDictationPolicyTest",
                       "com.context.minuteledger.wear.JVMCoalescedPendingWorkTest",
                       "com.context.minuteledger.wear.JVMWatchSilencePolicyTest"}
    completed_suites = set()
    for index, file in enumerate(test_files):
        suite = ET.fromstring(file.read_bytes())
        for key, attribute in (("cases", "tests"), ("failures", "failures"), ("errors", "errors"), ("skipped", "skipped")):
            value = suite.get(attribute, "0")
            if not value.isdigit():
                raise ValueError("Malformed watch JVM test result counts")
            tests[key] += int(value)
        if suite.get("name") in required_suites and int(suite.get("tests", "0")) > int(suite.get("skipped", "0")):
            completed_suites.add(suite.get("name"))
        (test_reports / f"{index}-{file.name}").write_bytes(file.read_bytes())
    if not required_suites <= completed_suites:
        raise ValueError("Required Tile, launch, speech guard or dictation-save policy JVM tests did not run")
    tests["requiredSuitesVerified"] = sorted(completed_suites)
    if tests["cases"] <= tests["skipped"] or tests["failures"] or tests["errors"]:
        raise ValueError("Watch JVM tests failed or no test actually ran")
    negative = run([tools / "apksigner", "verify", "--verbose", apk], expected=1)
    (reports / "expected-unsigned-signature-check.txt").write_text(negative)
    receipt.update({"status": "unsigned-build-verified", "finishedAt": datetime.now(timezone.utc).isoformat(),
                    "apk": {"filename": apk.name, "bytes": len(data), "sha256": sha(data)},
                    "zipIntegrity": True, "zipAlignment": "16 KiB checked before signing",
                    "nativeIdentityVerified": True, "watchFeatureRequired": True,
                    "noPhoneBundle": True, "actualClassDefinitionsVerified": True,
                    "nativeClassDefinitions": classes, "tileManifestVerified": True, "unitTests": tests,
                    "speechManifest": speech, "watchDictationClockPackaged": True,
                    "approvedTilePreviewPresent": True, "tileResources": links,
                    "compiledPreviewAlternatives": preview_proof,
                    "tileResourceSelectionPolicy": {"minimumSdk": 30, "configurationSource": "compiled resource table, never ZIP filenames",
                        "verifiedAlternatives": "highest version applicable at API 30 and every higher version",
                        "lowerCompilerFallbacks": "ZIP membership and layer-list checked; unreachable below selected API-30 alternative"}, "noApkSigningBlock": True,
                    "noJarSignature": True, "apksignerExpectedUnsignedExit": 1,
                    "publisherCertificateExpectedAfterLocalSigning": CERTIFICATE,
                    "scope": "Unsigned native watch and actual compiled Tile checks only; no signing, publication or physical device test."})
    return receipt


class InvalidDex(ValueError):
    pass


def require(value, message):
    if not value:
        raise InvalidDex(message)


def check_index_count(kind, count):
    # Type/prototype counts reserve NO_INDEX16. Field/method references can use
    # all 65,536 unsigned-16 indexes (Android's documented 64K reference limit).
    limit = {2: 65535, 3: 65535, 4: 65536, 5: 65536}.get(kind)
    if limit is not None:
        require(count <= limit, "DEX indexed table exceeds format limit")


def dex_class_definitions(data: bytes) -> set[str]:
    require(isinstance(data, bytes) and 112 <= len(data) <= 256 * 1024 * 1024, "Invalid DEX length")
    require(data[:8] in {b"dex\n035\0", b"dex\n037\0", b"dex\n038\0", b"dex\n039\0", b"dex\n040\0"}, "Unsupported DEX magic/version")

    def u32(offset):
        require(0 <= offset <= len(data) - 4, "Truncated DEX integer")
        return struct.unpack_from("<I", data, offset)[0]

    require(u32(32) == len(data), "DEX file_size does not match input")
    require(u32(36) == 112 and u32(40) == 0x12345678, "Invalid DEX header size/endianness")
    require(u32(44) == 0 and u32(48) == 0, "Linked DEX is unsupported")
    require(data[12:32] == hashlib.sha1(data[32:]).digest(), "DEX SHA1 signature mismatch")
    require(u32(8) == zlib.adler32(data[12:]) & 0xFFFFFFFF, "DEX Adler32 checksum mismatch")

    sizes = {1: (u32(56), u32(60), 4), 2: (u32(64), u32(68), 4),
             3: (u32(72), u32(76), 12), 4: (u32(80), u32(84), 8),
             5: (u32(88), u32(92), 8), 6: (u32(96), u32(100), 32)}
    last_end = 112
    for kind, (count, offset, width) in sizes.items():
        require((count == 0) == (offset == 0), "Invalid empty DEX table")
        if count:
            require(offset % 4 == 0 and offset >= last_end and count <= (len(data) - offset) // width,
                    "DEX fixed table is out of bounds, unaligned or overlapping")
            last_end = offset + count * width
        check_index_count(kind, count)
    string_count, string_off, _ = sizes[1]
    type_count, type_off, _ = sizes[2]
    class_count, class_off, _ = sizes[6]
    require(class_count <= type_count, "Too many DEX class definitions")
    data_size, data_off = u32(104), u32(108)
    require(data_size > 0 and data_off % 4 == 0 and data_off >= last_end and
            data_off <= len(data) and data_size == len(data) - data_off, "Invalid DEX data section")
    data_end = data_off + data_size

    def in_data(offset, width=1, alignment=1):
        require(offset % alignment == 0 and data_off <= offset <= data_end - width,
                "DEX data offset is out of bounds or unaligned")

    map_off = u32(52)
    in_data(map_off, 4, 4)
    map_count = u32(map_off)
    require(1 <= map_count <= (data_end - map_off - 4) // 12, "Invalid DEX map size")
    entries = {}
    previous_offset = -1
    for index in range(map_count):
        kind, unused, count, offset = struct.unpack_from("<HHII", data, map_off + 4 + 12 * index)
        require(unused == 0 and count > 0 and kind not in entries and previous_offset < offset < len(data),
                "Invalid DEX map entry/order")
        previous_offset = offset
        entries[kind] = (count, offset)
        if kind >= 0x1000:
            in_data(offset)
    require(entries.get(0) == (1, 0) and entries.get(0x1000) == (1, map_off), "DEX map/header disagreement")
    for kind, (count, offset, _width) in sizes.items():
        require(entries.get(kind) == ((count, offset) if count else None), "DEX map/fixed table disagreement")
    require(entries.get(0x2002, (0, 0))[0] == string_count, "DEX string-data/map disagreement")

    string_start = entries.get(0x2002, (0, data_end))[1]
    string_end = min((offset for _count, offset in entries.values() if offset > string_start), default=data_end)

    def uleb(offset):
        value = 0
        for index in range(5):
            require(offset + index < string_end, "Truncated DEX string ULEB128")
            byte = data[offset + index]
            require(index < 4 or byte <= 0x0F, "DEX string ULEB128 overflows 32 bits")
            value |= (byte & 0x7F) << (7 * index)
            if byte < 0x80:
                require(index == 0 or byte != 0, "Noncanonical DEX string ULEB128")
                return value, offset + index + 1
        raise InvalidDex("Unterminated DEX string ULEB128")

    strings = {}

    def read_string(index):
        require(index < string_count, "Invalid DEX descriptor/string index")
        if index in strings:
            return strings[index]
        offset = u32(string_off + index * 4)
        require(string_start <= offset < string_end, "Invalid DEX string-data offset")
        units, cursor = uleb(offset)
        require(units <= string_end - cursor - 1, "DEX UTF16 string length is out of bounds")
        decoded = []
        while True:
            require(cursor < string_end, "Unterminated DEX MUTF-8 string")
            first = data[cursor]
            cursor += 1
            if first == 0:
                break
            if first < 0x80:
                value = first
            elif first & 0xE0 == 0xC0:
                require(cursor < string_end and data[cursor] & 0xC0 == 0x80, "Invalid DEX MUTF-8 continuation")
                value = ((first & 0x1F) << 6) | (data[cursor] & 0x3F)
                cursor += 1
                require(value >= 0x80 or (first == 0xC0 and value == 0), "Overlong DEX MUTF-8 encoding")
            elif first & 0xF0 == 0xE0:
                require(cursor + 1 < string_end and data[cursor] & 0xC0 == 0x80 and data[cursor + 1] & 0xC0 == 0x80,
                        "Invalid DEX MUTF-8 continuation")
                value = ((first & 0x0F) << 12) | ((data[cursor] & 0x3F) << 6) | (data[cursor + 1] & 0x3F)
                cursor += 2
                require(value >= 0x800, "Overlong DEX MUTF-8 encoding")
            else:
                raise InvalidDex("Invalid DEX MUTF-8 leading byte")
            decoded.append(chr(value))
            require(len(decoded) <= units, "DEX UTF16 string length mismatch")
        require(len(decoded) == units, "DEX UTF16 string length mismatch")
        value = "".join(decoded)
        strings[index] = value
        return value

    defined = set()
    for index in range(class_count):
        values = struct.unpack_from("<8I", data, class_off + index * 32)
        class_index, _flags, superclass, interfaces, source, annotations, class_data, static_values = values
        require(class_index < type_count, "Invalid DEX class/type index")
        descriptor = read_string(u32(type_off + class_index * 4))
        require(descriptor.startswith('L') and descriptor.endswith(';') and len(descriptor) > 2 and
                not re.search(r'[.;\[\x00]', descriptor[1:-1]) and all(descriptor[1:-1].split('/')) and
                descriptor not in defined, "Duplicate or invalid DEX class definition")
        require(superclass == 0xFFFFFFFF or superclass < type_count, "Invalid DEX superclass index")
        require(source == 0xFFFFFFFF or source < string_count, "Invalid DEX source-file index")
        if interfaces:
            in_data(interfaces, 4, 4)
            count = u32(interfaces)
            require(count <= (data_end - interfaces - 4) // 2, "DEX interface list out of bounds")
            for item in range(count):
                require(struct.unpack_from('<H', data, interfaces + 4 + item * 2)[0] < type_count, "Invalid DEX interface type index")
        if annotations:
            in_data(annotations, 16, 4)
        if class_data:
            in_data(class_data)
        if static_values:
            in_data(static_values)
        defined.add(descriptor)
    return defined


def verify_required_class_definitions(dex_files: dict[str, bytes], required: dict[str, str]) -> dict[str, dict]:
    require(bool(dex_files), "No DEX files supplied")
    found = {}
    for filename, data in dex_files.items():
        require(re.fullmatch(r'classes(?:[2-9]|[1-9][0-9]+)?\.dex', filename) is not None, "Invalid APK DEX entry name")
        for descriptor in dex_class_definitions(data):
            require(descriptor not in found, "Duplicate DEX class definition across files")
            found[descriptor] = filename
    result = {}
    for name, descriptor in required.items():
        require(descriptor in found, f"Required actual DEX class definition is missing: {name}")
        result[name] = {'descriptor': descriptor, 'dexFile': found[descriptor], 'actualClassDefinitionVerified': True}
    return result



def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("prepare", "verify"))
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--reports", required=True, type=Path)
    args = parser.parse_args()
    source, reports = args.source.resolve(), args.reports.resolve()
    reports.mkdir(parents=True, exist_ok=True)
    receipt_file = reports / "build-receipt.json"
    if args.mode == "prepare":
        if receipt_file.exists():
            raise ValueError("Refusing to replace an existing watch receipt")
        receipt = prepare(source, reports)
    else:
        try:
            receipt = verify(source, reports, json.loads(receipt_file.read_text()))
        except BaseException:
            # upload-artifact retains diagnostics on failure, never an unverified APK.
            (reports / f"context-{VERSION}-wear-unsigned.apk").unlink(missing_ok=True)
            raise
    receipt_file.write_text(json.dumps(receipt, indent=2) + "\n")
    print(f"Context watch evidence: {receipt['status']} ({SOURCE})")


if __name__ == "__main__":
    main()
