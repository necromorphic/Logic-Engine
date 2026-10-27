/**
 * Pure, adapter-independent temporal primitives for Logic-Engine T1.
 *
 * Canonical coordinates are safe integer milliseconds relative to a world's
 * configured epoch. Calendar rules are a versioned projection, never the
 * canonical storage format. This module intentionally has no I/O, database,
 * system-clock, or scheduler dependency.
 */

export const TIME_COORDINATE_UNIT = 'millisecond';

export class TemporalModelError extends RangeError {
  constructor(code, message) {
    super(message);
    this.name = 'TemporalModelError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new TemporalModelError(code, message);
}

function safeInteger(value, name) {
  if (!Number.isSafeInteger(value)) {
    fail('INVALID_INTEGER', name + ' must be a safe integer.');
  }
  return value;
}

function positiveSafeInteger(value, name) {
  safeInteger(value, name);
  if (value <= 0) fail('INVALID_POSITIVE_INTEGER', name + ' must be greater than zero.');
  return value;
}

function nonEmptyString(value, name, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    fail('INVALID_STRING', name + ' must be a non-empty string of at most ' + maxLength + ' characters.');
  }
  return value.trim();
}

function assertPlainDataRecord(value, allowed, code, name, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, name + ' must be an object.');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(code, name + ' must be a plain data object.');
  }
  for (const field of required) {
    if (!Object.hasOwn(value, field)) fail(code, name + ' is missing required field ' + field + '.');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      fail(code, name + ' contains an unsupported field.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail(code, name + ' fields must be own enumerable data properties.');
    }
    if (descriptor.value === undefined) {
      fail(code, name + ' fields must not be explicitly undefined.');
    }
  }
}

function denseArrayValues(value, max, code, name, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max
      || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(code, name + ' must be a plain array with between ' + min + ' and ' + max + ' entries.');
  }
  const values = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(code, name + ' cannot contain sparse entries.');
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail(code, name + ' entries must be own enumerable data properties.');
    }
    values.push(descriptor.value);
  }
  const allowedKeys = new Set(['length', ...values.map((_, index) => String(index))]);
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !allowedKeys.has(key))) {
    fail(code, name + ' cannot contain extra array properties.');
  }
  return values;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function checkedAdd(a, b, name) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) fail('COORDINATE_OVERFLOW', name + ' exceeds the safe integer range.');
  return result;
}

