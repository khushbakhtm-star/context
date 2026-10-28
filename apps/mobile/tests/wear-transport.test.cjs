const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('fresh phone DataEvents use the independently tested live lane rather than the scan mutex', () => {
  const source = read('modules/context-wear/android/src/main/java/expo/modules/contextwear/WearBridge.kt');
  const enqueue = source.slice(source.indexOf('fun enqueue('), source.indexOf('fun scanPending('));
  assert.match(enqueue, /workers\.receive\s*\{/);
  assert.doesNotMatch(enqueue, /transport\.withLock|workers\.maintain/);
  assert.match(enqueue, /admitted\.size >= WearInbox\.MAX_RECORDS/);
  assert.match(source, /fun scanPending\(context: Context\) = scan\.withLock/);
  const lanes = read('modules/context-wear/android/src/main/java/expo/modules/contextwear/WearPublication.kt');
  assert.equal((lanes.match(/newSingleThreadExecutor/g) || []).length, 2);
  assert.match(lanes, /fun maintain\(work: \(\) -> Unit\) \{ maintenance\.execute\(work\)/);
  assert.match(lanes, /fun receive\(work: \(\) -> Unit\) \{ live\.execute\(work\)/);
});

test('phone publication checks its exact consent epoch and withdraws late data without a successful reply', () => {
  const source = read('modules/context-wear/android/src/main/java/expo/modules/contextwear/WearBridge.kt');
  const publish = source.slice(source.indexOf('private fun publish('), source.indexOf('fun status('));
  assert.doesNotMatch(publish, /transport\.withLock|scan\.withLock/);
  assert.match(publish, /publishWithWearConsent/);
  assert.match(publish, /publications\.withPath\(path\)/);
  assert.match(publish, /consentEpoch == epoch && WearInbox\.enabled\(context\)/);
  assert.match(publish, /deleteDataItems\(published\.uri, DataClient\.FILTER_LITERAL\)/);
  assert.match(source, /synchronized\(consentLock\)\s*\{\s*consentEpoch\+\+\s*WearInbox\.setEnabled/);
  const withdrawal = source.slice(source.indexOf('private fun scheduleWithdrawal('), source.indexOf('private fun incoming('));
  assert.match(withdrawal, /publications\.withdrawAll\s*\{/);
  assert.doesNotMatch(withdrawal, /transport\.withLock/);
  const inbox = read('modules/context-wear/android/src/main/java/expo/modules/contextwear/WearInbox.kt');
  assert.match(inbox, /fun put\([^]*?if \(!enabled\(context\)\) throw WearBridgeFailure\("ERR_WEAR_DISABLED"\)/);
  assert.match(inbox, /fun drain\([^]*?\.take\(MAX_RECORDS\)/);
  assert.match(inbox, /const val MAX_RECORDS = 128/);
});

test('watch durable edits use a coalesced sender independent of full-day reads and keep urgent Data Layer delivery', () => {
  const source = read('wear-support/watch/src/main/java/com/context/minuteledger/wear/WatchTransport.kt');
  assert.match(source, /CoalescedPendingWork\(\{ work -> outgoing\.execute\(work\) \}\)/);
  assert.match(source, /fun synchronize\(context: Context, dateKey: String\) \{\s*sendPending\(context\)\s*worker\.execute/);
  const send = source.slice(source.indexOf('fun sendPending('), source.indexOf('fun enqueueReceive('));
  assert.match(send, /pendingSender\.request\(\)/); assert.doesNotMatch(send, /worker\.execute|getDataItems|getFdForAsset/);
  assert.match(source, /path\.startsWith\(ROOT \+ "phone\/ack\/"\)\) acknowledgements else worker/);
  assert.match(source, /incoming\.size >= 128/);
  assert.match(source, /putDataItem\(data\.asPutDataRequest\(\)\.setUrgent\(\)\)/);
  assert.doesNotMatch(source, /https?:\/\/|ConnectivityManager|isWifiEnabled|account|OAuth/);
});
