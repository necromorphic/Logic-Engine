import { assertTimeCoordinate, differenceTimeCoordinates, TIME_UNITS_PER_DAY } from './coordinate.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

function validateCalendar(definition) {
  if (!object(definition)) throw new TypeError('calendar definition must be an object.');
  if (typeof definition.version !== 'string' || !definition.version.trim()) {
    throw new TypeError('calendar.version must be a non-empty string.');
  }
  const unitsPerDay = definition.unitsPerDay ?? TIME_UNITS_PER_DAY;
  if (!positiveInteger(unitsPerDay)) throw new TypeError('calendar.unitsPerDay must be a positive safe integer.');

  if (!Array.isArray(definition.months) || definition.months.length === 0) {
    throw new TypeError('calendar.months must be a non-empty array.');
  }
  const monthNames = new Set();
  let daysPerYear = 0;
  for (const month of definition.months) {
    if (!object(month) || typeof month.name !== 'string' || !month.name.trim() || !positiveInteger(month.days)) {
      throw new TypeError('Each month must have a non-empty name and a positive integer day count.');
    }
    if (monthNames.has(month.name)) throw new TypeError('Month names must be unique.');
    monthNames.add(month.name);
    daysPerYear += month.days;
    if (!Number.isSafeInteger(daysPerYear)) throw new RangeError('Calendar year is too large.');
  }

  if (!Array.isArray(definition.weekdays) || definition.weekdays.some((name) => typeof name !== 'string' || !name.trim())) {
    throw new TypeError('calendar.weekdays must be an array of non-empty names.');
  }
  if (new Set(definition.weekdays).size !== definition.weekdays.length) {
    throw new TypeError('Weekday names must be unique.');
  }

  const epoch = definition.epoch;
  if (!object(epoch)) throw new TypeError('calendar.epoch must be an object.');
  assertTimeCoordinate(epoch.coordinate, 'calendar.epoch.coordinate');
  if (!Number.isSafeInteger(epoch.year)) throw new TypeError('calendar.epoch.year must be a safe integer.');
  if (!Number.isSafeInteger(epoch.month) || epoch.month < 1 || epoch.month > definition.months.length) {
    throw new TypeError('calendar.epoch.month is outside the calendar.');
  }
  const epochMonth = definition.months[epoch.month - 1];
  if (!Number.isSafeInteger(epoch.day) || epoch.day < 1 || epoch.day > epochMonth.days) {
    throw new TypeError('calendar.epoch.day is outside the month.');
  }
  if (definition.weekdays.length === 0) {
    if (epoch.weekdayIndex !== undefined && epoch.weekdayIndex !== null) {
      throw new TypeError('calendar.epoch.weekdayIndex must be omitted when no weekdays are defined.');
    }
  } else if (!Number.isSafeInteger(epoch.weekdayIndex) || epoch.weekdayIndex < 0 || epoch.weekdayIndex >= definition.weekdays.length) {
    throw new TypeError('calendar.epoch.weekdayIndex is outside the weekday cycle.');
  }

  if (definition.holidays !== undefined && !Array.isArray(definition.holidays)) {
    throw new TypeError('calendar.holidays must be an array when provided.');
  }
  const holidayIds = new Set();
  for (const holiday of definition.holidays ?? []) {
    if (!object(holiday) || typeof holiday.id !== 'string' || !holiday.id.trim()
      || typeof holiday.name !== 'string' || !holiday.name.trim()) {
      throw new TypeError('Each holiday must have a non-empty id and name.');
    }
    if (holidayIds.has(holiday.id)) throw new TypeError('Holiday ids must be unique.');
    holidayIds.add(holiday.id);
    if (holiday.kind === 'recurring') {
      if (!Number.isSafeInteger(holiday.month) || holiday.month < 1 || holiday.month > definition.months.length
        || !Number.isSafeInteger(holiday.day) || holiday.day < 1 || holiday.day > definition.months[holiday.month - 1].days) {
        throw new TypeError('Recurring holiday date is outside the calendar.');
      }
    } else if (holiday.kind === 'one_off') {
      if (!Number.isSafeInteger(holiday.year)
        || !Number.isSafeInteger(holiday.month) || holiday.month < 1 || holiday.month > definition.months.length
        || !Number.isSafeInteger(holiday.day) || holiday.day < 1 || holiday.day > definition.months[holiday.month - 1].days) {
        throw new TypeError('One-off holiday date is outside the calendar.');
      }
    } else {
      throw new TypeError('Holiday kind must be recurring or one_off.');
    }
  }

  return { unitsPerDay, daysPerYear };
}

/**
 * Projects a coordinate through a fixed-layout declarative calendar.
 *
 * T1 supports fixed month lengths and a repeating weekday cycle. Leap rules,
 * intercalary periods and dynamic year layouts require a later explicit schema
 * extension; they are not guessed by this function.
 */
export function projectFixedCalendar(coordinate, definition) {
  assertTimeCoordinate(coordinate);
  const { unitsPerDay, daysPerYear } = validateCalendar(definition);
  const delta = differenceTimeCoordinates(coordinate, definition.epoch.coordinate);
  const dayOffset = Math.floor(delta / unitsPerDay);
  const timeOfDayUnits = delta - dayOffset * unitsPerDay;

  let epochDayIndex = definition.epoch.day - 1;
  for (let i = 0; i < definition.epoch.month - 1; i += 1) {
    epochDayIndex += definition.months[i].days;
  }

  const ordinal = epochDayIndex + dayOffset;
  if (!Number.isSafeInteger(ordinal)) throw new RangeError('Calendar day index exceeds the safe integer range.');
  const yearOffset = Math.floor(ordinal / daysPerYear);
  const year = definition.epoch.year + yearOffset;
  if (!Number.isSafeInteger(year)) throw new RangeError('Projected calendar year exceeds the safe integer range.');
  let dayOfYear = mod(ordinal, daysPerYear);

  let monthIndex = 0;
  while (dayOfYear >= definition.months[monthIndex].days) {
    dayOfYear -= definition.months[monthIndex].days;
    monthIndex += 1;
  }
  const month = monthIndex + 1;
  const day = dayOfYear + 1;
  const weekdayIndex = definition.weekdays.length
    ? mod(definition.epoch.weekdayIndex + mod(dayOffset, definition.weekdays.length), definition.weekdays.length)
    : null;

  const holidays = (definition.holidays ?? []).filter((holiday) => holiday.month === month
    && holiday.day === day
    && (holiday.kind === 'recurring' || holiday.year === year))
    .map(({ id, name, kind }) => ({ id, name, kind }));

  return {
    calendar_version: definition.version,
    year,
    month,
    month_name: definition.months[monthIndex].name,
    day,
    weekday_index: weekdayIndex,
    weekday: weekdayIndex === null ? null : definition.weekdays[weekdayIndex],
    time_of_day_units: timeOfDayUnits,
    units_per_day: unitsPerDay,
    holidays,
  };
}
