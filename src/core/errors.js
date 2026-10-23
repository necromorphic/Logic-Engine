export class EngineError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message); this.name = 'EngineError'; this.code = code; this.status = status; this.details = details;
  }
}
export function assert(condition, code, message, status = 400, details) {
  if (!condition) throw new EngineError(code, message, status, details);
}