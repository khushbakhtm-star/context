import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarHourLabel, calendarTimeRailLabel, calendarTimeRailLabelTop, calendarTimeRailLayout } from '../src/utils/calendar-time-labels';

test('dense time rails show complete hour labels while retaining the same font size', () => {
  for (const fontScale of [0.85, 1, 1.4]) {
    const normal = calendarTimeRailLayout(85, fontScale);
    for (const rowHeight of [0.35, 4, 9, 17, 34, 85]) {
      const rail = calendarTimeRailLayout(rowHeight, fontScale);
      assert.equal(rail.fontSize, normal.fontSize); assert.equal(rail.lineHeight, normal.lineHeight);
      for (const format of ['12h', '24h'] as const) for (let minute = 0; minute < 1440; minute++) {
        const label = calendarTimeRailLabel(minute, rowHeight, format, fontScale);
        assert.ok(!label.includes('…') && !label.includes('...'));
        if (rail.hourOnly) {
          if (label) { assert.equal(minute % 60, 0); assert.ok(!label.includes(':')); }
          else assert.ok(minute % (60 * rail.hourStep) !== 0);
        } else assert.ok(label.includes(':'));
      }
    }
  }
});

test('hour labels preserve midnight noon and the explicit end-of-day boundary in each clock format', () => {
  assert.equal(calendarHourLabel(0, '24h'), '0'); assert.equal(calendarHourLabel(1380, '24h'), '23');
  assert.equal(calendarHourLabel(1440, '24h'), '24');
  assert.equal(calendarHourLabel(0, '12h'), '12AM'); assert.equal(calendarHourLabel(660, '12h'), '11AM');
  assert.equal(calendarHourLabel(720, '12h'), '12PM'); assert.equal(calendarHourLabel(1380, '12h'), '11PM');
  assert.equal(calendarHourLabel(1440, '12h'), '12AM');
  assert.equal(calendarTimeRailLabel(791, 34, '24h'), '13:11');
  assert.equal(calendarTimeRailLabel(791, 34, '12h'), '1:11 PM');
});

test('hour-only labels maintain readable vertical spacing even when an entire day fits on screen', () => {
  for (const rowHeight of [0.1, 0.35, 0.7, 2, 10, 22]) {
    const rail = calendarTimeRailLayout(rowHeight, 1.4);
    assert.ok(rail.hourStep * 60 * rowHeight >= rail.lineHeight + 2);
    assert.equal(calendarTimeRailLabel(1, rowHeight, '24h', 1.4), '');
    assert.equal(calendarTimeRailLabel(1440, rowHeight, '24h', 1.4), '24');
  }
  for (const minute of [-1, 1441, NaN, 1.5]) assert.equal(calendarTimeRailLabel(minute, 34, '24h'), '');
});

test('preview and committed hour labels share first interior and terminal positioning without a zoom handoff jump', () => {
  for (const rowHeight of [0.35, 8.99, 9, 17, 23, 34, 85]) {
    const rail = calendarTimeRailLayout(rowHeight);
    assert.equal(calendarTimeRailLabelTop(0, rowHeight), rail.hourOnly ? 0 : (rowHeight - rail.lineHeight) / 2);
    assert.equal(calendarTimeRailLabelTop(600, rowHeight), 600 * rowHeight +
      (rail.hourOnly ? -rail.lineHeight / 2 : (rowHeight - rail.lineHeight) / 2));
    assert.equal(calendarTimeRailLabelTop(1440, rowHeight), 1440 * rowHeight - rail.lineHeight);
    for (const base of [0.35, 17, 34, 85]) for (const minute of [0, 600, 1440]) {
      const scale = rowHeight / base;
      const previewTop = calendarTimeRailLabelTop(minute, rowHeight) / scale;
      assert.ok(Math.abs(previewTop * scale - calendarTimeRailLabelTop(minute, rowHeight)) < 1e-8);
    }
  }
});
