import { assertTimeCoordinate, differenceTimeCoordinates } from './coordinate.js';

function parseIsoInstant(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(name + ' must be a non-empty ISO date-time string.');
  }
  const match = /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new TypeError(name + ' must use ISO date-time syntax with an explicit timezone and at most millisecond precision.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[8];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]
    || hour > 23 || minute > 59 || second > 59) {
    throw new TypeError(name + ' contains an out-of-range date or time component.');
  }
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) throw new TypeError(name + ' contains an invalid timezone offset.');
  }
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new TypeError(name + ' must be a valid date-time within the platform ISO range.');
  }
  return milliseconds;
}

/**
 * Compatibility boundary for existing ISO game_time values.
 *
 * Coordinates are elapsed millisecond-sized units relative to an explicit ISO
 * anchor. The anchor is supplied by the caller (for example, the world's
 * initial_game_time); this function does not choose an epoch implicitly.
 */
export function isoInstantToCoordinate(isoInstant, epochIsoInstant) {
  const instant = parseIsoInstant(isoInstant, 'isoInstant');
  const epoch = parseIsoInstant(epochIsoInstant, 'epochIsoInstant');
  return differenceTimeCoordinates(instant, epoch);
}

export function coordinateToIsoInstant(coordinate, epochIsoInstant) {
  assertTimeCoordinate(coordinate);
  const epoch = parseIsoInstant(epochIsoInstant, 'epochIsoInstant');
  const absoluteMilliseconds = epoch + coordinate;
  if (!Number.isSafeInteger(absoluteMilliseconds)) {
    throw new RangeError('ISO instant exceeds the safe integer range.');
  }
  const date = new Date(absoluteMilliseconds);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('ISO instant is outside the platform date range.');
  }
  return date.toISOString();
}
