import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTimeDuration,
  calendarDateToCoordinate,
  createCalendarDefinition,
  createTimeCoordinate,
  createTimeInterval,
  intervalContainsTime,
  projectCalendarDate,
} from '../src/time/model.js';

const calendar = () => ({
  calendar_id: 'test.cycle',
  version: '1.0.0',
  day_length_ms: 1000,
  weekdays: ['Ashday', 'Brightday', 'Cinderday'],
  year_cycle: [
    { id: 'short', name: 'Short year', months: [
      { id: 'first', name: 'First', days: 2 },
      { id: 'last', name: 'Last', days: 2 },
    ] },
    { id: 'long', name: 'Long year', months: [
      { id: 'first', name: 'First', days: 2 },
      { id: 'last', name: 'Last', days: 3 },
    ] },
  ],
  epoch: {
    coordinate: 0,
    year_number: 10,
    year_cycle_index: 0,
    month_id: 'first',
    day_of_month: 1,
    weekday_index: 0,
    time_of_day_ms: 0,
  },
  holidays: [
    { id: 'annual', name: 'Annual observance', month_id: 'last', day_of_month: 2 },
    { id: 'one-off', name: 'One-off observance', year_number: 11, month_id: 'first', day_of_month: 2 },
  ],
});

test('coordinates and durations use safe integer milliseconds without system time', () => {
  assert.equal(createTimeCoordinate(-1234), -1234);
  assert.equal(addTimeDuration(-1234, 234), -1000);
  assert.throws(() => createTimeCoordinate(1.5), (error) => error.code === 'INVALID_INTEGER');
  assert.throws(() => addTimeDuration(0, -1), (error) => error.code === 'NEGATIVE_DURATION');
  assert.throws(() => addTimeDuration(Number.MAX_SAFE_INTEGER, 1), (error) => error.code === 'COORDINATE_OVERFLOW');
});

test('interval uses open start and closed end boundary', () => {
  const interval = createTimeInterval(10, 20);
  assert.equal(intervalContainsTime(interval, 10), false);
  assert.equal(intervalContainsTime(interval, 11), true);
  assert.equal(intervalContainsTime(interval, 20), true);
  assert.equal(intervalContainsTime(createTimeInterval(10, 10), 10), false);
  assert.throws(() => createTimeInterval(20, 10), (error) => error.code === 'REVERSED_INTERVAL');
});

test('calendar projection supports custom year lengths, weekdays, and negative coordinates', () => {
  const definition = createCalendarDefinition(calendar());
  assert.equal(definition.calendar_id, 'test.cycle');
  assert.equal(Object.isFrozen(definition.year_cycle), true);
  assert.equal(Object.isFrozen(definition.year_cycle[0].months[0]), true);
  const projected = projectCalendarDate(definition, 4000);
  assert.deepEqual(
    { year_number: projected.year_number, month_id: projected.month_id, day_of_month: projected.day_of_month, weekday: projected.weekday },
    { year_number: 11, month_id: 'first', day_of_month: 1, weekday: 'Brightday' },
  );
  const beforeEpoch = projectCalendarDate(definition, -1);
  assert.deepEqual(
    { year_number: beforeEpoch.year_number, month_id: beforeEpoch.month_id, day_of_month: beforeEpoch.day_of_month },
    { year_number: 9, month_id: 'last', day_of_month: 3 },
  );
  assert.equal(projectCalendarDate(definition, 1000).day_of_month, 2);
});

test('calendar date conversion round-trips across year-cycle boundaries and time-of-day', () => {
  const definition = calendar();
  for (const coordinate of [-9001, -5000, -1, 0, 1, 1999, 4000, 8999, 12000]) {
    const date = projectCalendarDate(definition, coordinate);
    assert.equal(calendarDateToCoordinate(definition, date), coordinate);
  }
});

test('annual and one-off holidays are projected without creating world events', () => {
  const definition = calendar();
  const annual = projectCalendarDate(definition, 7000);
  assert.equal(annual.holidays.some((holiday) => holiday.id === 'annual'), true);
  const oneOff = projectCalendarDate(definition, 5000);
  assert.equal(oneOff.holidays.some((holiday) => holiday.id === 'one-off'), true);
  assert.deepEqual(oneOff.holidays.map((holiday) => holiday.id), ['one-off']);
});

test('calendar validation rejects invalid epoch, dates, duplicate holidays, and unsafe values', () => {
  assert.throws(
    () => createCalendarDefinition({ ...calendar(), epoch: { ...calendar().epoch, month_id: 'missing' } }),
    (error) => error.code === 'INVALID_EPOCH_MONTH',
  );
  assert.throws(
    () => calendarDateToCoordinate(calendar(), { year_number: 10, month_id: 'first', day_of_month: 3 }),
    (error) => error.code === 'INVALID_CALENDAR_DAY',
  );
  assert.throws(
    () => createCalendarDefinition({ ...calendar(), holidays: [
      { id: 'same', name: 'One', month_id: 'first', day_of_month: 1 },
      { id: 'same', name: 'Two', month_id: 'last', day_of_month: 1 },
    ] }),
    (error) => error.code === 'DUPLICATE_HOLIDAY_ID',
  );
  assert.throws(
    () => createCalendarDefinition({ ...calendar(), year_cycle: [calendar().year_cycle[0], { ...calendar().year_cycle[1], id: 'short' }] }),
    (error) => error.code === 'DUPLICATE_YEAR_ID',
  );
  assert.throws(
    () => projectCalendarDate(calendar(), Number.MAX_SAFE_INTEGER + 1),
    (error) => error.code === 'INVALID_INTEGER',
  );
});
