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
  assert.match(dialog, /root\.addView\(clock, LinearLayout\.LayoutParams\(-1, dp\(18\)\)\)/);
  assert.match(dialog, /clock\.text = "Now \$\{WatchDictationPolicy\.clock\(LocalDateTime\.now\(\), twelveHourClock\)\}"/);
  assert.match(dialog, /handler\.postDelayed\(this, 1000\)/);
  assert.match(dialog, /minuteLabel\(target, twelveHourClock\)/);
  assert.match(activity, /WatchDictationDialog\(this, session\.coordinate, twelveHourClock,/);
  assert.match(policy, /"h:mm:ss a" else "HH:mm:ss"/);
  assert.doesNotMatch(dialog, /startActivityForResult|WatchStore|WatchTransport|MediaRecorder|AudioRecord|FileOutputStream/);
});

test('watch speech selects a genuine on-device recognizer and requires an explicit action before using system speech', () => {
  assert.match(dialog, /Build\.VERSION\.SDK_INT >= 31 && runCatching\s*\{\s*SpeechRecognizer\.isOnDeviceRecognitionAvailable/);
  assert.match(dialog, /SpeechRecognizer\.createOnDeviceSpeechRecognizer\(activity\)/);
  assert.match(dialog, /button\("Use system speech",[\s\S]*?\{ start\(true\) \}/);
  const automaticShow = dialog.slice(dialog.indexOf('fun show()'), dialog.indexOf('fun cancel('));
  assert.match(automaticShow, /WatchSpeechBackend\.ON_DEVICE\) start\(false\)/);
  assert.doesNotMatch(automaticShow, /start\(true\)|createSpeechRecognizer/);
  assert.match(dialog, /EXTRA_PREFER_OFFLINE, true/);
  assert.match(dialog, /setRecognitionListener[\s\S]*speech\.startListening/);
});

test('watch lifecycle stops speech before state snapshots and clears pending permission handoffs on background', () => {
  const saved = activity.slice(activity.indexOf('override fun onSaveInstanceState'), activity.indexOf('private fun restoreEditor'));
  assert.ok(saved.indexOf('cancel(preserveDraft = true)') < saved.indexOf('out.putString("date"'));
  assert.match(activity, /override fun onPause\(\)[\s\S]*?cancel\(preserveDraft = true\)/);
  assert.match(activity, /override fun onStop\(\)[\s\S]*?microphoneRequestSession = null/);
  assert.match(activity, /!savedInstanceState\.getBoolean\("speechInApp", false\)/);
  const close = dialog.slice(dialog.indexOf('private fun close('));
  assert.ok(close.indexOf('guard.close()') < close.indexOf('stopRecognizer()'));
  assert.ok(close.indexOf('stopRecognizer()') < close.indexOf('onConfirmed(confirmed)'));
  assert.match(close, /handler\.removeCallbacks\(ticker\)/);
  const stop = dialog.slice(dialog.indexOf('private fun stopRecognizer'), dialog.indexOf('private fun close('));
  assert.ok(stop.indexOf('guard.invalidate()') < stop.indexOf('previous?.cancel()'));
  assert.match(stop, /previous\?\.destroy\(\)/);
});

test('only user-confirmed dictation reaches durable save; an interrupted return is an exact-session editable draft', () => {
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
  assert.match(activity, /requestPermissions\(arrayOf\(Manifest\.permission\.RECORD_AUDIO\), MICROPHONE\)/);
});

test('speech phrase completion retains the watch note and only Done confirms it before microphone teardown', () => {
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
