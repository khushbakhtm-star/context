# Context Wear protocol v1

Both packages use `com.context.minuteledger` and the same signing certificate. Every DataItem
has a `payload` Asset containing UTF-8 JSON and a `protocolVersion` integer of `1`.
Assets keep a long note or a complete 1,440-minute day outside the 100 KB DataItem limit.
Edit JSON is at most 256 KB and text at most 50,000 Unicode code points; requests are at most
2 KB and day Assets at most 8 MB. Identifiers are UUID strings.

* Watch request: `/context/v1/watch/request/<uuid>` — `{version:1, requestId, dateKey,
  pendingOperationIds?:string[]}`. Up to 32 pending/conflicted operation UUIDs for this day
  request replay of their persisted receipts, including receipts previously delivered to
  the Data Layer but missed while the watch was offline or phone access was disabled.
* Watch edit: `/context/v1/watch/edit/<uuid>` — `{version:1, operationId, dateKey,
  minuteIndex, text, categoryId?, baseKnown, expectedVersion}`.
* Phone day: `/context/v1/phone/day/<dateKey>` — `{version:1, dateKey, snapshotId,
  requestId?, generatedAt, entries:[{minuteIndex,text,categoryId,version}],
  categories:[{id,name,color,selectable?}],clockFormat:"12h"|"24h"}`. Missing minutes are
  entirely empty. Include blank cells carrying minute tombstones or formatting revisions.
  `version` and `expectedVersion` are opaque JSON strings produced by
  `JSON.stringify([minuteRevision,formatRevision])`; both revisions are strings or null.
  An entirely absent minute has version `"[null,null]"`. `generatedAt` is milliseconds since epoch.
* Phone acknowledgment: `/context/v1/phone/ack/<operationId>` — `{version:1,
  operationId, dateKey, minuteIndex, status:"applied"|"conflict"|"error",
  message?, entry:{minuteIndex,text,categoryId,version}}`. Include the current entry even
  when empty, preserving its tombstone/format version. `selectable:false` category values
  may be preserved on an existing cell but must not appear as new choices on the watch.

The watch writes its local operation journal before upload. It deletes an operation only
after an applied acknowledgment, and never replaces a newer pending edit with an older
acknowledgment or snapshot. Conflicts retain the user's note for review on the phone. Retrying
transport uses the same immutable UUID. The phone resolves a conflict atomically and publishes
an applied acknowledgment for that original UUID, keeping its review list and watch in agreement.
The phone deduplicates UUIDs durably and acknowledges only after the ledger transaction.
`baseKnown:false` permits creation only at an empty minute; it cannot overwrite an unknown
phone entry. Requests and operations must also be enumerated when a listener starts, since
events are hints and can arrive before either process is running.

The phone inbox receives data while React Native is stopped; the ledger applies it when
Context next runs. The watch displays “Saved on watch · waiting for phone” until an applied
acknowledgment. A downloaded day is a cache, with pending watch operations drawn on top.
