# Installed-app update notices

Current phone availability: **0.1.27/code28** in both channels, verified at **2026-10-28 at 12:38:34 UTC**. Watch **0.1.10/code100011** remains separate. Only actually published channels enter latest.json. Earlier receipt sections below are preserved unchanged.

## Published 0.1.27 phone updates

Both phone editions, code28, and all twelve checked public assets were available by **2026-10-28 at 12:38:34 UTC**, release **426642463**. [Wear-enabled APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.27/context-0.1.27-wear-phone-preview.apk) (asset 684936438) and [FOSS APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.27/context-0.1.27-foss-preview.apk) (asset 684955590) update the existing installation. The separate Watch 0.1.10/code100011 remains the current matching watch release.

Context 0.1.27 schedules the next automatic full account poll 15 seconds after the previous poll completes. A slow active poll no longer immediately starts another full poll when an interval tick has already elapsed. A recently completed manual or edit-triggered account cycle also postpones the next automatic poll. Committed local edits still request prompt synchronization, and manual Sync keeps its existing action and source checks.

Your local notes, event borders, titles and source-calendar conflict guards remain intact. Choose **Update** over the existing phone installation. The Wear-enabled phone includes native Google sign-in and the optional watch bridge; the FOSS phone omits those native dependencies. The separate Watch 0.1.10 release remains independent.

