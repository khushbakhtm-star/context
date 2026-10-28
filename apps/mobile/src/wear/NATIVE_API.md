# Phone native bridge contract

The optional Expo module is named `ContextWear`. It is Android-only; missing modules on
iOS and F-Droid are supported. Its local package lives in `modules/context-wear`.

All methods below return promises. The Expo `onInboxChanged` event contains
`{pendingCount:number}` and is only a hint: JavaScript enumerates durable records on start/resume.

- `setEnabledAsync(enabled:boolean): Promise<void>` durably stores default-off consent.
  Enabling enumerates outstanding watch DataItems. Disabling stops download/publication,
  retains already received unsaved inbox records, and removes outgoing `/context/v1/phone/`
  DataItems so queued private snapshots are withdrawn. Never delete the watch's operation journal.
- `scanPendingAsync(): Promise<void>` enumerates current `/context/v1/watch/` DataItems and
  receives their Assets through the same bounded durable inbox as listener events.
- `drainInboxAsync(): Promise<Array<{id:string,path:string,payload:string,receivedAt:number}>>`
  returns at most 128 records (the existing 8 MiB inbox bound), without removing them.
  Returning the whole bounded inbox keeps older replies awaiting radio delivery from hiding a new edit.
  `id` is an opaque local record key;
  `path` is the source DataItem path and `payload` is UTF-8 Asset JSON.
- `acknowledgeInboxAsync(id:string): Promise<void>` removes that local record and its source
  DataItem only after JavaScript has durably processed it and successfully published the reply.
  Applied/conflict/error replies do not delete the watch's separate pending-operation journal.
- `publishDayAsync(json:string): Promise<void>` parses its `dateKey` and publishes the JSON Asset
  at `/context/v1/phone/day/<dateKey>`. Maximum 8 MiB, with no truncation.
- `publishAckAsync(json:string): Promise<void>` parses `operationId` and publishes an Asset at
  `/context/v1/phone/ack/<uuid>`. Maximum 256 KiB.
- `getStatusAsync(): Promise<{enabled:boolean,connectedNodeCount:number,pendingCount:number,error?:string}>`
  returns generic status only; never raw note contents, account identifiers, or sensitive logs.

Every DataMap uses `protocolVersion=1` and an Asset named `payload`; a monotonically changing
`sentAt` value may force retry delivery. Watch requests are at most 2 KiB, edits at most 256 KiB.
Validate exact path prefixes and UUIDs before download. UTF-8 decoding must reject malformed bytes.
The manifest listener handles only `/context/v1/watch/` DATA_CHANGED events.

The private inbox uses atomic durable files, at most 128 records / 8 MiB. Queue pressure must leave
the persistent source DataItem and watch journal intact for later enumeration. Duplicate path and
payload records may be deduplicated; a different payload must never silently replace an existing
immutable operation. Google Play Services transport relies on the matching application ID and
signing certificate; no OAuth or signing keys are exchanged by the bridge.
