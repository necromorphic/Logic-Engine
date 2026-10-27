import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDateToCoordinate, projectCalendarDate } from '../src/time/model.js';

const calendar = {
  calendar_id: 'property.cycle',
  version: '2.0.0',
  day_length_ms: 86_400_000,
  weekdays: ['day-0', 'day-1', 'day-2', 'day-3', 'day-4', 'day-5', 'day-6'],
  year_cycle: [
    { id: 'common', name: 'Common year', months: [
      { id: 'm1', name: 'Month 1', days: 31 },
      { id: 'm2', name: 'Month 2', days: 28 },
      { id: 'm3', name: 'Month 3', days: 31 },
    ] },
    { id: 'leap', name: 'Leap year', months: [
      { id: 'm1', name: 'Month 1', days: 31 },
      { id: 'm2', name: 'Month 2', days: 29 },
      { id: 'm3', name: 'Month 3', days: 31 },
    ] },
    { id: 'short', name: 'Short year', months: [
      { id: 'm1', name: 'Month 1', days: 30 },
      { id: 'm2', name: 'Month 2', days: 27 },
      { id: 'm3', name: 'Month 3', days: 30 },
    ] },
  ],
  epoch: {
    coordinate: 123_456_789,
    year_number: 40,
    year_cycle_index: 1,
    month_id: 'm2',
    day_of_month: 17,
    weekday_index: 4,
    time_of_day_ms: 12_345_678,
  },
  holidays: [
    { id: 'annual', name: 'Annual', month_id: 'm2', day_of_month: 2 },
    { id: 'one-off', name: 'One-off', year_number: 41, month_id: 'm1', day_of_month: 3 },
  ],
};

function deterministicCoordinates() {
  const coordinates = new Set([
    calendar.epoch.coordinate,
    calendar.epoch.coordinate - 1,
    calendar.epoch.coordinate + 1,
    -1_000_000_000,
    -1,
    0,
    1,
    1_000_000_000,
  ]);

  // Deterministic pseudo-random coverage without external dependencies or flaky tests.
  let state = 0x5eed1234;
  for (let index = 0; index < 2_000; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    coordinates.add((state - 0x80000000) * 1_000);
  }

  // Cover each day boundary around many repeated year-cycle boundaries.
  const yearCycleDays = 31 + 28 + 31 + 31 + 29 + 31 + 30 + 27 + 30;
  const cycleMs = yearCycleDays * calendar.day_length_ms;
  for (let cycle = -12; cycle <= 12; cycle += 1) {
    const boundary = calendar.epoch.coordinate + cycle * cycleMs;
    for (const offset of [-1, 0, 1]) coordinates.add(boundary + offset);
  }

  return [...coordinates].filter(Number.isSafeInteger);
}

test('calendar projection/inverse conversion round-trips deterministic broad coordinate coverage', () => {
  for (const coordinate of deterministicCoordinates()) {
    const date = projectCalendarDate(calendar, coordinate);
    assert.equal(
      calendarDateToCoordinate(calendar, date),
      coordinate,
      'round-trip failed at coordinate ' + coordinate,
    );
  }
});

test('calendar date conversion preserves every time-of-day edge', () => {
  const dayLength = calendar.day_length_ms;
  const coordinates = [
    calendar.epoch.coordinate - calendar.epoch.time_of_day_ms,
    calendar.epoch.coordinate - calendar.epoch.time_of_day_ms + 1,
    calendar.epoch.coordinate - calendar.epoch.time_of_day_ms + dayLength - 1,
    calendar.epoch.coordinate - calendar.epoch.time_of_day_ms + dayLength,
  ];
  for (const coordinate of coordinates) {
    const projected = projectCalendarDate(calendar, coordinate);
    assert.equal(calendarDateToCoordinate(calendar, projected), coordinate);
  }
});
