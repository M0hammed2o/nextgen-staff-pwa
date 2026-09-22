import { describe, it, expect } from "vitest";
import { looksLikeSaPhoneNumber } from "@/lib/phone";

describe("looksLikeSaPhoneNumber", () => {
  it("accepts a local 10-digit number starting with 0", () => {
    expect(looksLikeSaPhoneNumber("0821234567")).toBe(true);
  });

  it("accepts a local number with spaces", () => {
    expect(looksLikeSaPhoneNumber("082 123 4567")).toBe(true);
  });

  it("accepts an international +27 number", () => {
    expect(looksLikeSaPhoneNumber("+27821234567")).toBe(true);
  });

  it("accepts an international number without the +", () => {
    expect(looksLikeSaPhoneNumber("27821234567")).toBe(true);
  });

  it("accepts hyphens/parens as separators", () => {
    expect(looksLikeSaPhoneNumber("(082) 123-4567")).toBe(true);
  });

  it("rejects empty input", () => {
    expect(looksLikeSaPhoneNumber("")).toBe(false);
    expect(looksLikeSaPhoneNumber("   ")).toBe(false);
  });

  it("rejects an obviously too-short number", () => {
    expect(looksLikeSaPhoneNumber("082123")).toBe(false);
  });

  it("rejects a local number that's too long", () => {
    expect(looksLikeSaPhoneNumber("08212345678")).toBe(false);
  });

  it("rejects a local number missing the leading 0", () => {
    expect(looksLikeSaPhoneNumber("821234567")).toBe(false);
  });

  it("rejects non-numeric input", () => {
    expect(looksLikeSaPhoneNumber("call me maybe")).toBe(false);
  });

  it("rejects a +27 number with the wrong digit count", () => {
    expect(looksLikeSaPhoneNumber("+2782123456")).toBe(false);
  });

  // Never duplicates the backend's mobile-range (6/7/8) check — a
  // plausible-shaped but non-mobile number is accepted here and left for
  // the server's real normalize_sa_mobile() to reject with a 422.
  it("accepts a plausible shape even if not actually a mobile range (server is the real authority)", () => {
    expect(looksLikeSaPhoneNumber("0121234567")).toBe(true);
  });
});