Source: [8f7198f0f94aeeed42dce0734323238500746eaf](https://github.com/khushbakhtm-star/context/commit/8f7198f0f94aeeed42dce0734323238500746eaf). TypeScript and 890 mobile tests passed, including 141 focused UI/keyboard/manual-sync/native-crypto/provider/storage/diagnostic/database/polling checks within that run. Static packaged checks cover 84 required UI labels and 15 obsolete labels. These are automated checks, not physical-phone or live-calendar verification.

- Wear-enabled phone: 79,101,098 bytes; SHA-256 `e71ecd4d5a8478df38cd33d05cbeeeb611ec47630ad115b48106edea98dbcfc7`.
- FOSS phone: 78,385,055 bytes; SHA-256 `5de6eaa89d80832290b7bf0ffff6dc506c57d663c34d16fb978a02d53d59edab`.

Both are code28, signed with the existing publisher certificate; official signatures, protected source-built content and 16 KiB alignment passed. [Independent F-Droid verification](https://github.com/khushbakhtm-star/context/actions/runs/40686842564) reported zero source errors/warnings and 108 removed inputs, 5 source patches and 33 reviewed Wear removals. The attached permanent evidence ZIP preserves 23 checked entries. This publisher preview does not establish official F-Droid catalog acceptance or Apple/Google store availability.

The [phone build](https://github.com/khushbakhtm-star/context/actions/runs/40686798869) used controller `5395d3238d21a5abed3d375d49d024a2c811f12b`; FOSS used `5395d3238d21a5abed3d375d49d024a2c811f12b`. The [source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40688434493) passed at the exact application source.

The [permanent FOSS evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.27/context-0.1.27-foss-build-evidence.zip) is **7,752,378 bytes**, SHA-256 `7e1dcdad29947e70a1cbef6308b0479f9b3f904587ab540c89ce5cba67762678`. Public/local file sizes and digests match. No physical phone/watch, live account or store/catalog result is implied.

## Published 0.1.26 phone updates

Both phone editions, code27, and all twelve checked public assets were available by **2026-10-28 at 06:22:47 UTC**, release **426319008**. [Wear-enabled APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.26/context-0.1.26-wear-phone-preview.apk) (asset 684036972) and [FOSS APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.26/context-0.1.26-foss-preview.apk) (asset 684042280) update the existing installation. The separate Watch 0.1.10/code100011 remains the current matching watch release.

Context 0.1.26 batches legacy activity-title queries and reads legacy projection minutes through the exact block/date index. A synthetic regression checks a full 1,440-minute unlabeled day using three bounded queries instead of 1,440 scalar reads. Hold Sync to inspect local stage durations, key-derivation backend timings and phone-provider acknowledgements; Copy timings copies only fixed labels and aggregate numbers. A phone-provider acknowledgement confirms a local SDK operation, not upload to Google Calendar.

Your local notes, event borders, titles and source-calendar conflict guards remain intact. Choose **Update** over the existing phone installation. The Wear-enabled phone includes native Google sign-in and the optional watch bridge; the FOSS phone omits those native dependencies. The separate Watch 0.1.10 release remains independent.

Source: [03632cc4a61f2ff60eb25b9218d4c6aa2c6f65ac](https://github.com/khushbakhtm-star/context/commit/03632cc4a61f2ff60eb25b9218d4c6aa2c6f65ac). TypeScript and 884 mobile tests passed, including 135 focused UI/keyboard/manual-sync/native-crypto/provider/storage/diagnostic/database checks within that run. Static packaged checks cover 84 required UI labels and 15 obsolete labels. These are automated checks, not physical-phone or live-calendar verification.

- Wear-enabled phone: 79,097,002 bytes; SHA-256 `e929627fb051f4cdf35ad19872f7cfd04f36d57eb35efbc4899b849e641bcd0f`.
- FOSS phone: 78,385,055 bytes; SHA-256 `dc152f16024b296dc220d3e557cd427ec1762f5a4d6d9f1f7e90d994b90d807e`.

Both are code27, signed with the existing publisher certificate; official signatures, protected source-built content and 16 KiB alignment passed. [Independent F-Droid verification](https://github.com/khushbakhtm-star/context/actions/runs/40641361830) reported zero source errors/warnings and 108 removed inputs, 5 source patches and 33 reviewed Wear removals. The attached permanent evidence ZIP preserves 23 checked entries. This publisher preview does not establish official F-Droid catalog acceptance or Apple/Google store availability.

The [phone build](https://github.com/khushbakhtm-star/context/actions/runs/40641334473) used controller `09d27362b179378d639779dedbf8e75b3728b276`; FOSS used `09d27362b179378d639779dedbf8e75b3728b276`. The [source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40642708977) passed at the exact application source.

The [permanent FOSS evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.26/context-0.1.26-foss-build-evidence.zip) is **7,752,557 bytes**, SHA-256 `768868fefe3e5f8ae48526043f91be56b6e23f8034c731d8d8266f8ccf9ff465`. Public/local file sizes and digests match. No physical phone/watch, live account or store/catalog result is implied.

## Published 0.1.25 phone updates

Both phone editions, code26, and all twelve checked public assets were available by **2026-10-28 at 05:21:39 UTC**, release **426288730**. [Wear-enabled APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.25/context-0.1.25-wear-phone-preview.apk) (asset 683923859) and [FOSS APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.25/context-0.1.25-foss-preview.apk) (asset 683927435) update the existing installation. The separate Watch 0.1.10/code100011 remains the current matching watch release.

Context 0.1.25 avoids redundant full synchronization passes when observers join existing work. Each pass shares scoped provider color metadata, and confirmed immutable uploads can skip redundant downloads after the passphrase is verified. Peer files still authenticate and merge before calendar changes; live event versions, source permissions and conflict checks remain in force. The encrypted-ledger format and 600,000-round key derivation are unchanged.

Your local notes, event borders, titles and source-calendar conflict guards remain intact. Choose **Update** over the existing phone installation. The Wear-enabled phone includes native Google sign-in and the optional watch bridge; the FOSS phone omits those native dependencies. The separate Watch 0.1.10 release remains independent.

Source: [108080cd49b70119af407b5aea93a839fc325785](https://github.com/khushbakhtm-star/context/commit/108080cd49b70119af407b5aea93a839fc325785). TypeScript and 856 mobile tests passed, including 100 focused UI/keyboard/manual-sync/native-crypto/provider/storage checks within that run. Static packaged checks cover 80 required UI labels and 15 obsolete labels. These are automated checks, not physical-phone or live-calendar verification.

- Wear-enabled phone: 79,076,522 bytes; SHA-256 `0c30301f0c0bf313f183bf6d8d0938d1a1b40d730e9373809c1c593f45695e2c`.
- FOSS phone: 78,364,575 bytes; SHA-256 `df73ad1c72d49f3c2510f40f569fe93fbc710863341586b43fbb03e318127e70`.

Both are code26, signed with the existing publisher certificate; official signatures, protected source-built content and 16 KiB alignment passed. [Independent F-Droid verification](https://github.com/khushbakhtm-star/context/actions/runs/40635901393) reported zero source errors/warnings and 108 removed inputs, 5 source patches and 33 reviewed Wear removals. The attached permanent evidence ZIP preserves 23 checked entries. This publisher preview does not establish official F-Droid catalog acceptance or Apple/Google store availability.

The [phone build](https://github.com/khushbakhtm-star/context/actions/runs/40635859909) used controller `291825f4ad0a129f722850320e02f93992887602`; FOSS used `291825f4ad0a129f722850320e02f93992887602`. The [source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40637376694) passed at the exact application source.

The [permanent FOSS evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.25/context-0.1.25-foss-build-evidence.zip) is **7,753,348 bytes**, SHA-256 `a9033ac6d51ad309330069afbd5e7483a3f498839870804d12b2534db7779cb2`. Public/local file sizes and digests match. No physical phone/watch, live account or store/catalog result is implied.

## Published 0.1.24 phone updates

Both phone editions, code25, and all twelve checked public assets were available by **2026-10-28 at 04:45:49 UTC**, release **426270189**. [Wear-enabled APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.24/context-0.1.24-wear-phone-preview.apk) (asset 683845576) and [FOSS APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.24/context-0.1.24-foss-preview.apk) (asset 683846806) update the existing installation. The separate Watch 0.1.10/code100011 remains the current matching watch release.

Context 0.1.24 uses a dedicated Android native CPU thread for encrypted-ledger key preparation. The verified SDK implementation keeps PBKDF2-HMAC-SHA256 at 600,000 rounds and preserves the existing AES-256-GCM envelope, passphrase encoding and cross-phone/browser compatibility. Unsupported runtimes retain the portable implementation. Existing source permissions, completed-ledger checks and event-conflict protections remain in force.

Your local notes, event borders, titles and source-calendar conflict guards remain intact. Choose **Update** over the existing phone installation. The Wear-enabled phone includes native Google sign-in and the optional watch bridge; the FOSS phone omits those native dependencies. The separate Watch 0.1.10 release remains independent.

Source: [117c70c0e440555fe3e3d62276df38c9d370eee1](https://github.com/khushbakhtm-star/context/commit/117c70c0e440555fe3e3d62276df38c9d370eee1). TypeScript and 829 mobile tests passed, including 73 focused UI/keyboard/manual-sync/native-crypto checks within that run. Static packaged checks cover 80 required UI labels and 15 obsolete labels. These are automated checks, not physical-phone or live-calendar verification.

- Wear-enabled phone: 79,072,426 bytes; SHA-256 `8e1eafcd3cfb6bc9ba7fc254bcd96972b01ab80821f33ad9f4180d5c69ee6b6a`.
- FOSS phone: 78,356,383 bytes; SHA-256 `ea815c7f2178bb0cb75f52e8c11034d2c88699eab807fb06158d1600968a4ea9`.

Both are code25, signed with the existing publisher certificate; official signatures, protected source-built content and 16 KiB alignment passed. [Independent F-Droid verification](https://github.com/khushbakhtm-star/context/actions/runs/40632372149) reported zero source errors/warnings and 108 removed inputs, 5 source patches and 33 reviewed Wear removals. The attached permanent evidence ZIP preserves 23 checked entries. This publisher preview does not establish official F-Droid catalog acceptance or Apple/Google store availability.

The [phone build](https://github.com/khushbakhtm-star/context/actions/runs/40632232684) used controller `980e9c9d2dca45627d248c804d9382a377d56905`; FOSS used `980e9c9d2dca45627d248c804d9382a377d56905`. The [source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40634140677) passed at the exact application source.

The [permanent FOSS evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.24/context-0.1.24-foss-build-evidence.zip) is **7,753,392 bytes**, SHA-256 `726dac27df70e220eb08729c31d4e96019c9ab49e76697f0c2d18c8e83638f7e`. Public/local file sizes and digests match. No physical phone/watch, live account or store/catalog result is implied.

## Published 0.1.23 phone updates

Both phone editions, code24, and all twelve checked public assets were available by **2026-10-28 at 04:07:24 UTC**, release **426246517**. [Wear-enabled APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.23/context-0.1.23-wear-phone-preview.apk) (asset 683752192) and [FOSS APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.23/context-0.1.23-foss-preview.apk) (asset 683765574) update the existing installation. The separate Watch 0.1.10/code100011 remains the current matching watch release.

Context 0.1.23 adds guarded event-color writeback for linked Google phone calendars and uses verified writable event palettes. Individual linked activities needing review no longer block unrelated safe updates. Account color refreshes coalesce and stale reads cannot overwrite newer edits. Existing exact event identities remain intact when a single bordered activity moves or changes duration. Hold Sync for its actual step, including encryption preparation and network upload.

Your local notes, event borders, titles and source-calendar conflict guards remain intact. Choose **Update** over the existing phone installation. The Wear-enabled phone includes native Google sign-in and the optional watch bridge; the FOSS phone omits those native dependencies. The separate Watch 0.1.10 release remains independent.

Source: [4b622675f0d43c56637bbcf3e5171247e7ac57c0](https://github.com/khushbakhtm-star/context/commit/4b622675f0d43c56637bbcf3e5171247e7ac57c0). TypeScript and 813 mobile tests passed, including 57 focused checks within that run. Static packaged checks cover 80 required UI labels and 15 obsolete labels. These are automated checks, not physical-phone or live-calendar verification.

- Wear-enabled phone: 79,068,330 bytes; SHA-256 `f1ab89706dfef56b270902e4fb79593068f17553b85f057e04c163ece0d7e82b`.
- FOSS phone: 78,356,383 bytes; SHA-256 `58431b30d413b3c7656d540a4286565f5d87053e6171073dd0c45100eb8d1470`.

Both are code24, signed with the existing publisher certificate; official signatures, protected source-built content and 16 KiB alignment passed. [Independent F-Droid verification](https://github.com/khushbakhtm-star/context/actions/runs/40628364636) reported zero source errors/warnings and 108 removed inputs, 5 source patches and 33 reviewed Wear removals. The attached permanent evidence ZIP preserves 23 checked entries. This publisher preview does not establish official F-Droid catalog acceptance or Apple/Google store availability.

The [phone build](https://github.com/khushbakhtm-star/context/actions/runs/40628327937) used controller `8c5857f9ea4023ec1ed82727148509066c37b76d`; FOSS used `8c5857f9ea4023ec1ed82727148509066c37b76d`. The [source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40629651877) passed at the exact application source.

The [permanent FOSS evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.23/context-0.1.23-foss-build-evidence.zip) is **7,748,915 bytes**, SHA-256 `28b86fb02a73587bbe22dc37ff6aaf184dfbb9a15026317a0c3dfd44c36badaa`. Public/local file sizes and digests match. No physical phone/watch, live account or store/catalog result is implied.

## Published 0.1.22 phone updates

Both phone editions, code23, and all twelve checked public assets were available by **2026-10-28 at 02:49:01 UTC**, release **426203522**. [Wear-enabled APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.22/context-0.1.22-wear-phone-preview.apk) (asset 683588153) and [FOSS APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.22/context-0.1.22-foss-preview.apk) (asset 683609315) update the existing installation. The separate Watch 0.1.10/code100011 remains the current matching watch release.

Context 0.1.22 starts account synchronization before optional phone-calendar refreshes. Hold Sync, including while it is busy, to see its current step. A foreground wait that expires is shown as pending work; the exact background account completion updates its own status. Real provider failures and source conflicts remain visible. Explicitly enabled phone-calendar synchronization can update an existing exact native binding while account editing is enabled, without creating a duplicate, migrating its calendar or replacing a missing event.

Your local notes, event borders, titles and source-calendar conflict guards remain intact. Choose **Update** over the existing phone installation. The Wear-enabled phone includes native Google sign-in and the optional watch bridge; the FOSS phone omits those native dependencies. The separate Watch 0.1.10 release remains independent.

Source: [4d92e7f4a650459a8dfc621cd1a70329b225b32d](https://github.com/khushbakhtm-star/context/commit/4d92e7f4a650459a8dfc621cd1a70329b225b32d). TypeScript and 762 mobile tests passed, including 55 focused checks within that run. Static packaged checks cover 80 required UI labels and 15 obsolete labels. These are automated checks, not physical-phone or live-calendar verification.

- Wear-enabled phone: 79,019,178 bytes; SHA-256 `57c710bd9e0630d522073a2784f7ef74fe5e5da35cac8a32cb724f78cb1a732a`.
- FOSS phone: 78,290,847 bytes; SHA-256 `15b6b5f6a3b6701e770e7d320aecccb818c12e7f412921fb12fd9084906e93b7`.

Both are code23, signed with the existing publisher certificate; official signatures, protected source-built content and 16 KiB alignment passed. [Independent F-Droid verification](https://github.com/khushbakhtm-star/context/actions/runs/40620880277) reported zero source errors/warnings and 108 removed inputs, 5 source patches and 33 reviewed Wear removals. The attached permanent evidence ZIP preserves 23 checked entries. This publisher preview does not establish official F-Droid catalog acceptance or Apple/Google store availability.

The [phone build](https://github.com/khushbakhtm-star/context/actions/runs/40620852281) used controller `4b66270f022c6cd6a4a80980c3a022c9acb30680`; FOSS used `4b66270f022c6cd6a4a80980c3a022c9acb30680`. The [source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40622031500) passed at the exact application source.

The [permanent FOSS evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.22/context-0.1.22-foss-build-evidence.zip) is **7,722,840 bytes**, SHA-256 `d8d88ee6c65d44424cd3adea4db71e8299eaf3a8856fb0484797b4a9f2d19015`. Public/local file sizes and digests match. No physical phone/watch, live account or store/catalog result is implied.

## Published 0.1.21 phone updates

Both phone editions, code22, and all twelve checked public assets were available by **2026-10-28 at 01:26:15 UTC**, release **426162218**. [Wear-enabled APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.21/context-0.1.21-wear-phone-preview.apk) (asset 683419595) and [FOSS APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.21/context-0.1.21-foss-preview.apk) (asset 683436121) update the existing installation. The separate Watch 0.1.10/code100011 remains the current matching watch release.

Context 0.1.21 keeps minute editing available while calendar and private-ledger synchronization run. Slow connections return a retryable status instead of keeping the calendar locked. Unlocking an existing private ledger preserves its encrypted format and synchronization permissions.

Your local notes, event borders, titles and source-calendar conflict guards remain intact. Choose **Update** over the existing phone installation. The Wear-enabled phone includes native Google sign-in and the optional watch bridge; the FOSS phone omits those native dependencies. The separate Watch 0.1.10 release remains independent.

Source: [f929b89c526e8dea1c4c2eaaee315329848384bb](https://github.com/khushbakhtm-star/context/commit/f929b89c526e8dea1c4c2eaaee315329848384bb). TypeScript and 740 mobile tests passed, including 50 focused checks within that run. Static packaged checks cover 80 required UI labels and 15 obsolete labels. These are automated checks, not physical-phone or live-calendar verification.

- Wear-enabled phone: 79,002,794 bytes; SHA-256 `3135472e421fee7e1f73b19626e126f5e8464719fd666772e4cc2fab2c070a86`.
- FOSS phone: 78,274,463 bytes; SHA-256 `4419dc82df187d9d0097c5989c1021be0c5619db88d10c86061411167b84d1f2`.

Both are code22, signed with the existing publisher certificate; official signatures, protected source-built content and 16 KiB alignment passed. [Independent F-Droid verification](https://github.com/khushbakhtm-star/context/actions/runs/40613164391) reported zero source errors/warnings and 108 removed inputs, 5 source patches and 33 reviewed Wear removals. The attached permanent evidence ZIP preserves 23 checked entries. This publisher preview does not establish official F-Droid catalog acceptance or Apple/Google store availability.

The [phone build](https://github.com/khushbakhtm-star/context/actions/runs/40613128491) used controller `68c38dcd8cdb424ee21bc07f7765c0606fc9cee8`; FOSS used `68c38dcd8cdb424ee21bc07f7765c0606fc9cee8`. The [source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40614354153) passed at the exact application source.

The [permanent FOSS evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.21/context-0.1.21-foss-build-evidence.zip) is **7,724,334 bytes**, SHA-256 `7419f43d56ea70e01d91cedd9d7f58ec112dd3adf7a56e22e62c2fb9ea834b5a`. Public/local file sizes and digests match. No physical phone/watch, live account or store/catalog result is implied.

## Published 0.1.20 phone updates

Both phone editions, code21, and all twelve checked public assets were available by **2026-10-27 at 23:36:43 UTC**, release **426101288**. [Wear-enabled APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.20/context-0.1.20-wear-phone-preview.apk) (asset 683205666) and [FOSS APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.20/context-0.1.20-foss-preview.apk) (asset 683212811) update the existing installation. The separate Watch 0.1.10/code100011 remains the current matching watch release.

Context 0.1.20 keeps calendar event titles separate from each minute's notes. Apply an event border to one cell or a selected range to make an activity; unbordered notes stay in the private ledger. Reset cells clears the selected cells and their event membership. Remaining bordered pieces retain their own titles and notes.

Approved linked calendar edits import changed titles, times, duration, colors and cleared descriptions without restoring stale old cells. Existing event identities and locations are preserved; simultaneous local/source changes need review. Repeated consecutive notes use the first timestamp only in the calendar description, with private metadata preserving each minute and blank gap.

Choose **Update** over the existing phone installation. The Wear-enabled phone includes native Google sign-in and the optional watch bridge; the FOSS phone omits those native dependencies. The separate Watch 0.1.10 release remains independent.

Source: [c7f38c21755a4ff5f2b3bcac6ef463a66fb13608](https://github.com/khushbakhtm-star/context/commit/c7f38c21755a4ff5f2b3bcac6ef463a66fb13608). TypeScript and 719 mobile tests passed, including 43 focused checks within that run. Static packaged checks cover 80 required UI labels and 15 obsolete labels. These are automated checks, not physical-phone or live-calendar verification.

- Wear-enabled phone: 78,994,602 bytes; SHA-256 `12e2938b66d076e0a69b56b1e15a773fd9e8d7c1ad4e4509ea3c3f668d06ec0a`.
- FOSS phone: 78,262,175 bytes; SHA-256 `317cb8b6f0903333b7eaac09a66f9a01d9ed46cc5962b0d7509ba48a007220eb`.

Both are code21, signed with the existing publisher certificate; official signatures, protected source-built content and 16 KiB alignment passed. [Independent F-Droid verification](https://github.com/khushbakhtm-star/context/actions/runs/40601269959) reported zero source errors/warnings and 108 removed inputs, 5 source patches and 33 reviewed Wear removals. The attached permanent evidence ZIP preserves 23 checked entries. This publisher preview does not establish official F-Droid catalog acceptance or Apple/Google store availability.

The [phone build](https://github.com/khushbakhtm-star/context/actions/runs/40601215491) used controller `33104a60c0cd625de782105755b6253f40b28ee3`; FOSS used `33104a60c0cd625de782105755b6253f40b28ee3`. The [source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40602915532) passed at the exact application source.

The [permanent FOSS evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.20/context-0.1.20-foss-build-evidence.zip) is **7,724,645 bytes**, SHA-256 `ee00d6fb3e627bf68f7cd790913f72fd31fc9979e578c1c86e577730a361e8c7`. Public/local file sizes and digests match. No physical phone/watch, live account or store/catalog result is implied.

## Published 0.1.19 phone updates

Both phone editions, code20, and all twelve checked public assets were available by **2026-10-27 at 19:06:18 UTC**, release **425863818**. [Wear-enabled APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.19/context-0.1.19-wear-phone-preview.apk) (asset 682554647) and [FOSS APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.19/context-0.1.19-foss-preview.apk) (asset 682576669) update the existing installation. The separate Watch 0.1.10/code100011 remains the current matching watch release.

Context 0.1.19 fixes keyboard avoidance for the minute text box. Typing and partial text selection retain their draft, cursor and selected minute while the layout moves.

Choose **Update** over the existing phone installation. The Wear-enabled phone includes native Google sign-in and the optional watch bridge; the FOSS phone omits those native dependencies. The separate Watch 0.1.10 release remains independent.

Source: [488b37e0c7bb2a07456af48a8f00b7ab3e3300ba](https://github.com/khushbakhtm-star/context/commit/488b37e0c7bb2a07456af48a8f00b7ab3e3300ba). TypeScript and 675 mobile tests passed, including 40 focused checks within that run. Static packaged checks cover 78 required UI labels and 15 obsolete labels. These are automated checks, not physical keyboard or live-calendar verification.

- Wear-enabled phone: 78,953,642 bytes; SHA-256 `3746b1c115d3851891f55ac85d69efcc3cf6466edd9825c41c884605460d427a`.
- FOSS phone: 78,225,311 bytes; SHA-256 `a2becc79816355eac74b71ba264e577ca94e2b03819f7bae4531b6d85d8591fd`.

Both are code20, signed with the existing publisher certificate; official signatures, protected source-built content and 16 KiB alignment passed. [Independent F-Droid verification](https://github.com/khushbakhtm-star/context/actions/runs/40563208413) reported zero source errors/warnings and 108 removed inputs, 5 source patches and 33 reviewed Wear removals. The attached permanent evidence ZIP preserves 23 checked entries. This publisher preview does not establish official F-Droid catalog acceptance or Apple/Google store availability.

The [phone build](https://github.com/khushbakhtm-star/context/actions/runs/40562325430) used controller `cdb4f0950077a7e9104b1de24b25054b1faf82ab`; FOSS used `a5b0066a8c03b907d96b0ca2bdafc09cb62ef3ef`. The [original tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40564739856) passed TypeScript and all 675 tests, then **failed upstream listing validation** because the immutable tag omitted changelogs/20.txt. [Main-branch metadata repair](https://github.com/khushbakhtm-star/context/commit/e4298e98f8f2c049e12874594a30c398a37b1016) adds only that changelog; a separate listing check passed. The complete mobile runtime subtree is unchanged. The tag and both APKs remain at 488b37e0c7bb2a07456af48a8f00b7ab3e3300ba; this is not a successful rerun of the original workflow.

The [permanent FOSS evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.19/context-0.1.19-foss-build-evidence.zip) is **7,724,395 bytes**, SHA-256 `1a39622d0695203842856d413ddc62196ad57435c5848b120ab6e18d191c090a`. Public/local file sizes and digests match. No physical phone/watch, live account or store/catalog result is implied.

## Published 0.1.10 Watch update

[Watch 0.1.10 release](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10) / [watch APK](https://github.com/khushbakhtm-star/context/releases/download/watch-v0.1.10/context-0.1.10-wear-preview.apk)
was available by **2026-10-27 at 18:34:20 UTC**, release 425841266, APK asset 682497265.
All five public asset sizes/digests match the independently verified local outputs;
the watch tag points to application source `2019b79e0f1f23583b6322d5ce3259dd1ffe6dfe`.
[Unsigned build 40560111855](https://github.com/khushbakhtm-star/context/actions/runs/40560111855)
used controller `b19941e33405a75d6d6572f3278f027608931ca4`; signing stayed local.

Accepted dictation saves automatically to the editor's original minute. Stale, cancelled
or replaced speech sessions cannot save into another minute. The existing Record now
Tile, typed entry, historical editing and paired-phone transport remain available.
Watch versioning is independent: 0.1.10/code100011 follows watch 0.1.9/code100010;
the phone remains 0.1.18/code19.

The signed APK is **11,384,534 bytes**, SHA-256
`45412f15a79db71581af00cff45bbcb2f5d084f63750efc7397425dabe242c02`. All 39 JVM tests (0 skipped), five actual native
class definitions, compiled Tile service/resource/logo bindings, protected ZIP content,
custom cryptographic v2 verification, official supported-SDK v3 verification, separate
official contained-v2 signature proof, original publisher certificate and 16 KiB alignment
passed. The bounded v2 verifier override makes no runtime claim below minimum SDK30.

Install on the watch as an Update. Automated checks do not establish physical dictation,
Tile/lifecycle behavior or phone transport on this binary. This optional Google-dependent
companion remains separate from phone APKs, F-Droid and official store availability.

## Published 0.1.18 FOSS phone update

[Download the 0.1.18 FOSS phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.18/context-0.1.18-foss-preview.apk)
from the [public release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.18); both phone editions and all twelve checked files
were available by **2026-10-27 at 13:53:47 UTC**. Choose **Update** over the installed Context to retain its ledger.
This publisher-signed FOSS phone edition is code **19**. It omits native Google account sign-in
and optional Wear transport. Use the Wear-enabled phone edition for a paired Galaxy Watch7 or
native Google sign-in. Watch versions/releases remain independent; this APK belongs on a phone.

The [independent F-Droid build and scans](https://github.com/khushbakhtm-star/context/actions/runs/40510171114) used
application source [`39ef515e053ec9af23ce6a92b7c4290c33f6d220`](https://github.com/khushbakhtm-star/context/commit/39ef515e053ec9af23ce6a92b7c4290c33f6d220) and controller `f185f43da5b0030c016f8347fb3208ea98f46fff`.
The structured source scan reported **zero errors and zero warnings**; integrated recipe assembly
and both APK scans passed. Audits matched **108 removed inputs,
5 source patches and 31 Wear removals**.
Actual Print, Sharing, Clipboard and calendar-color DEX class definitions were verified using the collected
registration and R8 evidence where applicable. Official APK signatures, original publisher
certificate, 16 KiB alignment and unchanged source-built protected content passed after signing.
TypeScript, **671 full-suite tests** and **48 focused final tests** passed at that source.
The [exact source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40516124674) also passed.

Public release **425510132**, FOSS APK asset **681708358**: **78,225,311 bytes**,
SHA-256 `754dc2f499c012562e5385376c1dfca4bae47a48fe4ee48a3731c9bcc4af560d`. All twelve public assets match the locally verified files by size and digest. The current UI
receipt identifies the exact application source. No superseded 0.1.18 receipt is included;
earlier release evidence, including 0.1.14's preserved report, remains in the history.
The [permanent evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.18/context-0.1.18-foss-build-evidence.zip) contains
**23 checked files**, **7,724,762 bytes**,
SHA-256 `dcabdd6e9e52ccd32506432955a1d814a663c16c0d0fd70bcc6b7c5c705ac6f6`. It preserves source/native audits and class-definition evidence
independently of expiring Actions artifacts.

Use the FOSS Obtainium filter in [Android updates](ANDROID_UPDATES.md) for this phone edition.
This publisher preview and independent scan success do **not** establish official F-Droid catalog
acceptance. [Request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667) needs maintainer review.
Settings uses matching headings, neutral navigation and access status, selected-choice highlights,
consistent action buttons and an expandable list of unchecked calendars. Secondary screens use
matching back arrows. Month shows real text and fills without times or empty placeholders,
with only today highlighted. Year initially fits all twelve months; pinch enlarges text and
reflows the months within the screen width, with vertical scrolling only. One view-icon tap
opens views or Pick/Range; a double tap goes to Now. View changes retain the working date/minute,
and Schedule reveals an exact non-event date/time marker without changing source event times.

These automated checks do not establish physical gestures, live calendar behavior, printing
or two-phone synchronization. The independent watch release and iOS/store availability are
separate from this FOSS phone receipt.


## Published 0.1.18 Wear-phone update

[Download the 0.1.18 phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.18/context-0.1.18-wear-phone-preview.apk)
from the [published release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.18); the six verified phone files were available by **2026-10-27 at 13:53:47 UTC**.
Choose **Update** over the installed Context to retain its ledger. This is the Wear-enabled
phone edition, code **19**. Watch versions/releases remain independent; this phone receipt does not announce a watch binary.

Settings uses matching headings, neutral navigation and access status, selected-choice highlights,
consistent action buttons and an expandable list of unchecked calendars. Secondary screens use
matching back arrows. Month shows real text and fills without times or empty placeholders,
with only today highlighted. Year initially fits all twelve months; pinch enlarges text and
reflows the months within the screen width, with vertical scrolling only. One view-icon tap
opens views or Pick/Range; a double tap goes to Now. View changes retain the working date/minute,
and Schedule reveals an exact non-event date/time marker without changing source event times.

Application source is [`39ef515e053ec9af23ce6a92b7c4290c33f6d220`](https://github.com/khushbakhtm-star/context/commit/39ef515e053ec9af23ce6a92b7c4290c33f6d220). TypeScript and
**671 full-suite tests** passed, including **48 focused UI/navigation checks** in that same run.
The [unsigned Android build](https://github.com/khushbakhtm-star/context/actions/runs/40510324373) used controller
`f185f43da5b0030c016f8347fb3208ea98f46fff`; publisher signing stayed local. The
[exact source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40516124674) passed at that application source.
Public release **425510132**, APK asset **681708137**, matches the verified signed APK.
All six phone assets match their local files by size and digest. The signed APK is
**78,953,642 bytes**, SHA-256 `f4ecdc41f364986bde4dc75a54fe12941832d749ad1d6113ca7d3c5a987968e1`.

Receipts verify native identity, Google/Wear configuration, actual Print/Sharing/Clipboard/calendar-color
class definitions, **78** packaged UI markers and **15** obsolete-control checks,
official signatures, publisher-certificate continuity and 16 KiB alignment. These checks do not
establish physical phone gestures, calendar synchronization or printing. FOSS phone and watch
packages have their own receipts. iOS distribution, official stores and F-Droid catalog acceptance
remain separate. The current UI receipt identifies the exact source; no superseded 0.1.18
receipt is included. Earlier release receipts, including 0.1.14's preserved report, remain below.

## Published 0.1.9 Watch update

[Watch 0.1.9 release](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.9) / [watch APK](https://github.com/khushbakhtm-star/context/releases/download/watch-v0.1.9/context-0.1.9-wear-preview.apk)
was available by **2026-10-27 at 13:52:43 UTC**, release 425526801, APK asset 681744859.
The watch source is `142f2113a1638b78ee7a068196478e6b30ec9441`, independently built by
[run 40514382506](https://github.com/khushbakhtm-star/context/actions/runs/40514382506)
with controller `b2d048a884ff0b7095374bc4d2f769370127859c`. All five public asset
sizes/digests match the verified local outputs; the tag points to that exact source.

The Tile opens current-minute entry; launcher entry also starts at Now while preserving
unfinished notes, historical editors and dictation. The Tile itself contains no ledger data.
Watch identity/versioning is independent of the phone: 0.1.9/code100010 follows watch
0.1.8/code100009 without changing the package or publisher signing certificate.

The signed APK is **11,376,342 bytes**, SHA-256
`c92bfea976cd43b6be2fbe5ca3d77659e2790683cdb6bd57ffe50e6a2c051caa`.
All 28 JVM tests, four actual native class definitions, service permissions and semantic
compiled resource/logo bindings passed. Protected ZIP bytes, cryptographic v2 integrity,
default supported-SDK v3 verification, a separate official contained-v2 signature check,
publisher-certificate continuity and 16 KiB alignment passed. The forced signature-check
SDK range does not imply runtime support below the declared minimum SDK30.

Install this APK on the watch as an Update, separately from the phone APK. Add Context from
the watch's Add tiles screen. Hardware Tile, typing/dictation, lifecycle and phone transport
remain to be tried on this updated binary. This optional Google-dependent companion is
separate from the FOSS phone edition and official store listings.

## Published 0.1.17 FOSS phone update

[Download the 0.1.17 FOSS phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.17/context-0.1.17-foss-preview.apk)
from the [public release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.17); both phone editions and all twelve checked files
were available by **2026-10-27 at 11:03:13 UTC**. Choose **Update** over the installed Context to retain its ledger.
This publisher-signed FOSS phone edition is code **18**. It omits native Google account sign-in
and optional Wear transport. Use the Wear-enabled phone edition for a paired Galaxy Watch7 or
native Google sign-in. The watch 0.1.8 binary is unchanged; this APK belongs on a phone.

The [independent F-Droid build and scans](https://github.com/khushbakhtm-star/context/actions/runs/40490567930) used
application source [`9fb9d951d1757631aa826f5cc132de8e7dfe4c30`](https://github.com/khushbakhtm-star/context/commit/9fb9d951d1757631aa826f5cc132de8e7dfe4c30) and controller `0e664023faafb73941015fca13fdd9cf9ff0e1c2`.
The structured source scan reported **zero errors and zero warnings**; integrated recipe assembly
and both APK scans passed. Audits matched **108 removed inputs,
5 source patches and 21 Wear removals**.
Actual Print, Sharing, Clipboard and calendar-color DEX class definitions were verified using the collected
registration and R8 evidence where applicable. Official APK signatures, original publisher
certificate, 16 KiB alignment and unchanged source-built protected content passed after signing.
TypeScript, **648 full-suite tests** and **119 focused final tests** passed at that source.
The [exact source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40492679557) also passed.

Public release **425335458**, FOSS APK asset **681323222**: **78,213,023 bytes**,
SHA-256 `0ab23399d40c8a0f72a71889b2548ebb02ff7fa5909788027d2f26ca75562c8a`. All twelve public assets match the locally verified files by size and digest. The current UI
receipt identifies the exact application source. No superseded 0.1.17 receipt is included;
earlier release evidence, including 0.1.14's preserved report, remains in the history.
The [permanent evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.17/context-0.1.17-foss-build-evidence.zip) contains
**23 checked files**, **7,723,235 bytes**,
SHA-256 `82a6ea3fa543f22203bc48698567169b505248cf50b3b1ee74edc29921c85638`. It preserves source/native audits and class-definition evidence
independently of expiring Actions artifacts.

Use the FOSS Obtainium filter in [Android updates](ANDROID_UPDATES.md) for this phone edition.
This publisher preview and independent scan success do **not** establish official F-Droid catalog
acceptance. [Request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667) needs maintainer review.
Select a minute to reveal bottom text entry with a live cell preview. The first checkmark
saves the latest text, closes the keyboard and opens text/fill formatting; the second closes
formatting while keeping the selection. Contextual Cut, Copy, Paste, Clear, AutoFill, Group
and Ungroup apply only where relevant. Each grouped minute keeps its own note. Color Reset
keeps words and group membership; holding recorded cells or a selected range longer lets you
drag them to another minute or visible day, with occupied-target review and atomic Undo.
Pinch changes row height while Day keeps one fixed column and Week keeps all seven.

Explicit Paste imports plain-text spreadsheet rectangles from the phone system clipboard:
rows become minutes and columns become consecutive dates. Quoted multiline notes and blank
fields keep their positions. Source spreadsheet formatting and formula evaluation are not imported.

Exact account ownership prevents two writers competing for one activity. Linked native events
that were externally renamed, moved, resized or had their notes edited are held for review when
the saved receipt detects the change; older receiptless bindings are protected against changed
times. Stale old-cell synchronization or Reset cannot delete those detected moved events.
Existing legacy changes without an earlier content receipt may require explicit review.
Local-first reads and private whole-cell clipboard behavior remain available offline.
The user's one-tap popup confirmation concerned 0.1.14 after updating, not a physical test of
this binary. Physical gestures, calendar behavior, printing and two-phone synchronization
remain unverified for this new binary. No new watch or iOS binary is announced.

## Published 0.1.17 Wear-phone update

[Download the 0.1.17 phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.17/context-0.1.17-wear-phone-preview.apk)
from the [published release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.17); the six verified phone files were available by **2026-10-27 at 10:59:04 UTC**.
Choose **Update** over the installed Context to retain its ledger. This is the Wear-enabled
phone edition, code **18**. The separate watch companion remains 0.1.8.

Select a minute to reveal bottom text entry with a live cell preview. The first checkmark
saves the latest text, closes the keyboard and opens text/fill formatting; the second closes
formatting while keeping the selection. Contextual Cut, Copy, Paste, Clear, AutoFill, Group
and Ungroup apply only where relevant. Each grouped minute keeps its own note. Color Reset
keeps words and group membership; holding recorded cells or a selected range longer lets you
drag them to another minute or visible day, with occupied-target review and atomic Undo.
Pinch changes row height while Day keeps one fixed column and Week keeps all seven.

Explicit Paste imports plain-text spreadsheet rectangles from the phone system clipboard:
rows become minutes and columns become consecutive dates. Quoted multiline notes and blank
fields keep their positions. Source spreadsheet formatting and formula evaluation are not imported.

Exact account ownership prevents two writers competing for one activity. Linked native events
that were externally renamed, moved, resized or had their notes edited are held for review when
the saved receipt detects the change; older receiptless bindings are protected against changed
times. Stale old-cell synchronization or Reset cannot delete those detected moved events.
Existing legacy changes without an earlier content receipt may require explicit review.
Local-first reads and private whole-cell clipboard behavior remain available offline.

The user confirmed one-tap popup actions after installing 0.1.14. That is a limited observation
of 0.1.14, not a physical test of this new binary or every gesture and calendar flow.

Application source is [`9fb9d951d1757631aa826f5cc132de8e7dfe4c30`](https://github.com/khushbakhtm-star/context/commit/9fb9d951d1757631aa826f5cc132de8e7dfe4c30). TypeScript and
**648 full-suite tests** and **119 focused final tests** passed.
The [unsigned Android build](https://github.com/khushbakhtm-star/context/actions/runs/40490485899) used controller
`95c199d0e3ce06530737209ba46feb56e5c2a4ed`; publisher signing stayed local. The
[exact source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40492679557) passed at that application source.
Public release **425335458**, APK asset **681317177**, matches the verified signed APK.
All six phone assets match their local files by size and digest. The signed APK is
**78,941,354 bytes**, SHA-256 `6f8af2647bab696ae1e4cd37e9d8c56c3988c6c06474b92dd1a9f959d1604825`.

Receipts verify native identity, Google/Wear configuration, actual Print/Sharing/Clipboard/calendar-color
class definitions, **74** packaged UI markers and **14** obsolete-control checks,
official signatures, publisher-certificate continuity and 16 KiB alignment. These checks do not
establish physical phone gestures, calendar synchronization or printing. No new FOSS, watch or
iOS binary is announced by this phone receipt; official store and F-Droid catalog acceptance
remain separate. The current UI receipt identifies the exact source; no superseded 0.1.17
receipt is included. Earlier release receipts, including 0.1.14's preserved report, remain below.

## Published 0.1.16 FOSS phone update

[Download the 0.1.16 FOSS phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.16/context-0.1.16-foss-preview.apk)
from the [public release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.16); both phone editions and all twelve checked files
were available by **2026-10-26 at 23:05:32 UTC**. Choose **Update** over the installed Context to retain its ledger.
This publisher-signed FOSS phone edition is code **17**. It omits native Google account sign-in
and optional Wear transport. Use the Wear-enabled phone edition for a paired Galaxy Watch7 or
native Google sign-in. The watch 0.1.8 binary is unchanged; this APK belongs on a phone.

The [independent F-Droid build and scans](https://github.com/khushbakhtm-star/context/actions/runs/40415367808) used
application source [`7e43f1e59d389fdbcac2b057605d7928c0b22611`](https://github.com/khushbakhtm-star/context/commit/7e43f1e59d389fdbcac2b057605d7928c0b22611) and controller `1aeef5f7d97d276a95fb8ada1113a91ffe4f893e`.
The structured source scan reported **zero errors and zero warnings**; integrated recipe assembly
and both APK scans passed. Audits matched **106 removed inputs,
5 source patches and 21 Wear removals**.
Actual Print, Sharing and calendar-color DEX class definitions were verified using the collected
registration and R8 evidence where applicable. Official APK signatures, original publisher
certificate, 16 KiB alignment and unchanged source-built protected content passed after signing.
TypeScript, **535 full-suite tests** and **95 focused final tests** passed at that source.
The [exact source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40416783638) also passed.

Public release **424859425**, FOSS APK asset **679763077**: **78,143,335 bytes**,
SHA-256 `f5b9bd54972329674afdae397b0eddddfff3ae2e63cac1a60523da5dfec3f6f1`. All twelve public assets match the locally verified files by size and digest. The current UI
receipt identifies the exact application source. No superseded 0.1.16 receipt is included;
earlier release evidence, including 0.1.14's preserved report, remains in the history.
The [permanent evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.16/context-0.1.16-foss-build-evidence.zip) contains
**23 checked files**, **7,683,764 bytes**,
SHA-256 `758c9269d31b93eb064f36cfd0167406c9116d6e1c693c1194f62b11f942bf82`. It preserves source/native audits and class-definition evidence
independently of expiring Actions artifacts.

Use the FOSS Obtainium filter in [Android updates](ANDROID_UPDATES.md) for this phone edition.
This publisher preview and independent scan success do **not** establish official F-Droid catalog
acceptance. [Request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667) needs maintainer review.
Local ledger rows load independently of device-calendar and account requests. SQLite notes become visible
when their local read completes, while optional source reads continue separately. A stalled
provider cannot hold the local minute grid or month/schedule ledger queue behind it.
Existing clipboard, formatting, group and permission behavior remains in place. Account reads use a
ten-second caller deadline and a sixty-second raw-request lease. A later retry can supersede
stuck work, while identity guards reject obsolete results and protect the new request slot.
The user's one-tap popup confirmation concerned 0.1.14 after updating, not a physical test of
this binary. Physical gestures, calendar behavior, printing and two-phone synchronization
remain unverified for this new binary. No new watch or iOS binary is announced.

## Published 0.1.16 Wear-phone update

[Download the 0.1.16 phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.16/context-0.1.16-wear-phone-preview.apk)
from the [published release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.16); the six verified phone files were available by **2026-10-26 at 23:01:16 UTC**.
Choose **Update** over the installed Context to retain its ledger. This is the Wear-enabled
phone edition, code **17**. The separate watch companion remains 0.1.8.

Local ledger rows load independently of device-calendar and account requests. SQLite notes become visible
when their local read completes, while optional source reads continue separately. A stalled
provider cannot hold the local minute grid or month/schedule ledger queue behind it.
Existing clipboard, formatting, group and permission behavior remains in place. Account reads use a
ten-second caller deadline and a sixty-second raw-request lease. A later retry can supersede
stuck work, while identity guards reject obsolete results and protect the new request slot.

The user confirmed one-tap popup actions after installing 0.1.14. That is a limited observation
of 0.1.14, not a physical test of this new binary or every gesture and calendar flow.

Application source is [`7e43f1e59d389fdbcac2b057605d7928c0b22611`](https://github.com/khushbakhtm-star/context/commit/7e43f1e59d389fdbcac2b057605d7928c0b22611). TypeScript and
**535 full-suite tests** and **95 focused final tests** passed.
The [unsigned Android build](https://github.com/khushbakhtm-star/context/actions/runs/40415260329) used controller
`1dd6c0c299e04930929b089990466939d3c7f49b`; publisher signing stayed local. The
[exact source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40416783638) passed at that application source.
Public release **424859425**, APK asset **679753409**, matches the verified signed APK.
All six phone assets match their local files by size and digest. The signed APK is
**78,855,282 bytes**, SHA-256 `e1d8c783d8a1d6f74bb63c81df3b6d15825b54186deccbfaadcfadd499e620e6`.

Receipts verify native identity, Google/Wear configuration, actual Print/Sharing/calendar-color
class definitions, **63** packaged UI markers and **14** obsolete-control checks,
official signatures, publisher-certificate continuity and 16 KiB alignment. These checks do not
establish physical phone gestures, calendar synchronization or printing. No new FOSS, watch or
iOS binary is announced by this phone receipt; official store and F-Droid catalog acceptance
remain separate. The current UI receipt identifies the exact source; no superseded 0.1.16
receipt is included. Earlier release receipts, including 0.1.14's preserved report, remain below.

## Published 0.1.15 FOSS phone update

[Download the 0.1.15 FOSS phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.15/context-0.1.15-foss-preview.apk)
from the [public release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.15); both phone editions and all twelve checked files
were available by **2026-10-26 at 20:12:17 UTC**. Choose **Update** over the installed Context to retain its ledger.
This publisher-signed FOSS phone edition is code **16**. It omits native Google account sign-in
and optional Wear transport. Use the Wear-enabled phone edition for a paired Galaxy Watch7 or
native Google sign-in. The watch 0.1.8 binary is unchanged; this APK belongs on a phone.

The [independent F-Droid build and scans](https://github.com/khushbakhtm-star/context/actions/runs/40390963846) used
application source [`e34e2856d9449521560d316edb49c00d0bade5ab`](https://github.com/khushbakhtm-star/context/commit/e34e2856d9449521560d316edb49c00d0bade5ab) and controller `487d879edfc1743a17701c8e01ba262ff3b6430e`.
The structured source scan reported **zero errors and zero warnings**; integrated recipe assembly
and both APK scans passed. Audits matched **106 removed inputs,
5 source patches and 21 Wear removals**.
Actual Print, Sharing and calendar-color DEX class definitions were verified using the collected
registration and R8 evidence where applicable. Official APK signatures, original publisher
certificate, 16 KiB alignment and unchanged source-built protected content passed after signing.
TypeScript, **509 full-suite tests** and **69 focused final tests** passed at that source.
The [exact source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40392860838) also passed.

Public release **424707038**, FOSS APK asset **679330669**: **78,118,759 bytes**,
SHA-256 `92f5c27fbbccbdf50e16ef59436f3b37dcdd11877dea7bf5bc30932e9a078d06`. All twelve public assets match the locally verified files by size and digest. The current UI
receipt identifies the exact application source. No superseded 0.1.15 receipt is included;
earlier release evidence, including 0.1.14's preserved report, remains in the history.
The [permanent evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.15/context-0.1.15-foss-build-evidence.zip) contains
**23 checked files**, **7,682,938 bytes**,
SHA-256 `14016c3a4d5a3f84f0ad1d50fa70b83dce9af72840483075b2df18d0870ffebb`. It preserves source/native audits and class-definition evidence
independently of expiring Actions artifacts.

Use the FOSS Obtainium filter in [Android updates](ANDROID_UPDATES.md) for this phone edition.
This publisher preview and independent scan success do **not** establish official F-Droid catalog
acceptance. [Request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667) needs maintainer review.
This source adds matching monochrome icons to the **Dashboard / Print / Search / Settings**
dropdown and fills a selected multi-minute range when pasting one copied whole cell, including
its text, activity fill and formatting. Replace confirmation and atomic Undo remain available.
The user's one-tap popup confirmation concerned 0.1.14 after updating, not a physical test of
this binary. Physical gestures, calendar behavior, printing and two-phone synchronization
remain unverified for this new binary. No new watch or iOS binary is announced.

## Published 0.1.15 Wear-phone update

[Download the 0.1.15 phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.15/context-0.1.15-wear-phone-preview.apk)
from the [published release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.15); the six verified phone files were available by **2026-10-26 at 20:07:42 UTC**.
Choose **Update** over the installed Context to retain its ledger. This is the Wear-enabled
phone edition, code **16**. The separate watch companion remains 0.1.8.

The three-bar dropdown now pairs **Dashboard / Print / Search / Settings** with matching
monochrome icons. Copying one whole cell and pasting into a selected multi-minute range fills
every selected minute with that cell's text, activity fill and formatting. Occupied targets still
require Replace confirmation; the complete paste can be undone together. Native partial-text
copy remains separate from whole-cell Copy, and a Cut clipboard retains its move behavior.

The user confirmed one-tap popup actions after installing 0.1.14. That is a limited observation
of 0.1.14, not a physical test of this new binary or every gesture and calendar flow.

Application source is [`e34e2856d9449521560d316edb49c00d0bade5ab`](https://github.com/khushbakhtm-star/context/commit/e34e2856d9449521560d316edb49c00d0bade5ab). TypeScript and
**509 full-suite tests** and **69 focused final tests** passed.
The [unsigned Android build](https://github.com/khushbakhtm-star/context/actions/runs/40390840174) used controller
`84630a2997c63abc4c629da673367e834aef0534`; publisher signing stayed local. The
[exact source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40392860838) passed at that application source.
Public release **424707038**, APK asset **679319540**, matches the verified signed APK.
All six phone assets match their local files by size and digest. The signed APK is
**78,830,706 bytes**, SHA-256 `230b1ecb110f7e48ffbcfcc3e4c01d49e7713c0153622d5afa49e758d8dcd772`.

Receipts verify native identity, Google/Wear configuration, actual Print/Sharing/calendar-color
class definitions, **63** packaged UI markers and **14** obsolete-control checks,
official signatures, publisher-certificate continuity and 16 KiB alignment. These checks do not
establish physical phone gestures, calendar synchronization or printing. No new FOSS, watch or
iOS binary is announced by this phone receipt; official store and F-Droid catalog acceptance
remain separate. The current UI receipt identifies the exact source; no superseded 0.1.15
receipt is included. Earlier release receipts, including 0.1.14's preserved report, remain below.

## Published 0.1.14 FOSS phone update

[Download the 0.1.14 FOSS phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.14/context-0.1.14-foss-preview.apk)
from the [public release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.14); both phone editions and all thirteen checked files
were available by **2026-10-26 at 19:27:34 UTC**. Choose **Update** over the installed Context to retain its ledger.
This publisher-signed FOSS phone edition is code **15**. It omits native Google account sign-in
and optional Wear transport. Use the Wear-enabled phone edition for a paired Galaxy Watch7 or
native Google sign-in. The watch 0.1.8 binary is unchanged; this APK belongs on a phone.

The [independent F-Droid build and scans](https://github.com/khushbakhtm-star/context/actions/runs/40384762580) used
application source [`a388cc8eeba09664cd6fe0a4dc52da07ab19184f`](https://github.com/khushbakhtm-star/context/commit/a388cc8eeba09664cd6fe0a4dc52da07ab19184f) and controller `acf7e140316ac22e32ed5aca989c5b7945cc1335`.
The structured source scan reported **zero errors and zero warnings**; integrated recipe assembly
and both APK scans passed. Audits matched **106 removed inputs,
5 source patches and 21 Wear removals**.
Actual Print, Sharing and calendar-color DEX class definitions were verified using the collected
registration and R8 evidence where applicable. Official APK signatures, original publisher
certificate, 16 KiB alignment and unchanged source-built protected content passed after signing.
TypeScript, **502 full-suite tests** and **30 focused final tests** passed at that source.
The [exact source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40386290415) also passed.

Public release **424666263**, FOSS APK asset **679215007**: **78,114,663 bytes**,
SHA-256 `64af76c4c98c45f2fe647f248f4258383ed26e117fda998aab9ab565321bda86`. All thirteen public assets, including the archived superseded UI receipt,
match the locally verified files by size and digest. The corrected canonical UI receipt identifies
the exact application source; the report metadata correction did not change either APK.
The [permanent evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.14/context-0.1.14-foss-build-evidence.zip) contains
**23 checked files**, **7,684,132 bytes**,
SHA-256 `1b1735f794b7ce626699eabc9bcb4192a25d999dd90f0e15cc601dd1a70ccea7`. It preserves source/native audits and class-definition evidence
independently of expiring Actions artifacts.

Use the FOSS Obtainium filter in [Android updates](ANDROID_UPDATES.md) for this phone edition.
This publisher preview and independent scan success do **not** establish official F-Droid catalog
acceptance. [Request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667) needs maintainer review.
The updated header, single/double/long-press gestures, one-press cell commands and calendar focus
behavior still await user-device confirmation. Physical calendar, printing and two-phone behavior
also remain unverified for this binary. No new watch or iOS binary is announced.

## Published 0.1.14 Wear-phone update

[Download the 0.1.14 phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.14/context-0.1.14-wear-phone-preview.apk)
from the [published release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.14); the verified phone files were available by **2026-10-26 at 19:27:34 UTC**.
Choose **Update** over the installed Context; keep it installed to retain its ledger.
This is the Wear-enabled phone edition, code **15**. The existing watch 0.1.8 is unchanged.

The three-bar menu opens **Dashboard / Print / Search / Settings**. The calendar icon matches the
current Day, Week, Month, Year or Schedule view: single-tap returns to now in that view without
resetting pinch zoom; double-tap opens view choices; holding keeps the existing Pick/Range date
selection. There is no separate triangle. The two-arrow Sync icon retains manual synchronization;
error details remain available by holding it, without an added visual information badge.

Compact whole-cell commands sit outside the scrolling/pinching grid so responder capture does not
reserve their first tap. Native partial-text selection, source-event permissions, local-only save
acknowledgement and durable retry queues remain available. The current-time line is placed at the
lower edge of the current minute row. These are implemented behaviors; physical S23 verification
of the updated header, gesture and command handling remains pending.

Application source is [`a388cc8eeba09664cd6fe0a4dc52da07ab19184f`](https://github.com/khushbakhtm-star/context/commit/a388cc8eeba09664cd6fe0a4dc52da07ab19184f). TypeScript and
**502 full-suite tests** and **30 focused final tests** passed. The [unsigned Android build](https://github.com/khushbakhtm-star/context/actions/runs/40384615996)
used controller `dec48dd5ace5e1bac3f43f9993ca6f220ad3a30c`; publisher signing stayed local. The
[exact source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40386290415) passed at that application source.
Public release **424666263**, APK asset **679203557**, matches the verified signed APK.
All seven phone assets match their local files by size and digest. The signed APK is
**78,830,706 bytes**, SHA-256 `ac55dd2435c4390891198ca4d5d78893ca2b8879e6a2cb9217304a9f861603b7`.

Receipts verify native identity, Google/Wear configuration, actual Print/Sharing/calendar-color
class definitions, **63** packaged UI markers and **14** obsolete-control checks, official signatures,
publisher-certificate continuity and 16 KiB alignment. These checks do not establish physical
phone gestures, calendar synchronization or printing. No new FOSS, watch or iOS binary is
announced by this phone receipt; official store and F-Droid catalog acceptance remain separate.
The canonical UI receipt identifies the exact source. Its initial report had an unfilled source
label; that original report is retained as the explicitly superseded asset. Correcting report
metadata did not change the APK, its hash or its 63 packaged marker results.

## Published 0.1.13 FOSS phone update

[Download the 0.1.13 FOSS phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.13/context-0.1.13-foss-preview.apk)
from the [public release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.13); the added FOSS files were available by **2026-10-26 at 16:14:42 UTC**.
Choose **Update** and keep Context installed to retain its ledger. This is the publisher-signed
FOSS phone edition, code **14**, without native Google account sign-in or the optional Wear transport.
For a paired Galaxy Watch7 or native Google sign-in, retain the Wear-enabled phone edition below.
The existing watch 0.1.8 binary is unchanged; this APK belongs on a phone, not the watch.

The [independent F-Droid build and scans](https://github.com/khushbakhtm-star/context/actions/runs/40351936739)
used application source [`4c92502370158dfd7422471d17ffff9c5e15f87f`](https://github.com/khushbakhtm-star/context/commit/4c92502370158dfd7422471d17ffff9c5e15f87f)
and controller `9e942ea8929dca7c0031857ebc2bee3d4cf04fe4`. The structured source scan reported **zero errors and zero warnings**;
integrated recipe assembly and both APK scans passed. Audits matched **106 removed inputs, five source
patches and 21 Wear removals**. R8 mappings verified actual Print, Sharing and calendar-color class
definitions. Official APK signatures, the original publisher certificate, 16 KiB alignment and
unchanged source-built protected content passed separately after publisher signing.

Public release **424447225**, FOSS APK asset **678708182**: **78,106,471 bytes**,
SHA-256 `3d2cf466e1a6e436c0adf2351c0ca33f0981fa02131c7d120c07a287772bdc41`. All twelve public release assets match their locally verified files by size and digest.
The [permanent evidence ZIP](https://github.com/khushbakhtm-star/context/releases/download/v0.1.13/context-0.1.13-foss-build-evidence.zip)
contains 23 checked files: **7,683,399 bytes**, SHA-256 `794dc675595f7e92d1ade49e21782e587014eafc9d42b920de34a182a95cf46b`.
It preserves source/native audits and mapping evidence independently of expiring Actions artifacts.

Use the FOSS Obtainium filter in [Android updates](ANDROID_UPDATES.md) to stay on this phone edition.
This publisher preview and independent scan success do **not** establish official F-Droid catalog
acceptance. [Request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667) still needs maintainer review.
Physical phone, calendar, printing and two-phone behavior remain unverified for this binary;
no new watch or iOS binary is announced.

## Published 0.1.13 Wear-phone update

[Download the 0.1.13 phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.13/context-0.1.13-wear-phone-preview.apk)
from the [published release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.13), available since **2026-10-26 at 15:49:06 UTC**.
Choose **Update** over the installed Context and keep the app installed to retain its ledger.
This is the Wear-enabled phone edition, code **14**; the existing watch 0.1.8 remains compatible.

Tap once to select and double-tap to edit inline. Hold edited text for native partial Cut/Copy/Paste;
the keyboard checkmark saves locally and closes editing. After Done, hold a cell for whole-cell
clipboard actions, AutoFill, grouping, colors and formatting. Automatic minute/range popups and the
copied banner are removed. Clipboard commands acknowledge local work independently of account
requests; serialized SQLite writes and one-press command handling improve Undo/redo reliability.
Header **Sync** refreshes attached calendars; Settings, Print, Search and Dashboard are under the gear.
Foreground checks run roughly every 15 seconds while active, subject to permissions and provider
delays. Linked event-color imports preserve minute notes, activity membership and formatting;
competing local/calendar changes require review.

Consecutive identical notes use compact calendar time ranges while individual ledger minutes remain
editable. Update both participating Android phones to 0.1.13 before sharing version-two calendar
descriptions; older clients refuse this newer compact format. Existing source-event permissions remain required.

Application source is [`4c92502370158dfd7422471d17ffff9c5e15f87f`](https://github.com/khushbakhtm-star/context/commit/4c92502370158dfd7422471d17ffff9c5e15f87f).
TypeScript and **481 tests** passed. The [unsigned Android build](https://github.com/khushbakhtm-star/context/actions/runs/40350456395)
used controller `8f04e9ae663f3e4888ac642c5d1276c6b79721ce`; publisher signing stayed local. The
[exact source-tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40353051174) passed at that application source.
Public release **424447225**, APK asset **678637991**, matches the verified local signed APK.
All six attached assets match their locally verified files by size and digest.
The signed APK is **78,818,418 bytes**, SHA-256 `b5c5c448ed4349a464001418ddb34b1642ae905883fa03eb6d871ec2a96181e3`.

Attached receipts verify native identity, Google/Wear configuration, actual Print/Sharing/calendar-color
class definitions, 61 packaged UI markers, official APK signatures, publisher-certificate continuity
and 16 KiB alignment. These checks do not establish physical gestures, Undo, calendar synchronization
or printing; **physical 0.1.13 validation remains pending**. No new FOSS, watch or iOS binary is
announced here. Google OAuth remains in Testing; official stores and F-Droid catalog acceptance remain pending.

## Published 0.1.12 Wear-phone update

[Download the 0.1.12 phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.12/context-0.1.12-wear-phone-preview.apk)
from the [release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.12), available since
**2026-10-26 at 13:15:49 UTC**. Choose **Update** and keep Context installed to retain its ledger.
This is the Wear-enabled phone edition, code **13**; the existing watch 0.1.8 remains compatible.
[Share the permanent installation guide and QR code](SHARE_CONTEXT.md) for Obtainium updates.

Generated calendar descriptions now contain timestamped notes without category labels, Context IDs or
footers. Private metadata preserves account event ownership, original descriptions and editable minute
logs. Existing owned legacy events are cleaned on their next authorized update. Uncertain native links
pause for review; enabling account editing alone does not adopt an existing native-calendar event.
Single-phone backups remain supported, and a verified second ledger actor enables peer safeguards.

The release also adds contextual cell menus, group moves and partial Ungroup; direct header controls;
Day/Week/Month/Year/Schedule; Pick or a finger-glide Range of up to 28 days; full source event color
fills; configurable calendar/Schedule/Dashboard PDF printing; and recorded/unrecorded Dashboard bars.

Application source is [`2ef41523c124007968ae10163867d8cba3dc0c87`](https://github.com/khushbakhtm-star/context/commit/2ef41523c124007968ae10163867d8cba3dc0c87).
TypeScript and **426 tests** passed. The [unsigned build](https://github.com/khushbakhtm-star/context/actions/runs/40326992220)
used controller `32d699895851b275fc757308baaf66911bfce3b4`; publisher signing stayed local. The builder
preserves three audited native module identities through R8 so its strict DEX checks remain valid.
The [exact tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40329070841) passed at that source.
Public release **424270052**, APK asset **678216768**, matches the verified local signed APK:
**78,773,362 bytes**, SHA-256 `797c59d1fab41984b8392aa8f0865a4a10f91b74315f27a90704eb82ecf0f8eb`.

The release's attached receipts record native package identity, Google/Wear configuration, native
Print/Sharing/calendar-color definitions, official APK signatures, certificate continuity, 16 KiB ZIP
alignment and packaged UI labels. These checks do not establish physical gestures, printing, calendar
runtime behavior or two-phone synchronization; **physical 0.1.12 validation remains pending**.
Google OAuth remains in Testing. No new FOSS, watch or iOS binary is included; official store and
F-Droid catalog availability remain pending.


## Published 0.1.11 Wear-phone update

[Download the 0.1.11 Wear-phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.11/context-0.1.11-wear-phone-preview.apk)
from the [published release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.11), available
since **2026-10-26 at 05:45:40 UTC**, then open it and choose **Update**. Keep Context installed to
retain its ledger. This is the phone-only 0.1.11/code 12 update; the compatible watch 0.1.8 companion
is unchanged. No new FOSS, watch or iOS binary is included. The verified F-Droid candidate remains 0.1.8.

Gray previous/next arrows flank the calendar icon, which always shows today's date. Tap it to reach
the current minute, or hold it to select exact dates. One to seven selected dates use minute columns;
eight or more use a month overview showing event times and titles. **Day**, **3 days**, and **Week**
remain directly in the main menu. The grid uses pinch zoom, without the old month popup, date-entry
box, zoom buttons or percentage. Choose **12-hour time with AM/PM** or **24-hour time** in Settings.
Settings and account screens use concise action labels with gray information buttons for explanations,
while connection states, errors and review notes remain visible.

The public tag resolves to exact application source
[`0d39268f375721f4f98729100ee8ac8f79b468e8`](https://github.com/khushbakhtm-star/context/commit/0d39268f375721f4f98729100ee8ac8f79b468e8).
TypeScript, **272 tests**, scoped source checks and review passed. The
[unsigned Android build](https://github.com/khushbakhtm-star/context/actions/runs/40275001446) passed
at controller `ebdd7a239d79b6fc995a37f762b6d912fdbd92fa`, with native assembly successful in 6m56s.
Publisher signing followed locally using the existing key, after Expo's monthly Android build quota
was exhausted. The [exact v0.1.11 tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40275968460)
also passed at that application source.

Public release **423894793**, APK asset **677156691**, matches the locally checked signed APK:
**78,548,026 bytes**, SHA-256
`0bf9d623ea93441cbb1629a8536dce6ce295b655ee005540dd7d56eee7497318`.
Native package/version checks, official `apksigner` v2/v3 verification, publisher-certificate continuity
and 16 KiB alignment checks passed. The published verification receipts also confirm the packaged
Google/Wear configuration and required UI strings, with obsolete Today labels absent. These binary
checks do not establish screen layout or gesture behavior; **physical 0.1.11 interface validation remains pending**.

Google OAuth remains in **Testing** for approved accounts. The user confirmed Google sign-in on the
S23 in 0.1.9 and an existing watch note reaching the phone ledger; those observations do not establish
physical 0.1.11 UI validation or encrypted-ledger synchronization between two phones. The earlier
0.1.10/code 11 APK was verified locally but superseded before publication; there is no public 0.1.10
release, tag or availability entry.

## Published 0.1.9 Wear-phone update

[Download the 0.1.9 Wear-phone APK](https://github.com/khushbakhtm-star/context/releases/download/v0.1.9/context-0.1.9-wear-phone-preview.apk)
from the [published release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.9), available
since **2026-10-26 at 03:27:45 UTC**, then open it and choose **Update**. Keep Context installed to
retain its ledger. It uses version 0.1.9/code 10 and the existing compatible publisher certificate.
The existing 0.1.8 watch APK remains compatible and unchanged. No new FOSS or iOS binary is included;
the verified F-Droid candidate remains 0.1.8.

The phone was built from `cf09982de3b70a1278786572a9d0b49264bc7e46` through the
[unsigned GitHub build](https://github.com/khushbakhtm-star/context/actions/runs/40262475236), controlled by
`b9081edfd6c69ff1089307db42b2ae2e708e2ce6`, then signed locally after Expo's monthly Android build
quota was exhausted. The public tag resolves to that exact application source. Public asset
676873751's size/digest match the locally inspected signed APK: 78,515,258 bytes,
SHA-256 `d4f0e5338138d2f489850ac6ff53484faa24cf85493520eea408897b57e8bedd`.
Native identity checks show 0.1.9/code 10, minimum SDK 24 and target SDK 36. Official `apksigner`
v2/v3 verification, publisher-certificate continuity and 16 KiB alignment checks passed.
The [exact v0.1.9 tag workflow](https://github.com/khushbakhtm-star/context/actions/runs/40264191419)
also passed at that application source.

Google OAuth is configured for the publisher's approved **Testing** accounts only. The user confirmed
Google sign-in on their Galaxy S23. That confirmation covers sign-in on that phone; synchronization
of the encrypted ledger between two phones remains unverified. The iOS client ID is configured,
but no iOS app was built.

## Install the Android preview update

Open the [0.1.8 release](https://github.com/khushbakhtm-star/context/releases/tag/v0.1.8), expand
**Assets**, and choose the APK for the device and edition:

| APK | Install on | Included features |
| --- | --- | --- |
| [context-0.1.8-foss-preview.apk](https://github.com/khushbakhtm-star/context/releases/download/v0.1.8/context-0.1.8-foss-preview.apk) | Android phone | Ledger/calendars; excludes the optional Google Wear transport |
| [context-0.1.8-wear-phone-preview.apk](https://github.com/khushbakhtm-star/context/releases/download/v0.1.8/context-0.1.8-wear-phone-preview.apk) | Android phone paired with a Wear OS watch | Ledger/calendars plus the optional native watch bridge |
| [context-0.1.8-wear-preview.apk](https://github.com/khushbakhtm-star/context/releases/download/v0.1.8/context-0.1.8-wear-preview.apk) | Wear OS watch | Native watch companion; requires the matching Wear-enabled phone app |

Choose one phone edition, open its downloaded APK, and choose **Update** over Context 0.1.7.
Keep Context installed to preserve its ledger. Both phone editions use the existing application ID,
compatible publisher certificate and increasing version code 9; the watch uses code 100009.
The watch APK belongs on the watch. Follow the separate [watch setup](../apps/mobile/wear-support/README.md)
for wireless installation. Open the Wear-enabled phone app and explicitly enable **Settings → Paired
watch** access. The native watch app offers a minute list, date navigation, typing/dictation and an
offline note journal. Phone ledger changes apply when Context runs; conflicts retain both versions
for review. The user confirmed that a note entered on their Galaxy Watch7 reached the phone ledger.

The user later confirmed the phone 0.1.7 calendar result on the S23: Check connection showed eight
timed events, and the events then appeared in Today. This resolves that reported blank-calendar
test.

The existing [Obtainium setup](ANDROID_UPDATES.md) selects only `-foss-preview.apk` phone assets.
For a Wear-enabled phone, configure its APK filter to select only:

```text
^context-[0-9]+\.[0-9]+\.[0-9]+-wear-phone-preview\.apk$
```

Keep prereleases enabled. This avoids selecting either the watch APK or the FOSS phone edition as
a Wear-phone update. Context's release checks distinguish `standalone` and `standalone-wear` phone
channels; a release in one channel does not announce an update in the other.

Official F-Droid inclusion remains pending at [request #4667](https://gitlab.com/fdroid/rfp/-/work_items/4667).
These publisher-signed GitHub previews are not official F-Droid, Google Play or Apple store listings.
The F-Droid edition omits the optional Google Wear transport and watch project; an eventual official
F-Droid signer also differs from this publisher-signed watch's required same-signer phone companion.

## Update notices

The app checks only when the user enables **Settings → Check for released updates**, while it is
open. It checks on launch/return to the foreground and periodically while active, at most once every
six hours, with a manual **Check now** option. Failed automatic requests remain silent. No ledger,
account, device identifier, or installed version is sent in the request; the HTTPS host still sees
ordinary connection metadata. Notices can be dismissed separately for each release. Settings keeps
the release link available after dismissal. The app never downloads or installs a binary itself.

This is an in-app notice, not a push notification while Context is closed. Older installed binaries
without this feature need a normal app update before they can show these notices. Play, App Store,
and F-Droid clients provide their own update mechanisms independently.

## Build configuration

The default feed is the publisher's public `releases/latest.json` on the `main` branch of
[`khushbakhtm-star/context`](https://github.com/khushbakhtm-star/context). A fork can override
`EXPO_PUBLIC_CONTEXT_RELEASE_MANIFEST_URL` with its own public HTTPS JSON URL and rebuild;
an explicit empty value disables the feed. The build profile sets `EXPO_PUBLIC_CONTEXT_RELEASE_CHANNEL` to one of
`google-play`, `apple-app-store`, `fdroid`, `standalone`, or `standalone-wear`. A FOSS preview APK is `standalone`, even if it
uses the FOSS dependencies; it cannot be updated by an F-Droid signing key. A clean F-Droid source
build defaults to `fdroid` through its distribution variable. Other unlabelled builds default to
`standalone` rather than guessing which store signed them. The Wear-enabled phone uses embedded
`store` distribution with the separate `standalone-wear` update channel; those are distinct settings.

Apple builds additionally require `EXPO_PUBLIC_CONTEXT_APP_STORE_ID`, the actual numeric app ID
created in App Store Connect. Standalone builds trust the publisher's GitHub releases page by default;
`EXPO_PUBLIC_CONTEXT_STANDALONE_RELEASE_URL` overrides that exact trusted HTTPS release-page URL.
A fork must supply its own feed and signing-channel release page. The Apple store ID remains unset
until that destination exists. Missing required configuration disables checking.
Release identity comes from the embedded Expo configuration; iOS also uses its installed
Info.plist build number. These builds use source-controlled local version numbers and do not
enable remote JavaScript updates. Release checks validate the native build identity against the
source configuration. Expo Go and development bundles are excluded. Context has no direct
`expo-application` dependency for release identity. AuthSession still reaches it transitively;
the F-Droid preparation patches out its Android Install Referrer source and dependency.

## Schema version 1

The root contains `schemaVersion: 1` and a `releases` array (at most 100 entries). Each entry has:

| Field | Required value |
| --- | --- |
| `platform` | `android` or `ios` |
| `channel` | `google-play`, `apple-app-store`, `fdroid`, `standalone`, or `standalone-wear` |
| `applicationId` | Exact installed Android application ID or iOS bundle ID |
| `version` | Numeric `major.minor.patch`, such as `0.1.1` |
| `buildNumber` | Android positive integer version code; iOS positive numeric build string, optionally dotted |
| `released` | Boolean `true`, only after verified availability |
| `publishedAt` | Actual UTC publication timestamp in ISO format, such as `2026-10-25T12:00:00.000Z` |
| `url` | Validated HTTPS destination for that channel |

Entries must match the installed platform, channel, and application ID. Android requires a newer
build number and a version at least as new as the installed version. iOS requires a newer marketing
version, or a newer build within the same marketing version. Future publication timestamps,
draft/pending entries, malformed versions, mismatched channels, and untrusted links are ignored.

Google Play URLs must use `play.google.com/store/apps/details` with only `id` set to the installed
package. F-Droid URLs must use `f-droid.org/packages/<installed-package>/`. Apple URLs must use
`apps.apple.com` and the actual configured numeric app ID. Standalone URLs must exactly match the
trusted release page compiled into the installed app. Links with HTTP, credentials, explicit
nonstandard ports, fragments, or unrelated hosts do not qualify. The feed request omits credentials,
rejects redirects, times out after ten seconds, and caps its accepted response size.

`apps/mobile/src/services/updates.ts` exports `parseReleaseManifest` and `selectAvailableRelease`
for runtime and release-tool validation. A syntactically valid feed is not proof of public store
availability; the publisher must perform that check before committing a released entry. Removing
an unavailable entry stops future checks from offering it; it cannot retract a link already shown
on a phone until that phone fetches the feed again.
