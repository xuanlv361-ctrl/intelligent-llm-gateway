import {expect,test,vi} from "vitest";
import {
 calculateQuickRange,rangeAsUtc,toLocalDateTimeInput,validateLogSyncRange,
} from "./logSyncRange";

test("quick ranges calculate deterministic 15m, 1h, 24h and today values",()=>{
 const now=new Date(2026,6,29,12,30,0);
 expect(calculateQuickRange("15m",now).dateFrom).toBe(
  toLocalDateTimeInput(new Date(2026,6,29,12,15)));
 expect(calculateQuickRange("1h",now).dateFrom).toBe(
  toLocalDateTimeInput(new Date(2026,6,29,11,30)));
 expect(calculateQuickRange("24h",now).dateFrom).toBe(
  toLocalDateTimeInput(new Date(2026,6,28,12,30)));
 expect(calculateQuickRange("today",now).dateFrom).toBe(
  toLocalDateTimeInput(new Date(2026,6,29,0,0)));
});

test("custom range validates ordering, future skew and maximum duration",()=>{
 const now=new Date("2026-07-29T04:00:00Z");
 expect(validateLogSyncRange("","2026-07-29T12:00",now)).toMatch(/必须填写/);
 expect(validateLogSyncRange("2026-07-29T12:00","2026-07-29T11:00",now)).toMatch(/早于/);
 expect(validateLogSyncRange("2026-07-29T11:00","2026-07-29T12:06",now,168,300)).toMatch(/时钟偏差/);
 expect(validateLogSyncRange("2026-07-20T12:00","2026-07-29T12:00",now,168,300)).toMatch(/168/);
 expect(validateLogSyncRange("2026-07-29T11:00","2026-07-29T12:00",now)).toBeNull();
});

test("browser-local datetime converts to the correct UTC instant",()=>{
 vi.stubEnv("TZ","Asia/Shanghai");
 const result=rangeAsUtc("2026-07-29T08:00","2026-07-29T09:00");
 expect(result.dateFromUtc).toBe("2026-07-29T00:00:00.000Z");
 expect(result.dateToUtc).toBe("2026-07-29T01:00:00.000Z");
 vi.unstubAllEnvs();
});
