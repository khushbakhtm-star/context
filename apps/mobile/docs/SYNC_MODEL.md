# Context synchronization model

## Authority and permissions

Calendars provide future plans. Explicit minute records provide actual history. A direct-account
projection links one provider event occurrence to one contiguous activity. A selected original plan
can become the actual activity without creating a duplicate event. By default that changes one
occurrence. A separately permitted, explicitly confirmed series edit changes the master through a
dedicated API that keeps its recurrence/date anchor and uses an idempotent source-operation marker.

Per-account permissions control storage, calendar reading, calendar writing, original-plan
replacement, edit import, invitations, recurring series, and category reading. Native/device writeback is a separate fallback and is disabled while
direct account writes are enabled. HTTP calls recheck current permissions; an already in-flight
provider call may finish after opt-out. Provider calls never interpret event descriptions as code.

## Private ledger

SQLite triggers capture every minute insert/update/delete atomically in ledger_documents.
Revisions are hybrid logical clock tuples (padded wall time, counter, device ID). Imported records
observe the clock without emitting fresh echo revisions. Deletions are durable tombstones. Exact
equal-revision/different-value corruption is rejected.

Each account keeps its own upload acknowledgment per record revision. Updates arriving during an
upload remain pending. Batches have immutable names, and pending encrypted bytes are persisted
before sending. Google Drive uses preallocated IDs; OneDrive/WebDAV use conditional creation.
Downloaded batches are authenticated and validated before any SQLite import. A wrong passphrase
fails before upload, including when a file was downloaded in a previous session.

AES-256-GCM protects ledger files with independent random salt/nonce and authenticated parameters.
PBKDF2-SHA256 derives a 32-byte key with 600,000 iterations. OAuth credentials and the ledger
passphrase stay in secure device storage. The provider stores ciphertext; calendar notes remain
ordinary readable event content. Phones must use the same app registration/storage account and
passphrase. Multiple authorized storage accounts exchange the same ledger and therefore act as
explicitly selected replicas.

LWW tuple order gives deterministic convergence. Differing losing minute values remain locally
recoverable as saved alternatives, including versions already uploaded before a competing phone was
observed. These alternatives are recovery history, not proof of causal concurrency. Provider event
conflicts use a separate explicit resolution state.

## Calendar reconciliation

Google Calendar reads use expanded occurrences. Microsoft Graph uses calendarView and immutable
IDs. Bindings retain provider account/calendar/event IDs, original recurrence metadata, the last
provider snapshot/version, and the last local projection hash. Source-backed IDs derive from stable
provider occurrence identity; generated events have deterministic projection identity for retries.

Before writing, the engine compares current local content and the provider snapshot with their last
common baseline. Calendar-only changes import. Context-only changes publish. Changes on both sides
pause that activity for review. If-Match/etag checks reject a provider edit that races the final write.
The user can keep Context or import the current calendar version. Calendar import transactions
check local records again and roll back if another edit or unrelated occupied minute would be lost.

Timestamped notes preserve minute text. Moving an otherwise unchanged event shifts its minute
content by the same elapsed delta. Title edits are retained separately. Original notes outside the
bounded Context section are preserved as plain text, including meeting URL targets. This version
does not preserve arbitrary HTML formatting.

Contiguous same-category minutes share a block. Midnight does not split the direct-account event.
An interruption creates child projections for surviving ranges; merging the ranges retires duplicate
children. Children inherit their linked parent's calendar. Provider series masters/all-day plans are
rejected for minute replacement.

## Timing and delivery

Projection zones are captured, and endpoints resolve through IANA-zone rules independently of the
phone's current zone. The 1,440-row grid cannot represent both folds of a repeated hour; ambiguous
endpoints/imports require review. A future schema migration must use UTC instants plus zone/fold for
complete DST history and elapsed-time totals.

Category definitions are synchronized documents too, so names, colors, provider label mappings and
archived state travel with the ledger. Reports aggregate actual minute slots in SQLite by date and
category; year summaries do not load a year of private minute text into the UI.

The engine runs serially after local edits, on foreground, and periodically while the app is active.
It stores pending operations locally and retries failures. Closed-app near-real-time delivery would
require a background/service deployment with renewable Google watches and Microsoft subscriptions.
Immutable storage journals need a later coordinated compaction policy for very large histories.
