import { describe, it, expect, afterEach } from "vitest";
import { detectScans, cameraScanSupported, type KeyEvt } from "@/lib/scan-wedge";

const burst = (code: string, start = 1000, gap = 10, enter = true): KeyEvt[] => {
  const evts = [...code].map((key, i) => ({ key, t: start + i * gap }));
  if (enter) evts.push({ key: "Enter", t: start + code.length * gap });
  return evts;
};

describe("keyboard-wedge scan detection", () => {
  it("a fast burst ending in Enter is a scan", () => {
    expect(detectScans(burst("6001234567890"))).toEqual(["6001234567890"]);
  });

  it("slow human typing ending in Enter is not a wedge scan", () => {
    expect(detectScans(burst("6001234567890", 1000, 200))).toEqual([]);
  });

  it("a burst with no Enter yields nothing", () => {
    expect(detectScans(burst("6001234567890", 1000, 10, false))).toEqual([]);
  });

  it("very short bursts (below the minimum length) are ignored", () => {
    expect(detectScans(burst("12"))).toEqual([]);
  });

  it("two scans in a row are both detected, and modifier keys do not break a burst", () => {
    const first = burst("AAAA1111", 1000);
    const second = burst("BBBB2222", 5000);
    const withShift: KeyEvt[] = [{ key: "Shift", t: 1000 }, ...first];
    expect(detectScans([...withShift, ...second])).toEqual(["AAAA1111", "BBBB2222"]);
  });

  it("a slow keystroke before a fast burst does not poison the burst", () => {
    const stray: KeyEvt = { key: "x", t: 100 };
    expect(detectScans([stray, ...burst("TEE-M-BLK", 5000)])).toEqual(["TEE-M-BLK"]);
  });
});

describe("camera scanning is feature-detected", () => {
  const original = (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
  afterEach(() => {
    if (original === undefined) delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    else (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector = original;
  });

  it("is unsupported without BarcodeDetector", () => {
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    expect(cameraScanSupported()).toBe(false);
  });
});
