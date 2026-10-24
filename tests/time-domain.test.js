import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTimeUnits,
  assertTimeCoordinate,
  compareTimeCoordinates,
  createTimeInterval,
  differenceTimeCoordinates,
  intervalContains,
  secondsToTimeUnits,
  TIME_UNITS_PER_DAY,
} from '../src/time/coordinate.js';
import { projectFixedCalendar } from '../src/time/calendar.js';

const calendar = {
  version: 'test-calendar@1',
  unitsPerDay: TIME_UNITS_PER_DAY,
  epoch: { coordinate: 0, year: 1, month: 1, day: 1, weekdayIndex: 0 },
  months: [
    { name: 'Ash', days: 30 },
    { name: 'Rain', days: 30 },
    { name: 'Ember', days: 30 },
  ],
  weekdays: ['First', 'Second', 'Third', 'Fourth', 'Fifth'],
  holidays: [
    { id: 'year-day', name: 'Year Day', kind: 'recurring', month: 1, day: 1 },
    { id: 'founding', name: 'Founding', kind: 'one_off', year: 2, month: 2, day: 3 },
  ],
};

test('coordinates are safe integers and may be negative', () => {
  assert.equal(assertTimeCoordinate(-1), -1);
  assert.equal(assertTimeCoordinate(0), 0);
  assert.throws(() => assertTimeCoordinate(1.5), TypeError);
  assert.throws(() => assertTimeCoordinate(Number.MAX_SAFE_INTEGER + 1), TypeError);
});

test('coordinate arithmetic is deterministic and guards overflow', () => {
  assert.equal(addTimeUnits(-5, 8), 3);
  assert.equal(differenceTimeCoordinates(3, -5), 8);
  assert.equal(compareTimeCoordinates(-5, 3), -1);
  assert.equal(compareTimeCoordinates(3, 3), 0);
  assert.equal(compareTimeCoordinates(4, 3), 1);
  assert.throws(() => addTimeUnits(Number.MAX_SAFE_INTEGER, 1), RangeError);
  assert.throws(() => differenceTimeCoordinates(Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER), RangeError);
});

test('seconds convert to millisecond-sized units without unsafe rounding', () => {
  assert.equal(secondsToTimeUnits(0), 0);
  assert.equal(secondsToTimeUnits(90), 90_000);
  assert.throws(() => secondsToTimeUnits(-1), TypeError);
  assert.throws(() => secondsToTimeUnits(1.25), TypeError);
  assert.throws(() => secondsToTimeUnits(Number.MAX_SAFE_INTEGER), RangeError);
});

test('interval semantics are (from, to], including the right endpoint only', () => {
  const interval = createTimeInterval(10, 20);
  assert.equal(intervalContains(interval, 10), false);
  assert.equal(intervalContains(interval, 11), true);
  assert.equal(intervalContains(interval, 20), true);
  assert.equal(intervalContains(interval, 21), false);
  assert.equal(intervalContains(createTimeInterval(10, 10), 10), false);
  assert.throws(() => createTimeInterval(20, 10), RangeError);
});

test('fixed calendar projects months, weekday cycles and recurring holidays', () => {
  const projected = projectFixedCalendar(30 * TIME_UNITS_PER_DAY, calendar);
  assert.deepEqual({
    year: projected.year,
    month: projected.month,
    day: projected.day,
    weekday: projected.weekday,
    holidayIds: projected.holidays.map((holiday) => holiday.id),
  }, {
    year: 1,
    month: 2,
    day: 1,
    weekday: 'First',
    holidayIds: [],
  });

  const newYear = projectFixedCalendar(0, calendar);
  assert.equal(newYear.month_name, 'Ash');
  assert.deepEqual(newYear.holidays.map((holiday) => holiday.id), ['year-day']);
});

test('calendar projection handles negative coordinates and time before day boundary', () => {
  const projected = projectFixedCalendar(-1, calendar);
  assert.equal(projected.year, 0);
  assert.equal(projected.month, 3);
  assert.equal(projected.day, 30);
  assert.equal(projected.time_of_day_units, TIME_UNITS_PER_DAY - 1);
  assert.equal(projected.weekday, 'Fifth');
});

test('calendar projection identifies one-off holidays only in their year', () => {
  const dayIndex = 30 + 2;
  const coordinate = (90 + dayIndex) * TIME_UNITS_PER_DAY;
  const projected = projectFixedCalendar(coordinate, calendar);
  assert.equal(projected.year, 2);
  assert.equal(projected.month, 2);
  assert.equal(projected.day, 3);
  assert.deepEqual(projected.holidays.map((holiday) => holiday.id), ['founding']);
});

test('calendar may omit weekdays and define a non-standard day length', () => {
  const custom = {
    version: 'short-day@1',
    unitsPerDay: 100,
    epoch: { coordinate: 50, year: -2, month: 1, day: 1 },
    months: [{ name: 'Only', days: 10 }],
    weekdays: [],
  };
  const projected = projectFixedCalendar(150, custom);
  assert.equal(projected.year, -2);
  assert.equal(projected.month, 1);
  assert.equal(projected.day, 2);
  assert.equal(projected.time_of_day_units, 0);
  assert.equal(projected.weekday, null);
});

test('calendar projection uses exact floor division near negative coordinate boundaries', () => {
  const custom = {
    version: 'large-day@1',
    unitsPerDay: Number.MAX_SAFE_INTEGER - 1,
    epoch: { coordinate: 0, year: 0, month: 1, day: 1 },
    months: [{ name: 'Only', days: 10 }],
    weekdays: [],
  };
  const projected = projectFixedCalendar(-Number.MAX_SAFE_INTEGER, custom);
  assert.equal(projected.year, -2);
  assert.equal(projected.day, 9);
  assert.equal(projected.time_of_day_units, Number.MAX_SAFE_INTEGER - 3);
});

test('calendar definitions reject invalid epochs and month layouts', () => {
  assert.throws(() => projectFixedCalendar(0, { ...calendar, epoch: { ...calendar.epoch, month: 99 } }), TypeError);
  assert.throws(() => projectFixedCalendar(0, { ...calendar, months: [{ name: 'Ash', days: 0 }] }), TypeError);
  assert.throws(() => projectFixedCalendar(0, { ...calendar, weekdays: ['Same', 'Same'] }), TypeError);
  assert.throws(() => projectFixedCalendar(0, { ...calendar, holidays: 'not-an-array' }), TypeError);
});
