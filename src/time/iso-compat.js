import { assertTimeCoordinate, differenceTimeCoordinates } from './coordinate.js';

function parseIsoInstant(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(name + ' must be a non-empty ISO date-time string.');
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
