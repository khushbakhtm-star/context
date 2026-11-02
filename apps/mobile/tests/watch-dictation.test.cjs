const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const directory = path.join(__dirname, '../wear-support/watch/src/main/java/com/context/minuteledger/wear');
const read = (name) => fs.readFileSync(path.join(directory, name), 'utf8');
const activity = read('MinuteActivity.kt');
const dialog = read('WatchDictationDialog.kt');
const policy = read('WatchDictationPolicy.kt');
const availability = read('WatchSpeechAvailabilityCache.kt');

test('watch dictation owns its visible clock while retaining a separate immutable note minute and clock preference', () => {
  assert.match(dialog, /private val clock = label\("", 10f\)\.apply \{ setTypeface\(Typeface\.MONOSPACE, Typeface\.NORMAL\)/);
  assert.match(dialog, /heading\.addView\(clock, LinearLayout\.LayoutParams\(0, dp\(18\), 1f\)\)/);
  assert.match(dialog, /clock\.text = "Now \$\{WatchDictationPolicy\.clock\(LocalDateTime\.now\(\), twelveHourClock\)\}"/);
  assert.match(dialog, /handler\.postDelayed\(this, 1000\)/);
  assert.match(dialog, /minuteLabel\(target, twelveHourClock\)/);
  assert.match(activity, /WatchDictationDialog\(this, session\.coordinate, twelveHourClock,/);
  assert.match(policy, /"h:mm:ss a" else "HH:mm:ss"/);
  assert.doesNotMatch(dialog, /startActivityForResult|WatchStore|WatchTransport|MediaRecorder|AudioRecord|FileOutputStream/);
});

test('Dictate begins available speech directly, preferring on-device recognition without an extra provider-choice button', () => {
  assert.match(dialog, /Build\.VERSION\.SDK_INT >= 31 && runCatching\s*\{\s*SpeechRecognizer\.isOnDeviceRecognitionAvailable/);
  assert.match(dialog, /SpeechRecognizer\.createOnDeviceSpeechRecognizer\(activity\)/);
  const automaticShow = dialog.slice(dialog.indexOf('fun show()'), dialog.indexOf('fun cancel('));
  assert.match(automaticShow, /dialog\.show\(\); handler\.post\(ticker\)[\s\S]*silence\.resume\(SystemClock\.elapsedRealtime\(\), silenceDelaySeconds\)[\s\S]*start\(false\)/);
  assert.doesNotMatch(dialog, /Use system speech|systemButton/);
  assert.match(policy, /!preferSystem && api >= 31 && onDeviceAvailable -> WatchSpeechBackend\.ON_DEVICE\s*systemAvailable -> WatchSpeechBackend\.SYSTEM/);
  assert.match(dialog, /if \(backend == WatchSpeechBackend\.SYSTEM\) systemAttempted = true/);
  const failure = dialog.slice(dialog.indexOf('private fun failed('), dialog.indexOf('private fun stopRecognizer'));
  assert.match(failure, /isCurrent\(\) && backend == WatchSpeechBackend\.ON_DEVICE &&[\s\S]*WatchDictationPolicy\.retryWithSystem\(backend, reason,[\s\S]*availability\.system\(SystemClock\.elapsedRealtime\(\), ::probeSystem\), systemAttempted\)/);
  assert.match(failure, /start\(true\)\s*return/);
  assert.match(dialog, /EXTRA_PREFER_OFFLINE, true/);
  assert.match(dialog, /setRecognitionListener[\s\S]*speech\.startListening/);
});

test('watch capture defers capability queries until visible start and avoids unnecessary repeat system probes', () => {
  const beforeInit = dialog.slice(0, dialog.indexOf('    init {'));
  assert.doesNotMatch(beforeInit, /SpeechRecognizer\.is(?:OnDeviceRecognitionAvailable|RecognitionAvailable)\(activity\)/);
  const start = dialog.slice(dialog.indexOf('private fun start('), dialog.indexOf('private fun failed('));
  assert.ok(start.indexOf('if (!active || !isCurrent())') < start.indexOf('availability.selectBackend('));
  assert.match(start, /availability\.selectBackend\(Build\.VERSION\.SDK_INT, SystemClock\.elapsedRealtime\(\), preferSystem,\s*::probeOnDevice, ::probeSystem\)/);
  assert.match(availability, /if \(useOnDevice\) false else system\(elapsedMillis, systemProbe\)/);
  assert.match(availability, /elapsedMillis >= entry\.checkedAt/);
  assert.match(availability, /elapsedMillis - entry\.checkedAt < lifetimeMillis/);
  assert.doesNotMatch(availability, /import android\.|:\s*Activity\b|SharedPreferences|RECORD_AUDIO|RecognizerIntent|WatchStore|WatchTransport/);
  assert.match(dialog, /private val availability = WatchSpeechAvailabilityCache\(\)/);
  assert.match(dialog, /WatchSpeechFailure\.MODEL \|\| reason == WatchSpeechFailure\.UNAVAILABLE\) availability\.invalidate\(backend\)/);
});

test('watch lifecycle stops speech before snapshots and invalidates permission capture on intentional user departure', () => {
  const saved = activity.slice(activity.indexOf('override fun onSaveInstanceState'), activity.indexOf('private fun restoreEditor'));
  assert.ok(saved.indexOf('cancel(preserveDraft = true)') < saved.indexOf('out.putString("date"'));
  assert.match(activity, /override fun onPause\(\)[\s\S]*?cancel\(preserveDraft = true\)/);
  assert.match(activity, /override fun onUserLeaveHint\(\)[\s\S]*?cancelMicrophoneRequest\(\)/);
  assert.match(activity, /!savedInstanceState\.getBoolean\("speechInApp", false\)/);
  const close = dialog.slice(dialog.indexOf('private fun close('));
  assert.ok(close.indexOf('guard.close()') < close.indexOf('stopRecognizer()'));
  assert.ok(close.indexOf('stopRecognizer()') < close.indexOf('onConfirmed(confirmed)'));
  assert.match(close, /handler\.removeCallbacks\(ticker\)/);
  const stop = dialog.slice(dialog.indexOf('private fun stopRecognizer'), dialog.indexOf('private fun close('));
  assert.ok(stop.indexOf('guard.invalidate()') < stop.indexOf('previous?.cancel()'));
  assert.match(stop, /previous\?\.destroy\(\)/);
});

test('dictation completion retains a single guarded save; interruption is an exact-session editable draft', () => {
  const partial = dialog.slice(dialog.indexOf('override fun onPartialResults'), dialog.indexOf('override fun onEvent'));
  assert.match(partial, /note\.preview\(partial\)/);
  assert.match(partial, /words\.text = note\.text/);
  assert.doesNotMatch(partial, /onConfirmed|close\(|save/);
  assert.match(activity, /if \(pendingSpeech == speech\) \{\s*WatchDictationPolicy\.preservedDraft/);
  assert.match(policy, /currentText != originalText/);
  assert.match(dialog, /val partial = if \(type \|\| preserveDraft\)/);
  assert.match(dialog, /setOnDismissListener \{ close\(\) \}/);
  const accept = activity.slice(activity.indexOf('private fun acceptDictationResult'), activity.indexOf('private fun saveEditor'));
  assert.match(accept, /SpeechSessionGuard\.accepts/);
  assert.match(accept, /DictationSavePolicy\.prepare/);
  assert.match(accept, /store\.saveDictation\(plan\)/);
  assert.match(activity, /checkSelfPermission\(Manifest\.permission\.RECORD_AUDIO\)/);
  assert.match(activity, /val request = nextInputRequest\(\); microphoneRequestCode = request\s*requestPermissions\(arrayOf\(Manifest\.permission\.RECORD_AUDIO\), request\)/);
});

test('phrase completion retains the watch note while Done and quiet completion share microphone teardown', () => {
  const results = dialog.slice(dialog.indexOf('override fun onResults'), dialog.indexOf('override fun onPartialResults'));
  assert.match(results, /note\.acceptPhrase\(text\)/);
  assert.match(results, /handler\.postDelayed\(nextPhrase, 200\)/);
  assert.doesNotMatch(results, /close\(confirmed|onConfirmed/);
  const done = dialog.slice(dialog.indexOf('private val done:'), dialog.indexOf('private val continueButton'));
  assert.match(done, /button\("Done"/);
  assert.match(done, /note\.confirmDisplayed\(\)\?\.let \{ close\(confirmed = it\) \}/);
  const retry = dialog.slice(dialog.indexOf('private fun start('), dialog.indexOf('private fun failed('));
  assert.match(retry, /note\.beginPhrase\(\)/);
  assert.doesNotMatch(retry, /words\.text = ""/);
  assert.match(dialog.slice(dialog.indexOf('private fun close(')), /handler\.removeCallbacks\(nextPhrase\)/);
});

test('silence uses monotonic speech signals and a bounded final flush, never RMS or provider-ready activity', () => {
  assert.match(dialog, /WatchSilencePolicy\(SystemClock\.elapsedRealtime\(\), silenceDelaySeconds\)/);
  assert.match(dialog, /override fun onBeginningOfSpeech\(\)[\s\S]*?silence\.began\(SystemClock\.elapsedRealtime\(\)\)/);
  assert.match(dialog, /silence\.ended\(SystemClock\.elapsedRealtime\(\)\)/);
  assert.match(dialog, /if \(note\.text != previous\) silence\.changedPartial/);
  assert.match(dialog, /override fun onRmsChanged\(rmsdB: Float\) = Unit/);
  assert.match(dialog, /override fun onBufferReceived\(buffer: ByteArray\?\) = Unit/);
  assert.match(dialog, /WatchSilenceAction\.STOP_LISTENING[\s\S]*?recognizer\?\.stopListening\(\)/);
  assert.match(dialog, /WatchSilenceAction\.FINISH[\s\S]*?if \(text == null\) close\(empty = true\) else close\(confirmed = text\)/);
  const hardFailure = dialog.slice(dialog.indexOf('private fun failed('), dialog.indexOf('private fun continueDictating'));
  assert.match(hardFailure, /reason == WatchSpeechFailure\.EMPTY && silence\.isArmed/);
  assert.match(hardFailure, /silence\.hardFailure\(\); handler\.removeCallbacks\(silenceTicker\)/);
});

test('fresh launcher and Tile requests begin capture once, while blank timeout closes without a ledger write', () => {
  assert.match(activity, /freshEntryPending = LaunchPolicy\.freshEntry\(savedInstanceState != null, requestsRecordNow\(intent\)\)/);
  assert.match(activity, /if \(freshEntryPending\) \{\s*freshEntryPending = false\s*applyLaunch\(LaunchTrigger\.LAUNCHER_OR_TILE\)/);
  assert.match(activity, /if \(decision\.startDictation\) \{[\s\S]*prepareAutomaticDictation\(selected\)[\s\S]*beginWatchDictation\(it\)/);
  assert.match(activity, /WatchRoundActionButton\(this, R\.drawable\.context_now_dot, "Go to the current minute"\) \{\s*returnToNow\(\)/);
  const goNow = activity.slice(activity.indexOf('private fun returnToNow()'), activity.indexOf('private fun showRangeEditor('));
  assert.match(goNow, /if \(editing != null \|\| rangeEditor != null \|\| pickers\.isNotEmpty\(\)\) return/);
  assert.match(goNow, /cancelPendingLaunch\(\); selected = now\(\); followingNow = true/);
  assert.doesNotMatch(goNow, /beginWatchDictation|openEditor|prepareAutomaticDictation/);
  const begin = activity.slice(activity.indexOf('private fun beginWatchDictation('), activity.indexOf('@Deprecated("Activity runtime permission'));
  const empty = begin.slice(begin.indexOf('onEmpty = {'), begin.indexOf('onClosed = {'));
  assert.match(empty, /SpeechSessionGuard\.accepts/);
  assert.match(empty, /WatchDictationPolicy\.mayCloseEmptyCapture\(editorInitialText, editor\?\.text\?\.toString\(\),\s*editorSession\?\.chosenCategory != null, retryDictation != null\)/);
  assert.match(empty, /finishEditor\(session, fromDictation = true, saved = false\)/);
  assert.doesNotMatch(empty, /store\.(?:save|saveDictation)/);
  const editorFinish = activity.slice(activity.indexOf('private fun finishEditor('), activity.indexOf('private fun silenceDelaySeconds'));
  assert.doesNotMatch(editorFinish, /store\.(?:save|saveDictation)/);
  assert.match(editorFinish, /if \(saved\) runCatching \{ WatchTransport\.sendPending\(this\) \}/);
  assert.match(editorFinish, /editorDialog = null; editorSession = null/);
  const completion = dialog.slice(dialog.indexOf('private fun close('));
  assert.ok(completion.indexOf('silence.close()') < completion.indexOf('onConfirmed(confirmed)'));
  assert.ok(completion.indexOf('guard.close()') < completion.indexOf('onEmpty()'));
});

test('automatic capture owns one exact cached baseline before microphone entry without inflating a hidden editor', () => {
  const baseline = activity.slice(activity.indexOf('private fun editorBaseline('), activity.indexOf('private fun prepareAutomaticDictation('));
  assert.match(baseline, /val snapshot = if \(restoredSession == null\) store\.editorSnapshot\(target\)\s*else runCatching \{ store\.editorSnapshot\(target\) \}\.getOrElse \{ WatchEditorSnapshot\(null, null, null\) \}/,
    'mutually exclusive branches read once; a restored draft retains its original session when the cache is unavailable');
  assert.doesNotMatch(baseline, /store\.(?:day|cachedEntry|latest|pendingRecords)\(/);
  assert.match(baseline, /val session = restoredSession \?: if \(pendingOperation != null\)/);
  assert.match(baseline, /pendingText = pendingOperation\.getString\("text"\), pendingCategory = category/);
  assert.match(baseline, /else EditorSession\(target, known, if \(known\) version else null\)/);
  const prepare = activity.slice(activity.indexOf('private fun prepareAutomaticDictation('), activity.indexOf('private fun expandPreparedEditor('));
  assert.equal((prepare.match(/editorBaseline\(target\)/g) ?? []).length, 1);
  assert.ok(prepare.indexOf('reviewConflict(it); return') < prepare.indexOf('editorSession = session'));
  assert.match(prepare, /editorSession = session; editing = target; editorInitialText = initial; editorAutoNow = true/);
  assert.match(prepare, /editor = EditText\(this\)\.apply \{ setText\(initial\) \}/);
  assert.match(prepare, /automaticCapturePrepared = true/);
  assert.doesNotMatch(prepare, /openEditor\(|fullDialog\(|dialog\.show\(|render\(|centerMinute\(|WatchTransport/);
});

test('fresh capture reaches speech before ledger repaint and phone refreshes cannot repaint its owned draft', () => {
  const launch = activity.slice(activity.indexOf('private fun applyLaunch('), activity.indexOf('private fun returnToNow()'));
  const capture = launch.slice(launch.indexOf('if (decision.startDictation) {'), launch.indexOf('} else { render(); centerMinute() }'));
  assert.ok(capture.indexOf('prepareAutomaticDictation(selected)') < capture.indexOf('beginWatchDictation(it)'));
  assert.doesNotMatch(capture, /render\(|centerMinute\(|openEditor\(|WatchTransport/);
  assert.ok(launch.indexOf('beginWatchDictation(it)') < launch.indexOf('WatchTransport.requestDay('));
  assert.match(launch, /generation != launchGeneration/);
  const create = activity.slice(activity.indexOf('override fun onCreate('), activity.indexOf('override fun onStart()'));
  assert.match(create, /if \(!freshEntryPending\) \{\s*runCatching \{ render\(\) \}\.onFailure \{[\s\S]*?list\.post \{ centerMinute\(\) \}\s*\}/);
  assert.ok(create.indexOf('runCatching { render() }') < create.indexOf('savedInstanceState?.getString("editorText")'),
    'a failed initial cache repaint must not prevent restoration of the protected editor draft');
  const start = activity.slice(activity.indexOf('override fun onStart()'), activity.indexOf('override fun onStop()'));
  assert.match(start, /if \(!freshEntryPending\) \{\s*WatchTransport\.synchronize/);
  const receiver = activity.slice(activity.indexOf('private val receiver ='), activity.indexOf('override fun onCreate('));
  assert.match(receiver, /if \(editing == null && rangeEditor == null && pickers\.isEmpty\(\) && !deferredNow\) render\(\)/);
});

test('prepared speech drafts expand into the exact manual editor on Type, interruption, denial or a failed durable save', () => {
  const expand = activity.slice(activity.indexOf('private fun expandPreparedEditor('), activity.indexOf('private fun openEditor('));
  assert.match(expand, /!automaticCapturePrepared \|\| editorSession\?\.sessionId != session\.sessionId/);
  assert.match(expand, /RestoredEditor\(session, text, editorInitialText, editorAutoNow, focus\)/);
  assert.match(expand, /openEditor\(session\.coordinate, text, session, draft\.autoNow, draft\.initialText, focus\)/);
  assert.match(expand, /pendingRestore = draft/);
  const begin = activity.slice(activity.indexOf('private fun beginWatchDictation('), activity.indexOf('@Deprecated("Activity runtime permission'));
  const closed = begin.slice(begin.indexOf('onClosed = {'));
  assert.match(closed, /if \(pendingSpeech == speech\)/);
  assert.match(closed, /WatchDictationPolicy\.preservedDraft/);
  assert.match(closed, /if \(automaticCapturePrepared\) expandPreparedEditor\(session, focus = type\)/);
  const permission = activity.slice(activity.indexOf('override fun onRequestPermissionsResult'), activity.indexOf('@Deprecated("Retained only'));
  assert.match(permission, /else \{[\s\S]*expandPreparedEditor\(session\)/);
  assert.match(permission, /editorDialog\?\.isShowing == true \|\| automaticCapturePrepared/);
  const accept = activity.slice(activity.indexOf('private fun acceptDictationResult'), activity.indexOf('private fun saveEditor'));
  assert.match(accept, /catch \(_: Exception\) \{[\s\S]*expandPreparedEditor\(plan\.editor\)/);
  assert.match(accept, /pendingRestore = pendingRestore\?\.copy\(text = plan\.text\)/);
  assert.match(accept, /editor\?\.setText\(plan\.text\)/);
});

test('a granted microphone handoff is consumed once and denied/background sessions cannot reopen it', () => {
  const permission = activity.slice(activity.indexOf('override fun onRequestPermissionsResult'), activity.indexOf('@Deprecated("Retained only'));
  assert.match(permission, /microphoneReadySession = session/);
  assert.match(permission, /if \(request != microphoneRequestCode\) return/);
  assert.match(permission, /LaunchPolicy\.acceptsMicrophoneGrant\(request, microphoneRequestCode, session, editorSession\)/);
  assert.match(permission, /microphoneRequestSession = null; microphoneRequestCode = null/);
  assert.match(permission, /microphoneReadySession = null[\s\S]*LaunchPolicy\.mayResumeMicrophone/);
  assert.doesNotMatch(permission, /requestPermissions\(/);
  const stopped = activity.slice(activity.indexOf('override fun onStop'), activity.indexOf('override fun onResume'));
  assert.match(stopped, /microphoneReadySession = null; freshEntryPending = false/);
  assert.doesNotMatch(stopped, /microphoneRequestSession = null|microphoneRequestCode = null/);
  const saved = activity.slice(activity.indexOf('override fun onSaveInstanceState'), activity.indexOf('private fun restoreEditor'));
  assert.doesNotMatch(saved, /out\.put(?:String|Int|Boolean)\("microphone/);
  assert.match(activity, /private fun cancelMicrophoneRequest\(\) \{\s*microphoneRequestSession = null; microphoneRequestCode = null; microphoneReadySession = null/);
});

test('the compact gear pauses capture before settings and a selected persisted delay explicitly resumes that same note', () => {
  const settings = dialog.slice(dialog.indexOf('private fun settings()'), dialog.indexOf('private fun checkSilence'));
  assert.ok(settings.indexOf('silence.pause()') < settings.indexOf('openSettings {'));
  assert.ok(settings.indexOf('stopRecognizer()') < settings.indexOf('openSettings {'));
  assert.match(settings, /if \(active && isCurrent\(\)\)[\s\S]*continueDictating\(\)/);
  assert.match(activity, /isCurrent = \{[^\n]*pickers\.isEmpty\(\) && pendingSpeech == speech/);
  assert.match(activity, /getSharedPreferences\("context-watch-settings", MODE_PRIVATE\)/);
  assert.match(activity, /\.putInt\("silence-delay-seconds", seconds\)\.commit\(\)/);
  assert.match(dialog, /setImageResource\(R\.drawable\.context_settings\)/);
  assert.match(dialog, /LinearLayout\.LayoutParams\(dp\(44\), dp\(44\)\)/);
  const icon = fs.readFileSync(path.join(__dirname, '../wear-support/watch/src/main/res/drawable/context_settings.xml'), 'utf8');
  assert.match(icon, /android:width="24dp" android:height="24dp"/);
});

test('only the visible armed dictation window stays awake, including quiet time and its final flush', () => {
  const awake = dialog.slice(dialog.indexOf('private fun updateScreenAwake()'), dialog.indexOf('private fun close('));
  assert.match(awake, /val window = dialog\.window \?: return/);
  assert.match(awake, /WatchDictationPolicy\.keepScreenAwake\(active && isCurrent\(\) && dialog\.isShowing, silence\.isArmed\)/);
  assert.match(awake, /window\.addFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/);
  assert.match(awake, /window\.clearFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/);
  assert.doesNotMatch(activity, /FLAG_KEEP_SCREEN_ON|PowerManager|WAKE_LOCK/);
  const show = dialog.slice(dialog.indexOf('fun show()'), dialog.indexOf('fun cancel('));
  assert.match(show, /silence\.resume[\s\S]*updateScreenAwake\(\)[\s\S]*start\(false\)/);
  const resume = dialog.slice(dialog.indexOf('private fun continueDictating()'), dialog.indexOf('private fun settings()'));
  assert.match(resume, /if \(!active \|\| !isCurrent\(\)\) return[\s\S]*silence\.resume[\s\S]*updateScreenAwake\(\)/);
  const settings = dialog.slice(dialog.indexOf('private fun settings()'), dialog.indexOf('private fun checkSilence'));
  assert.ok(settings.indexOf('silence.pause()') < settings.indexOf('updateScreenAwake()'));
  assert.ok(settings.indexOf('updateScreenAwake()') < settings.indexOf('openSettings {'));
  const fail = dialog.slice(dialog.indexOf('private fun failed('), dialog.indexOf('private fun continueDictating'));
  assert.match(fail, /silence\.hardFailure\(\); handler\.removeCallbacks\(silenceTicker\)\s*updateScreenAwake\(\)/);
  const close = dialog.slice(dialog.indexOf('private fun close('));
  assert.match(close, /active = false; silence\.close\(\); guard\.close\(\); updateScreenAwake\(\); stopRecognizer\(\)/);
  const stopped = activity.slice(activity.indexOf('override fun onStop'), activity.indexOf('override fun onResume'));
  assert.match(stopped, /watchDictation\?\.cancel\(preserveDraft = true\)/);
});

test('Custom seconds validates raw input before committing and keeps invalid or canceled edits from changing the setting', () => {
  assert.match(activity, /"✓ Custom · \$\{selectedDelay\}s" else "Custom"/);
  const custom = activity.slice(activity.indexOf('private fun showCustomSilenceDelay('), activity.indexOf('private fun settingsButton'));
  assert.match(custom, /val scrolling = android\.widget\.ScrollView\(this\)/);
  assert.match(custom, /setRawInputType\(InputType\.TYPE_CLASS_NUMBER\)/);
  assert.doesNotMatch(custom, /DigitsKeyListener|LengthFilter/);
  assert.match(custom, /val seconds = WatchSilencePolicy\.parseDelayInput\(input\.text\.toString\(\)\)/);
  assert.match(custom, /if \(seconds == null\) \{ error\.text = "Enter 1–300 whole seconds\."; return@button \}/);
  assert.match(custom, /if \(!persistSilenceDelay\(seconds\)\) \{ error\.text = "Could not save\. Try again\."; return@button \}/);
  assert.ok(custom.indexOf('if (seconds == null)') < custom.indexOf('persistSilenceDelay(seconds)'));
  assert.ok(custom.indexOf('persistSilenceDelay(seconds)') < custom.indexOf('parentSettings.dismiss()'));
  assert.ok(custom.indexOf('parentSettings.dismiss()') < custom.indexOf('onSelected?.invoke(seconds)'));
  assert.match(custom, /button\("Cancel", "Keep the current silence delay"\) \{ closeKeyboard\(\); dialog\.dismiss\(\) \}/);
  assert.match(custom, /content\.addView\(actions\)/);
});

test('historical Tile extras are strict, deferred by exact coordinate and opened manually without sampling Now', () => {
  assert.match(activity, /LaunchPolicy\.tileMinute\(intent\?\.extras\?\.get\(DATE_EXTRA\), intent\?\.extras\?\.get\(MINUTE_EXTRA\)\)/);
  assert.doesNotMatch(activity, /getIntExtra\(MINUTE_EXTRA/);
  const intent = activity.slice(activity.indexOf('override fun onNewIntent'), activity.indexOf('override fun onSaveInstanceState'));
  assert.ok(intent.indexOf('if (requestsOpenMinute(intent))') < intent.indexOf('if (requestsRecordNow(intent))'));
  assert.match(intent, /val target = tileMinuteFrom\(intent\)\s*cancelPendingLaunch\(\)/);
  assert.match(intent, /if \(requestsRecordNow\(intent\)\) \{\s*cancelPendingLaunch\(\)/);
  const historical = activity.slice(activity.indexOf('private fun applyTileMinuteRequest()'), activity.indexOf('private fun applyLaunch('));
  assert.match(historical, /generation != launchGeneration/);
  assert.match(historical, /tileMinutePending != target/);
  assert.match(historical, /if \(editing == target\) \{[\s\S]*?tileMinuteRequestPending = false; tileMinutePending = null\s*return/);
  assert.match(historical, /LaunchPolicy\.mayOpenTileMinute\(currentLaunchState\(\)\)/);
  const accepted = historical.slice(historical.indexOf('// Consume once'));
  assert.ok(accepted.indexOf('tileMinuteRequestPending = false; tileMinutePending = null') < accepted.indexOf('openEditor(target)'));
  assert.doesNotMatch(accepted, /now\(\)|beginWatchDictation|autoNow = true/);
  assert.match(activity, /out\.putBoolean\("tileMinuteRequestPending", tileMinuteRequestPending\)/);
  assert.match(activity, /out\.putString\("tileMinuteDate", it\.dateKey\); out\.putInt\("tileMinuteIndex", it\.minuteIndex\)/);
  assert.match(activity, /tileMinuteRequestPending && trigger != LaunchTrigger\.LAUNCHER_OR_TILE/);
});
