# Context on Galaxy Watch7

## Current matching releases

Use the [Wear-enabled phone 0.1.32/code33](https://github.com/khushbakhtm-star/context/releases/download/v0.1.32/context-0.1.32-wear-phone-preview.apk) with the separately published [Watch 0.1.15/code100016](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.15). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.31

Use the [Wear-enabled phone 0.1.31/code32](https://github.com/khushbakhtm-star/context/releases/download/v0.1.31/context-0.1.31-wear-phone-preview.apk) with the separately published [Watch 0.1.15/code100016](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.15). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Published 0.1.15 Watch update

The separate [Watch 0.1.15/code100016 release](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.15) and all five verified assets were available by **2026-10-30 at 13:44:59 UTC**, release **429082830**. [Watch APK](https://github.com/khushbakhtm-star/context/releases/download/watch-v0.1.15/context-0.1.15-wear-preview.apk) (asset 692251130): **11,441,990 bytes**, SHA-256 `f649cfe533b8819eec0709b5e71450e428e8d8e1dec053aafd45077efcd8cfa8`. Public asset sizes/digests match verified local files. The exact tag points to application source `58d9f0e252015821bbb319db51175308701c8533`; [build 41064233780](https://github.com/khushbakhtm-star/context/actions/runs/41064233780) used controller `e5149d1f413d6510b64e9414d5ca72967813b684`. Signing stayed local with the existing publisher certificate.

A fresh app-icon launch or the Tile's current-minute row starts current-minute dictation when no editor is protected. Available on-device speech is preferred; otherwise the installed system speech provider starts and may need internet on the watch or paired phone. A high-contrast vector emblem identifies the app shortcut and Tile. The Tile shows five cached minute rows centered on the current minute: its current row resolves Now when tapped, while neighboring rows open the exact displayed date and minute for manual entry without an automatic microphone. Cached rows do not wait for the phone or network. The bounded minute-valid timeline and requested minute refresh can still be delayed by the system; cached notes can lag phone changes. Active drafts and speech keep their original minute, and deferred navigation does not start a microphone. Recognized phrases are retained across provider phrase endings. After the configured quiet interval, a nonempty note is saved and the minute list returns; an empty fresh capture closes without creating a note. Existing unsaved text, color choices and save-retry drafts remain editable. The default is 10 seconds, with a bounded final-result flush. The small gear retains the 5, 10, 15, 30 and 60-second presets and adds a Seconds field for any whole number from 1 through 300; the chosen delay remains local. Done can still save immediately; errors retain the draft. Normal navigation, dismissal, background, settings cancellation and stale callbacks do not start a hidden microphone or save another minute. The screen stays awake only during active visible dictation, its silence wait and final-result flush; settings, errors, Cancel, Type, Done and background release that wake hold.

The actual native build ran 106 JVM cases (0 skipped) with zero failures/errors; all 8 required suites were verified. 10 actual native class definitions, compiled Tile/logo and microphone/query/clock checks, protected ZIP contents, original publisher certificate, official supported-SDK v3 verification, separate contained-v2 proof and 16 KiB alignment passed. No runtime support below minimum SDK30 is claimed. These automated checks do not establish physical-watch speed, offline-model availability or live paired-phone delivery.

Use with the separate Wear-enabled phone **0.1.31/code32**. Install as an Update on the watch to preserve its saved data. Phone APKs and their update feed remain unchanged. This optional Google-dependent companion is separate from official Play/Apple store or F-Droid catalog availability.

## Previous matching releases: phone 0.1.31 / Watch 0.1.14

Use the [Wear-enabled phone 0.1.31/code32](https://github.com/khushbakhtm-star/context/releases/download/v0.1.31/context-0.1.31-wear-phone-preview.apk) with the separately published [Watch 0.1.14/code100015](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.14). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Published 0.1.14 Watch update

The separate [Watch 0.1.14/code100015 release](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.14) and all five verified assets were available by **2026-10-30 at 12:44:31 UTC**, release **429022602**. [Watch APK](https://github.com/khushbakhtm-star/context/releases/download/watch-v0.1.14/context-0.1.14-wear-preview.apk) (asset 692095703): **11,429,646 bytes**, SHA-256 `ed2b9edc94b6f84a5fd65dc3225bc97690adbe21be46d687be2ae914423f97c5`. Public asset sizes/digests match verified local files. The exact tag points to application source `0684437feca86ccda22198bf6050e27f1736fb1c`; [build 41056471618](https://github.com/khushbakhtm-star/context/actions/runs/41056471618) used controller `9c714b8a38d24bff6480c9e06e665c715dcdca07`. Signing stayed local with the existing publisher certificate.

Opening Context from a genuine visible app-icon or Tile entry starts one current-minute dictation session. Available on-device speech is preferred; otherwise the installed system speech provider starts and may need internet on the watch or paired phone. Recognized phrases are retained across provider phrase endings. After the configured quiet interval, a nonempty note is saved and the minute list returns; an empty fresh capture closes without creating a note. Existing unsaved text, color choices and save-retry drafts remain editable. The default is 10 seconds, with a bounded final-result flush. The small gear offers 5, 10, 15, 30 or 60 seconds and retains the chosen delay locally. Done can still save immediately; errors retain the draft. Normal navigation, dismissal, background, settings cancellation and stale callbacks do not start a hidden microphone or save another minute.

The actual native build ran 80 JVM cases (0 skipped) across all 7 required suites with zero failures/errors. 10 actual native class definitions, compiled Tile/logo and microphone/query/clock checks, protected ZIP contents, original publisher certificate, official supported-SDK v3 verification, separate contained-v2 proof and 16 KiB alignment passed. No runtime support below minimum SDK30 is claimed. These automated checks do not establish physical-watch speed, offline-model availability or live paired-phone delivery.

Use with the separate Wear-enabled phone **0.1.31/code32**. Install as an Update on the watch to preserve its saved data. Phone APKs and their update feed remain unchanged. This optional Google-dependent companion is separate from official Play/Apple store or F-Droid catalog availability.

## Previous matching releases: phone 0.1.31 / Watch 0.1.13

Use the [Wear-enabled phone 0.1.31/code32](https://github.com/khushbakhtm-star/context/releases/download/v0.1.31/context-0.1.31-wear-phone-preview.apk) with the separately published [Watch 0.1.13/code100014](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.13). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Published 0.1.13 Watch update

The separate [Watch 0.1.13/code100014 release](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.13) and all five verified assets were available by **2026-10-29 at 19:51:02 UTC**, release **428326341**. [Watch APK](https://github.com/khushbakhtm-star/context/releases/download/watch-v0.1.13/context-0.1.13-wear-preview.apk) (asset 689718782): **11,413,206 bytes**, SHA-256 `88e241c8b94b96790c104e2f5988186705131449cbf2bee2b7420a009e8e5b1a`. Public asset sizes/digests match verified local files. The exact tag points to application source `fddefda295c5103fec26ef75ea2f2c7ab4a17b23`; [build 40942573091](https://github.com/khushbakhtm-star/context/actions/runs/40942573091) used controller `ab332f2f9c1481a18e2cb755a1dd942fbc4f1fa3`. Signing stayed local with the existing publisher certificate.

Dictate starts listening directly: available on-device speech is preferred; otherwise the installed system speech provider starts automatically and may need internet on the watch or paired phone. An unavailable on-device recognizer or language model can fall back to system speech once per visible note. Other failures retain Continue and Type; no automatic error-retry loop is introduced. Phrase completion retains displayed words, and only Done confirms a durable note. The compact clock and original selected minute remain separate; dismissal, background and stale callbacks cannot save another minute.

The actual native build ran 58 JVM cases (0 skipped) across all six required suites with zero failures/errors. Nine actual native class definitions, compiled Tile/logo and microphone/query/clock checks, protected ZIP contents, original publisher certificate, official supported-SDK v3 verification, separate contained-v2 proof and 16 KiB alignment passed. No runtime support below minimum SDK30 is claimed. These automated checks do not establish physical-watch speed, offline-model availability or live paired-phone delivery.

Use with the separate Wear-enabled phone **0.1.31/code32**. Install as an Update on the watch to preserve its saved data. Phone APKs and their update feed remain unchanged. This optional Google-dependent companion is separate from official Play/Apple store or F-Droid catalog availability.

## Previous matching releases: phone 0.1.31 / Watch 0.1.12

Use the [Wear-enabled phone 0.1.31/code32](https://github.com/khushbakhtm-star/context/releases/download/v0.1.31/context-0.1.31-wear-phone-preview.apk) with the separately published [Watch 0.1.12/code100013](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.12). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.30

Use the [Wear-enabled phone 0.1.30/code31](https://github.com/khushbakhtm-star/context/releases/download/v0.1.30/context-0.1.30-wear-phone-preview.apk) with the separately published [Watch 0.1.12/code100013](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.12). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.29

Use the [Wear-enabled phone 0.1.29/code30](https://github.com/khushbakhtm-star/context/releases/download/v0.1.29/context-0.1.29-wear-phone-preview.apk) with the separately published [Watch 0.1.12/code100013](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.12). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Published 0.1.12 Watch update

The separate [Watch 0.1.12/code100013 release](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.12) contains five checked public assets. [Watch APK](https://github.com/khushbakhtm-star/context/releases/download/watch-v0.1.12/context-0.1.12-wear-preview.apk): **11,413,206 bytes**, SHA-256 e561adbd89f9a07e0e1e12df80c2d7a11300f513f8ef31947ae243a7db321e35.

[Build 40765201069](https://github.com/khushbakhtm-star/context/actions/runs/40765201069) used controller a901778614532fe27d19e4af586d28a1351b14e1 and exact application source 5586f4a305a71956aeabaa035fa350861b6b6cf9.

Dictation keeps a compact 10sp clock in an 18dp row and a fixed selected-note minute. Phrase completion retains words without saving or closing; recognition restarts only while the same note dialog is current and visible. Done explicitly confirms the displayed note, including the latest hypothesis, as one durable operation. Type or lifecycle interruption keeps an editable draft; Cancel never autosaves, and late callbacks are rejected. On-device recognition depends on watch/model support; system speech is an explicit choice and may need internet. Keep Context active on the phone to apply its durable inbox to the ledger.

The actual build ran 55 JVM cases (0 skipped), including all six required suites. Nine actual native class definitions, compiled Tile/logo resources, microphone/query/clock checks, protected ZIP contents, original publisher certificate, official supported-SDK v3 verification, separate contained-v2 proof and 16 KiB alignment passed. No runtime support below minimum SDK30 is claimed. Install as an Update on the watch. Speech/model availability, Bluetooth delivery speed and physical Watch7 behavior still require device confirmation. This optional companion remains separate from phone APKs and store/catalog availability.



## Previous matching releases: 0.1.28

Use the [Wear-enabled phone 0.1.28/code29](https://github.com/khushbakhtm-star/context/releases/download/v0.1.28/context-0.1.28-wear-phone-preview.apk) with the separately published [Watch 0.1.11/code100012](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.11). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Published 0.1.11 Watch update

The separate [Watch 0.1.11/code100012 release](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.11) contains five checked public assets. [Watch APK](https://github.com/khushbakhtm-star/context/releases/download/watch-v0.1.11/context-0.1.11-wear-preview.apk): **11,409,110 bytes**, SHA-256 c2a2fed1b32bdb4b960bb112809bd41321582aca1f8e69ba461026d754cd7b29.

[Build 40756438963](https://github.com/khushbakhtm-star/context/actions/runs/40756438963) used controller 526e4fa2ec6bda15eb5b56ad3653783d50cc64d1 and exact application source 25e230bf09beaed4f22c112b9e25e7a3bd1caea5.

Dictation stays inside Context with a live seconds clock honoring the existing 12/24-hour preference and a fixed selected-note minute. Dictate requests watch microphone access. Available on-device speech is preferred; system speech is an explicit choice and may need internet. Typed entry remains available. Confirmed words use durable save authority; partial words are drafts only. A coalesced sender prioritizes pending notes over full-day reads. Keep Context active on the phone to apply its durable inbox to the ledger.

The actual build ran 51 JVM cases (0 skipped), including all six required suites. Eight actual native class definitions, compiled Tile/logo resources, microphone/query/clock checks, protected ZIP contents, original publisher certificate, official supported-SDK v3 verification, separate contained-v2 proof and 16 KiB alignment passed. No runtime support below minimum SDK30 is claimed. Install as an Update on the watch. Speech/model availability, Bluetooth delivery speed and physical Watch7 behavior still require device confirmation. This optional companion remains separate from phone APKs and store/catalog availability.



## Previous matching releases: 0.1.27

Use the [Wear-enabled phone 0.1.27/code28](https://github.com/khushbakhtm-star/context/releases/download/v0.1.27/context-0.1.27-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.26

Use the [Wear-enabled phone 0.1.26/code27](https://github.com/khushbakhtm-star/context/releases/download/v0.1.26/context-0.1.26-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.25

Use the [Wear-enabled phone 0.1.25/code26](https://github.com/khushbakhtm-star/context/releases/download/v0.1.25/context-0.1.25-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.24

Use the [Wear-enabled phone 0.1.24/code25](https://github.com/khushbakhtm-star/context/releases/download/v0.1.24/context-0.1.24-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.23

Use the [Wear-enabled phone 0.1.23/code24](https://github.com/khushbakhtm-star/context/releases/download/v0.1.23/context-0.1.23-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.22

Use the [Wear-enabled phone 0.1.22/code23](https://github.com/khushbakhtm-star/context/releases/download/v0.1.22/context-0.1.22-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.21

Use the [Wear-enabled phone 0.1.21/code22](https://github.com/khushbakhtm-star/context/releases/download/v0.1.21/context-0.1.21-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.20

Use the [Wear-enabled phone 0.1.20/code21](https://github.com/khushbakhtm-star/context/releases/download/v0.1.20/context-0.1.20-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

## Previous matching releases: 0.1.19

Use the [Wear-enabled phone 0.1.19/code20](https://github.com/khushbakhtm-star/context/releases/download/v0.1.19/context-0.1.19-wear-phone-preview.apk) with the separately published [Watch 0.1.10/code100011](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10). The FOSS phone edition has no watch transport. Keep each app installed and choose Update.

This companion uses Wear OS. It opens at the current minute and lets you scroll earlier or later minutes, move between dates, and tap a minute to type or dictate a remembered activity. The editor keeps the selected date and minute while you write. **Now** returns to the current minute. A downloaded day is available offline.

## Matching phone edition

The companion needs the **Wear-enabled Android phone APK**, not the FOSS preview APK. Both APKs must use application ID com.context.minuteledger and the same signing certificate. Existing publisher-signed phone previews can be updated in place; keep Context installed to retain its ledger. Never uninstall merely to work around a signing error.

In the phone app, open **☰ → Settings → Paired watch** and turn on **Allow paired watch access** after reading the explanation. This permits the paired watch to read requested days and write minute notes. It starts off. Keep Context open on the phone while synchronizing.

A watch save first commits a private local journal. **Waiting for phone** means the phone has not confirmed the ledger write yet; the note remains on the watch. Reopening Context on the phone applies waiting edits. If the same minute changed on both devices, review both notes in phone Settings and choose **Keep phone note**, **Append watch note**, or **Use watch note**. A newer phone edit requires a fresh review.

Turning watch access off stops further phone transport and withdraws queued phone snapshots when Play services is available. Previously downloaded watch data and unsaved watch notes remain on the watch. Access is granted to the paired app through Wear OS Data Layer; Context does not request another calendar account login on the watch.

## Install a verified preview

Release assets are published only after the actual native builds and package/signing checks pass. Until then, this guide is source preparation, not a claim that a watch release is available.

1. Update the phone with the release's **wear-phone-preview.apk** asset. Choose **Update**, keeping the current installation.
2. Install the matching **wear-preview.apk** asset on the watch. A phone APK cannot run as a watch APK.
3. Open both apps, enable paired watch access on the phone, and allow synchronization to complete.

Without a configured Play Store publisher release, watch installation uses Wear OS wireless debugging from a computer. The user must enable this access and approve pairing on the watch. The pairing port and connection port are different. Android's official platform tools then support:

~~~text
adb pair WATCH_IP:PAIRING_PORT
adb connect WATCH_IP:CONNECTION_PORT
adb -s WATCH_IP:CONNECTION_PORT install -r PATH_TO_VERIFIED_WATCH_APK
~~~

Enter the code shown by the watch only at the pairing prompt. After installation and testing, turn off wireless debugging if it is no longer needed. This is separate from Context's in-app paired watch access.

## Updates and F-Droid

For the Wear-enabled phone edition, configure Obtainium with the same GitHub repository, Include prereleases, and this APK filter:

~~~text
^context-[0-9]+\.[0-9]+\.[0-9]+-wear-phone-preview\.apk$
~~~

The single-app configuration is [context-wear-obtainium.json](context-wear-obtainium.json). Replace the existing FOSS APK filter when switching editions; do not add another entry for the same installed application. Watch updates require the watch installer until Play distribution is configured. The phone update feed uses a separate standalone-wear channel so it cannot offer the FOSS edition as a Wear update.

The optional watch transport uses Google Play services. Context's F-Droid preparation removes the reviewed native Wear project and phone bridge before scanning/building; that edition does not provide this transport. Official F-Droid inclusion remains under maintainer review. Google Play and Apple distribution still require the publisher accounts and their separate reviews.

Physical checks on the paired Galaxy Watch7 remain required: small round-screen layout, typing/dictation, scrolling, earlier-day entry, midnight, offline save/reconnect, phone restart, conflict review, and access revocation. Source tests and native assembly alone do not establish those results.

Official references: [Wear OS debugging](https://developer.android.com/training/wearables/get-started/debugging), [Data Layer](https://developer.android.com/training/wearables/data/overview), [Android platform tools](https://developer.android.com/tools/releases/platform-tools).

## Watch 0.1.10 dictation update

The separate [Watch 0.1.10 APK](https://github.com/khushbakhtm-star/context/releases/download/watch-v0.1.10/context-0.1.10-wear-preview.apk) saves an accepted dictation
result automatically to the minute opened by that editor. Keyboard entry still uses Save.
Install as an Update on the watch; use the Wear-enabled phone 0.1.29. The [release](https://github.com/khushbakhtm-star/context/releases/tag/watch-v0.1.10)
contains the exact source and automated build/package/signature receipts. Physical dictation
and reconnect behavior still need checking after this watch update.
