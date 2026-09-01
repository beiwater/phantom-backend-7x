// Test-only server clock offset. Start the server with:
//
// CLOCK_OFFSET_MS=43200000 node --import ./scripts/e2e/server-clock-offset.mjs \
//   --experimental-strip-types server/index.ts
//
// This changes Date.now/new Date() only inside this process. It does not edit
// SQLite timestamps or alter any production game rule.
const RealDate = globalThis.Date;
const offsetMs = Number(process.env.CLOCK_OFFSET_MS ?? 0);

if (!Number.isFinite(offsetMs)) {
  throw new Error('CLOCK_OFFSET_MS must be a finite number of milliseconds');
}

globalThis.Date = class DateWithOffset extends RealDate {
  constructor(...args) {
    super(...(args.length === 0 ? [RealDate.now() + offsetMs] : args));
  }

  static now() {
    return RealDate.now() + offsetMs;
  }

  static parse(...args) {
    return RealDate.parse(...args);
  }

  static UTC(...args) {
    return RealDate.UTC(...args);
  }
};
