/**
 * Pure arithmetic for world-local game-time coordinates.
 *
 * A coordinate is an integer count of millisecond-sized units relative to a
 * world-defined temporal epoch. It is not a Unix timestamp. Calendar projection
 * is a separate concern.
 */

export const TIME_UNITS_PER_SECOND = 1_000;
export const TIME_UNITS_PER_MINUTE = 60 * TIME_UNITS_PER_SECOND;
export const TIME_UNITS_PER_HOUR = 60 * TIME_UNITS_PER_MINUTE;
export const TIME_UNITS_PER_DAY = 24 * TIME_UNITS_PER_HOUR;

export function assertTimeCoordinate(value, name = 'coordinate') {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(name + ' must be a safe integer.');
  }
  return value;
}

export function addTimeUnits(coordinate, delta) {
  assertTimeCoordinate(coordinate, 'coordinate');
  assertTimeCoordinate(delta, 'delta');
  const result = coordinate + delta;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('Time coordinate overflow.');
  }
  return result;
}

export function differenceTimeCoordinates(to, from) {
  assertTimeCoordinate(to, 'to');
  assertTimeCoordinate(from, 'from');
  const result = to - from;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('Time-coordinate difference exceeds the safe integer range.');
  }
  return result;
}

export function secondsToTimeUnits(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new TypeError('seconds must be a non-negative safe integer.');
  }
  const units = seconds * TIME_UNITS_PER_SECOND;
  if (!Number.isSafeInteger(units)) {
    throw new RangeError('Duration exceeds the safe time-unit range.');
  }
  return units;
}

export function createTimeInterval(from, to) {
  assertTimeCoordinate(from, 'from');
  assertTimeCoordinate(to, 'to');
  if (to < from) throw new RangeError('Interval end must not precede its start.');
  return Object.freeze({ from, to, semantics: '(from, to]' });
}

/** True for the half-open interval (from, to], including its right endpoint. */
export function intervalContains(interval, coordinate) {
  if (!interval || typeof interval !== 'object') {
    throw new TypeError('interval must be an interval object.');
  }
  const normalized = createTimeInterval(interval.from, interval.to);
  assertTimeCoordinate(coordinate, 'coordinate');
  return coordinate > normalized.from && coordinate <= normalized.to;
}

export function compareTimeCoordinates(left, right) {
  assertTimeCoordinate(left, 'left');
  assertTimeCoordinate(right, 'right');
  return left < right ? -1 : left > right ? 1 : 0;
}
