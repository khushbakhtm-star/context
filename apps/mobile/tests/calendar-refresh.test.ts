import assert from 'node:assert/strict';
import test from 'node:test';
import { createCalendarRefreshBurst } from '../src/utils/calendar-refresh';

test('return refresh retries discover calendar events published after the editor closes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const provider: string[] = [];
  const displayed: string[][] = [];
  const burst = createCalendarRefreshBurst(() => displayed.push([...provider]), () => true);

  burst.start();
  assert.deepEqual(displayed, [[]]);
  provider.push('Make coffee');
  t.mock.timers.tick(1000);
  assert.deepEqual(displayed.at(-1), ['Make coffee']);
  provider.push('Doctor appointment');
  t.mock.timers.tick(3000);
  assert.deepEqual(displayed.at(-1), ['Make coffee', 'Doctor appointment']);
  t.mock.timers.tick(60_000);
  assert.equal(displayed.length, 3, 'the return burst is bounded');
});

test('restarting and canceling a burst retire its previous scheduled refreshes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let refreshes = 0;
  const burst = createCalendarRefreshBurst(() => { refreshes += 1; }, () => true);
  burst.start();
  t.mock.timers.tick(500);
  burst.start();
  assert.equal(refreshes, 2);
  t.mock.timers.tick(500);
  assert.equal(refreshes, 2, 'the old one-second retry was canceled');
  t.mock.timers.tick(500);
  assert.equal(refreshes, 3, 'the replacement burst still refreshes');
  burst.cancel();
  t.mock.timers.tick(60_000);
  assert.equal(refreshes, 3);
});

test('calendar retries do not read while the app is inactive', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let active = false;
  let refreshes = 0;
  const burst = createCalendarRefreshBurst(() => { refreshes += 1; }, () => active);
  burst.start();
  t.mock.timers.tick(5000);
  assert.equal(refreshes, 0);
  active = true;
  burst.start();
  assert.equal(refreshes, 1);
  active = false;
  t.mock.timers.tick(5000);
  assert.equal(refreshes, 1);
});

test('a synchronous cancellation during refresh cannot leave delayed retries behind', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let refreshes = 0;
  const burst = createCalendarRefreshBurst(() => {
    refreshes += 1;
    burst.cancel();
  }, () => true);
  burst.start();
  t.mock.timers.tick(60_000);
  assert.equal(refreshes, 1);
});