function checkedMultiply(a, b, name) {
  const result = a * b;
  if (!Number.isSafeInteger(result)) fail('COORDINATE_OVERFLOW', name + ' exceeds the safe integer range.');
  return result;
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function sumSafe(values, name) {
  let sum = 0;
  for (const value of values) sum = checkedAdd(sum, value, name);
  return sum;
}

export function createTimeCoordinate(value) {
  return safeInteger(value, 'coordinate');
}

export function addTimeDuration(coordinate, durationMs) {
  safeInteger(coordinate, 'coordinate');
  safeInteger(durationMs, 'durationMs');
  if (durationMs < 0) fail('NEGATIVE_DURATION', 'durationMs must be non-negative.');
  return checkedAdd(coordinate, durationMs, 'Advanced coordinate');
}

export function createTimeInterval(from, to) {
  safeInteger(from, 'from');
  safeInteger(to, 'to');
  if (to < from) fail('REVERSED_INTERVAL', 'Interval end must not precede its start.');
  return Object.freeze({ from, to, boundary: '(from, to]' });
}

export function intervalContainsTime(interval, coordinate) {
  if (!interval || !Number.isSafeInteger(interval.from) || !Number.isSafeInteger(interval.to)
      || interval.to < interval.from) {
    fail('INVALID_INTERVAL', 'interval must contain safe integer from/to coordinates in ascending order.');
  }
  safeInteger(coordinate, 'coordinate');
  return coordinate > interval.from && coordinate <= interval.to;
}

function normalizeMonth(month, yearIndex, monthIndex) {
  assertPlainDataRecord(month, ['id', 'name', 'days'], 'INVALID_CALENDAR_MONTH', 'Calendar month', ['id', 'name', 'days']);
  return {
    id: nonEmptyString(month.id, 'year_cycle[' + yearIndex + '].months[' + monthIndex + '].id'),
    name: nonEmptyString(month.name, 'year_cycle[' + yearIndex + '].months[' + monthIndex + '].name'),
    days: positiveSafeInteger(month.days, 'year_cycle[' + yearIndex + '].months[' + monthIndex + '].days'),
  };
}

/**
 * Validate and normalize a declarative calendar. year_cycle repeats in both
 * directions from epoch.year_cycle_index. Different years in the cycle may
 * have different month lengths, including leap-day or leap-month patterns.
 */
export function createCalendarDefinition(input) {
  assertPlainDataRecord(input, ['calendar_id', 'version', 'day_length_ms', 'weekdays', 'year_cycle', 'epoch', 'holidays'], 'INVALID_CALENDAR', 'Calendar definition', ['calendar_id', 'version', 'day_length_ms', 'weekdays', 'year_cycle', 'epoch']);

  const calendarId = nonEmptyString(input.calendar_id, 'calendar_id');
  const version = nonEmptyString(input.version, 'version', 100);
  const dayLengthMs = positiveSafeInteger(input.day_length_ms, 'day_length_ms');

  const weekdays = denseArrayValues(input.weekdays, 1000, 'INVALID_WEEKDAYS', 'weekdays', 1)
    .map((name, i) => nonEmptyString(name, 'weekdays[' + i + ']'));

  const yearEntries = denseArrayValues(input.year_cycle, 1000, 'INVALID_YEAR_CYCLE', 'year_cycle', 1);
  const yearCycle = yearEntries.map((year, yearIndex) => {
    // Normalized calendars carry a derived `days` field on each year.
    // Accept it when revalidating an already-normalized calendar, but verify
    // it against the canonical month sum instead of trusting the supplied value.
    assertPlainDataRecord(year, ['id', 'name', 'months', 'days'], 'INVALID_CALENDAR_YEAR', 'Calendar year', ['id', 'name', 'months']);
    const monthEntries = denseArrayValues(year.months, 1000, 'INVALID_CALENDAR_MONTHS', 'year-cycle months', 1);
    const months = monthEntries.map((month, monthIndex) => normalizeMonth(month, yearIndex, monthIndex));
    if (new Set(months.map((month) => month.id)).size !== months.length) {
      fail('DUPLICATE_MONTH_ID', 'Month ids must be unique within each year-cycle entry.');
    }
    const days = sumSafe(months.map((month) => month.days), 'Year length');
    if (Object.hasOwn(year, 'days') && year.days !== days) {
      fail('INVALID_CALENDAR_YEAR', 'Derived year days must equal the sum of its month lengths.');
    }
    return {
      id: nonEmptyString(year.id, 'year_cycle[' + yearIndex + '].id'),
      name: nonEmptyString(year.name, 'year_cycle[' + yearIndex + '].name'),
      months,
      days,
    };
  });

  if (new Set(yearCycle.map((year) => year.id)).size !== yearCycle.length) {
    fail('DUPLICATE_YEAR_ID', 'Year-cycle ids must be unique.');
  }
  const cycleDays = sumSafe(yearCycle.map((year) => year.days), 'Year-cycle length');
  if (!Number.isSafeInteger(cycleDays) || cycleDays <= 0) {
    fail('INVALID_YEAR_CYCLE_LENGTH', 'Total year-cycle length must be a positive safe integer.');
  }

  const epochInput = input.epoch;
  assertPlainDataRecord(epochInput, ['coordinate', 'year_number', 'year_cycle_index', 'month_id', 'day_of_month', 'weekday_index', 'time_of_day_ms'], 'INVALID_CALENDAR_EPOCH', 'Calendar epoch', ['coordinate', 'year_number', 'year_cycle_index', 'month_id', 'day_of_month', 'weekday_index']);
  const epoch = {
    coordinate: safeInteger(epochInput.coordinate, 'epoch.coordinate'),
    year_number: safeInteger(epochInput.year_number, 'epoch.year_number'),
    year_cycle_index: safeInteger(epochInput.year_cycle_index, 'epoch.year_cycle_index'),
    month_id: nonEmptyString(epochInput.month_id, 'epoch.month_id'),
    day_of_month: positiveSafeInteger(epochInput.day_of_month, 'epoch.day_of_month'),
    weekday_index: safeInteger(epochInput.weekday_index, 'epoch.weekday_index'),
    time_of_day_ms: Object.hasOwn(epochInput, 'time_of_day_ms')
      ? safeInteger(epochInput.time_of_day_ms, 'epoch.time_of_day_ms') : 0,
  };

  if (epoch.year_cycle_index < 0 || epoch.year_cycle_index >= yearCycle.length) {
    fail('INVALID_EPOCH_YEAR_INDEX', 'epoch.year_cycle_index must refer to an entry in year_cycle.');
  }
  if (epoch.weekday_index < 0 || epoch.weekday_index >= weekdays.length) {
    fail('INVALID_EPOCH_WEEKDAY', 'epoch.weekday_index must refer to an entry in weekdays.');
  }
  if (epoch.time_of_day_ms < 0 || epoch.time_of_day_ms >= dayLengthMs) {
    fail('INVALID_EPOCH_TIME_OF_DAY', 'epoch.time_of_day_ms must be within the calendar day.');
  }

  const epochYear = yearCycle[epoch.year_cycle_index];
  const epochMonthIndex = epochYear.months.findIndex((month) => month.id === epoch.month_id);
  if (epochMonthIndex < 0) fail('INVALID_EPOCH_MONTH', 'epoch.month_id is not present in its year-cycle entry.');
  if (epoch.day_of_month > epochYear.months[epochMonthIndex].days) {
    fail('INVALID_EPOCH_DAY', 'epoch.day_of_month exceeds the selected month length.');
  }

  const monthIds = new Set(yearCycle.flatMap((year) => year.months.map((month) => month.id)));
  const holidaysInput = Object.hasOwn(input, 'holidays') ? input.holidays : [];
  const holidayEntries = denseArrayValues(holidaysInput, 10000, 'INVALID_HOLIDAYS', 'holidays');
  const holidayIds = new Set();
  const holidays = holidayEntries.map((holiday, i) => {
    assertPlainDataRecord(holiday, ['id', 'name', 'month_id', 'day_of_month', 'year_number'], 'INVALID_HOLIDAY', 'Calendar holiday', ['id', 'name', 'month_id', 'day_of_month']);
    const id = nonEmptyString(holiday.id, 'holidays[' + i + '].id');
    if (holidayIds.has(id)) fail('DUPLICATE_HOLIDAY_ID', 'Holiday ids must be unique.');
    holidayIds.add(id);
    const monthId = nonEmptyString(holiday.month_id, 'holidays[' + i + '].month_id');
    if (!monthIds.has(monthId)) fail('INVALID_HOLIDAY_MONTH', 'Holiday month_id does not exist in the year cycle.');
    const dayOfMonth = positiveSafeInteger(holiday.day_of_month, 'holidays[' + i + '].day_of_month');
    if (!yearCycle.some((year) => year.months.some((month) => month.id === monthId && month.days >= dayOfMonth))) {
      fail('INVALID_HOLIDAY_DAY', 'Holiday day_of_month does not exist in any year-cycle entry.');
    }
    const normalized = { id, name: nonEmptyString(holiday.name, 'holidays[' + i + '].name'), month_id: monthId, day_of_month: dayOfMonth };
    if (Object.hasOwn(holiday, 'year_number')) {
      normalized.year_number = safeInteger(holiday.year_number, 'holidays[' + i + '].year_number');
      const holidayYearOffset = normalized.year_number - epoch.year_number;
      safeInteger(holidayYearOffset, 'Holiday year offset');
      const index = mod(epoch.year_cycle_index + mod(holidayYearOffset, yearCycle.length), yearCycle.length);
      const month = yearCycle[index].months.find((entry) => entry.id === monthId);
      if (!month || month.days < dayOfMonth) {
        fail('INVALID_ONE_OFF_HOLIDAY_DATE', 'One-off holiday date does not exist in its year.');
      }
    }
    return normalized;
  });

  return deepFreeze({
    calendar_id: calendarId,
    version,
    day_length_ms: dayLengthMs,
    weekdays,
    year_cycle: yearCycle,
    epoch,
    holidays,
  });
}

function epochDayOfYear(calendar) {
  const year = calendar.year_cycle[calendar.epoch.year_cycle_index];
  let days = 0;
  for (const month of year.months) {
    if (month.id === calendar.epoch.month_id) return days + calendar.epoch.day_of_month - 1;
    days = checkedAdd(days, month.days, 'Epoch day of year');
  }
  fail('INVALID_CALENDAR_EPOCH', 'Epoch month could not be resolved.');
}

function rotatedYears(calendar) {
  const { year_cycle_index } = calendar.epoch;
  return calendar.year_cycle.map((_, i) => calendar.year_cycle[(year_cycle_index + i) % calendar.year_cycle.length]);
}

function dayIndexForDate(calendar, date) {
  // Accept both minimal date inputs and the known projection shape, while
  // refusing inherited fields or executable accessors at this boundary.
  assertPlainDataRecord(date, [
    'calendar_id', 'calendar_version', 'coordinate', 'year_number',
    'year_cycle_index', 'month_id', 'month_name', 'day_of_month',
    'weekday_index', 'weekday', 'time_of_day_ms', 'holidays',
  ], 'INVALID_CALENDAR_DATE', 'Calendar date', ['year_number', 'month_id', 'day_of_month']);
  const yearNumber = safeInteger(date.year_number, 'date.year_number');
  const yearOffset = yearNumber - calendar.epoch.year_number;
  safeInteger(yearOffset, 'Year offset');
  const cycleLength = calendar.year_cycle.length;
  const cycles = Math.floor(yearOffset / cycleLength);
  const remainder = mod(yearOffset, cycleLength);
  const years = rotatedYears(calendar);
  const cycleDays = sumSafe(years.map((year) => year.days), 'Year-cycle length');
  let days = checkedMultiply(cycles, cycleDays, 'Calendar day offset');
  for (let i = 0; i < remainder; i++) days = checkedAdd(days, years[i].days, 'Calendar day offset');

  const yearIndex = mod(calendar.epoch.year_cycle_index + mod(yearOffset, cycleLength), cycleLength);
  const targetYear = calendar.year_cycle[yearIndex];
  const monthId = nonEmptyString(date.month_id, 'date.month_id');
  const monthIndex = targetYear.months.findIndex((month) => month.id === monthId);
  if (monthIndex < 0) fail('INVALID_CALENDAR_MONTH', 'month_id does not exist in the requested year.');
  const dayOfMonth = positiveSafeInteger(date.day_of_month, 'date.day_of_month');
  if (dayOfMonth > targetYear.months[monthIndex].days) {
    fail('INVALID_CALENDAR_DAY', 'day_of_month exceeds the requested month length.');
  }
  for (let i = 0; i < monthIndex; i++) days = checkedAdd(days, targetYear.months[i].days, 'Calendar day offset');
  return {
    days: checkedAdd(days, dayOfMonth - 1, 'Calendar day offset'),
    year_number: yearNumber,
    year_cycle_index: yearIndex,
    month_id: monthId,
    day_of_month: dayOfMonth,
  };
}

function timeOfDay(value, dayLengthMs) {
  const time = value === undefined ? 0 : safeInteger(value, 'time_of_day_ms');
  if (time < 0 || time >= dayLengthMs) fail('INVALID_TIME_OF_DAY', 'time_of_day_ms must be within the calendar day.');
  return time;
}

export function projectCalendarDate(definition, coordinate) {
  const calendar = createCalendarDefinition(definition);
  safeInteger(coordinate, 'coordinate');
  const delta = coordinate - calendar.epoch.coordinate;
  safeInteger(delta, 'Coordinate delta');
  const elapsed = checkedAdd(delta, calendar.epoch.time_of_day_ms, 'Elapsed time from epoch day start');
  const dayOffset = Math.floor(elapsed / calendar.day_length_ms);
  const timeOfDayMs = mod(elapsed, calendar.day_length_ms);
  const targetDayIndex = checkedAdd(epochDayOfYear(calendar), dayOffset, 'Target day index');

  const years = rotatedYears(calendar);
  const cycleDays = sumSafe(years.map((year) => year.days), 'Year-cycle length');
  const cycleOffset = Math.floor(targetDayIndex / cycleDays);
  const dayWithinCycle = mod(targetDayIndex, cycleDays);
  let remaining = dayWithinCycle;
  let yearOffsetWithinCycle = 0;
  while (yearOffsetWithinCycle < years.length - 1 && remaining >= years[yearOffsetWithinCycle].days) {
    remaining -= years[yearOffsetWithinCycle].days;
    yearOffsetWithinCycle += 1;
  }
  const year = years[yearOffsetWithinCycle];
  let monthRemaining = remaining;
  let month = year.months[0];
  for (const candidate of year.months) {
    if (monthRemaining < candidate.days) {
      month = candidate;
      break;
    }
    monthRemaining -= candidate.days;
  }
  const yearNumber = checkedAdd(
    calendar.epoch.year_number,
    checkedAdd(checkedMultiply(cycleOffset, years.length, 'Calendar year offset'), yearOffsetWithinCycle, 'Calendar year offset'),
    'Calendar year number',
  );
  const weekdayIndex = mod(calendar.epoch.weekday_index + mod(dayOffset, calendar.weekdays.length), calendar.weekdays.length);
  const holidays = calendar.holidays
    .filter((holiday) => holiday.month_id === month.id
      && holiday.day_of_month === monthRemaining + 1
      && (!Object.hasOwn(holiday, 'year_number') || holiday.year_number === yearNumber))
    .map(({ id, name }) => ({ id, name }));

  return {
    calendar_id: calendar.calendar_id,
    calendar_version: calendar.version,
    coordinate,
    year_number: yearNumber,
    year_cycle_index: mod(calendar.epoch.year_cycle_index + mod(yearNumber - calendar.epoch.year_number, calendar.year_cycle.length), calendar.year_cycle.length),
    month_id: month.id,
    month_name: month.name,
    day_of_month: monthRemaining + 1,
    weekday_index: weekdayIndex,
    weekday: calendar.weekdays[weekdayIndex],
    time_of_day_ms: timeOfDayMs,
    holidays,
  };
}

export function calendarDateToCoordinate(definition, date) {
  const calendar = createCalendarDefinition(definition);
  const day = dayIndexForDate(calendar, date);
  const targetTime = timeOfDay(
    Object.hasOwn(date, 'time_of_day_ms') ? date.time_of_day_ms : undefined,
    calendar.day_length_ms,
  );
  const daysFromEpochDate = day.days - epochDayOfYear(calendar);
  const elapsedMs = checkedMultiply(daysFromEpochDate, calendar.day_length_ms, 'Calendar date coordinate');
  const withTime = checkedAdd(elapsedMs, targetTime - calendar.epoch.time_of_day_ms, 'Calendar date coordinate');
  return checkedAdd(calendar.epoch.coordinate, withTime, 'Calendar date coordinate');
}
