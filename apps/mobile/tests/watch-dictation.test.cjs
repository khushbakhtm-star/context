const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const directory = path.join(__dirname, '../wear-support/watch/src/main/java/com/context/minuteledger/wear');
const read = (name) => fs.readFileSync(path.join(directory, name), 'utf8');
const activity = read('MinuteActivity.kt');
const dialog = read('WatchDictationDialog.kt');
const policy = read('WatchDictationPolicy.kt');

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
  assert.match(failure, /isCurrent\(\) && WatchDictationPolicy\.retryWithSystem\(backend, reason, system, systemAttempted\)/);
  assert.match(failure, /start\(true\)\s*return/);
  assert.match(dialog, /EXTRA_PREFER_OFFLINE, true/);
  assert.match(dialog, /setRecognitionListener[\s\S]*speech\.startListening/);
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
  assert.match(activity, /openEditor\(selected, autoNow = true\)\s*if \(decision\.startDictation\)/);
  assert.match(activity, /button\("Now", "Return to the current minute"\) \{\s*applyLaunch\(LaunchTrigger\.ON_START\)/);
  const empty = activity.slice(activity.indexOf('onEmpty = {'), activity.indexOf('onClosed = {'));
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
