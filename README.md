# Context

Context is a cross-platform, local-first calendar companion that records life one minute at a time.
The current repository contains the Android/iPhone MVP in [`apps/mobile`](./apps/mobile).

## Product contract

- Existing calendars remain the planning and interoperability layer.
- Context stores the complete minute-level record of what actually happened.
- Explicit Context entries override the visible plan for those minutes.
- Direct Google/Microsoft connections can replace a selected recurring occurrence and import edits
  made to linked calendar actuals when the user grants those permissions.
- Encrypted account storage synchronizes minute history between Android and iPhone, including
  offline revisions, deletion tombstones, and recoverable alternatives.
- Calendar writes are conditional and default to one occurrence; changing a whole series requires
  separate permission and an explicit confirmation.

See [`apps/mobile/README.md`](./apps/mobile/README.md) for features, build instructions, device
calendar coverage, and current production limitations.
