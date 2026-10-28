/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { canCreateAccountProjection, type AccountProjectionAuthority } from '../src/utils/calendar-projection-authority';
import type { ConnectedAccount, RemoteCalendarEvent } from '../src/sync/types';

const account: ConnectedAccount = { id: 'google:source', provider: 'google', subject: 'source', label: 'Test account',
  consent: { ledgerStorage: true, calendarRead: true, calendarWrite: true, replaceOccurrences: true,
    importCalendarEdits: true } };
const event: RemoteCalendarEvent = { id: 'exact-source-id', calendarId: 'source-calendar', title: 'Renamed source activity',
  description: '', start: '2026-10-27T15:00:00Z', end: '2026-10-27T16:00:00Z', timeZone: 'UTC',
  allDay: false, isSeriesMaster: false, deleted: false, version: 'current-version', canEdit: true };
const explicit = (): AccountProjectionAuthority => ({ hasNativeBinding: true, hasAccountProjection: false,
  sourceAccountId: account.id, sourceAccount: account, sourceEvent: event, sourceScope: 'occurrence' });

test('account-first routing cannot adopt a native-bound activity from stale text/time, while unrelated new activity can proceed', () => {
  const pending = [
    { hasNativeBinding: true, hasAccountProjection: false },
    { hasNativeBinding: false, hasAccountProjection: false },
  ];
  assert.deepEqual(pending.map(canCreateAccountProjection), [false, true]);
  assert.equal(canCreateAccountProjection({ ...pending[0]!, sourceAccount: account }), false,
    'A configured account is not an explicit occurrence selection');
  assert.equal(canCreateAccountProjection({ ...pending[0]!, sourceEvent: event }), false,
    'Even an identically titled/moved event is not authority without its exact account selection');
});

test('exact existing account ownership stays authoritative and explicit source selection needs all occurrence permissions', () => {
  assert.equal(canCreateAccountProjection({ hasNativeBinding: true, hasAccountProjection: true }), true);
  assert.equal(canCreateAccountProjection(explicit()), true);
  assert.equal(canCreateAccountProjection({ ...explicit(), sourceAccountId: 'google:other' }), false);
  for (const permission of ['calendarRead', 'calendarWrite', 'replaceOccurrences'] as const) {
    assert.equal(canCreateAccountProjection({ ...explicit(), sourceAccount: { ...account,
      consent: { ...account.consent, [permission]: false } } }), false, permission);
  }
  assert.equal(canCreateAccountProjection({ ...explicit(), sourceAccount: { ...account, provider: 'webdav' } }), false);
});

test('native migration never adopts deleted/read-only/all-day/master/managed events or silently expands meeting/series permissions', () => {
  for (const patch of [{ deleted: true }, { canEdit: false }, { allDay: true }, { isSeriesMaster: true },
    { projectionId: 'another-context-projection' }, { id: '' }, { calendarId: '' }]) {
    assert.equal(canCreateAccountProjection({ ...explicit(), sourceEvent: { ...event, ...patch } }), false);
  }
  assert.equal(canCreateAccountProjection({ ...explicit(), sourceEvent: { ...event, isInvitation: true } }), false);
  assert.equal(canCreateAccountProjection({ ...explicit(), sourceScope: 'series' }), false);
  assert.equal(canCreateAccountProjection({ ...explicit(), sourceScope: 'series', sourceEvent: { ...event, isInvitation: true },
    sourceAccount: { ...account, consent: { ...account.consent, editInvitations: true, editSeries: true } } }), true);
});
