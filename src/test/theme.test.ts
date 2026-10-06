import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the light-theme conversion (WORKLOG.md, theme conversion pass).
 * This app previously shipped a DARK theme as its unconditional `:root`
 * default (`--background: 220 40% 8%`), which conflicted with the rest of
 * the platform's light-first direction. These are source-level checks
 * (grep-equivalent, not computed-style checks) because the actual Tailwind
 * build/PostCSS pipeline that turns index.css into applied styles doesn't
 * run inside Vitest's jsdom environment — reading the token source is the
 * reliable way to pin this down without a full build step per test run.
 */

const cssPath = path.resolve(__dirname, "../index.css");
const css = fs.readFileSync(cssPath, "utf-8");

// Isolate the :root block specifically, not the whole file (the old dark
// values must still exist further down, inside .dark — see below).
const rootBlockMatch = css.match(/:root\s*{([^}]*)}/);
const rootBlock = rootBlockMatch?.[1] ?? "";

const darkBlockMatch = css.match(/\.dark\s*{([^}]*)}/);
const darkBlock = darkBlockMatch?.[1] ?? "";

describe("index.css default theme", () => {
  it("has a :root block", () => {
    expect(rootBlockMatch).not.toBeNull();
  });

  it("no longer defaults :root to the old dark background/foreground", () => {
    expect(rootBlock).not.toContain("220 40% 8%"); // old dark --background
    expect(rootBlock).not.toContain("210 20% 92%"); // old dark --foreground
  });

  it(":root now defaults to a light background with a dark foreground", () => {
    // Background lightness must be high (light surface)...
    const bgMatch = rootBlock.match(/--background:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    expect(bgMatch).not.toBeNull();
    const bgLightness = Number(bgMatch?.[3]);
    expect(bgLightness).toBeGreaterThan(85);

    // ...and foreground lightness must be low (dark text), so text is
    // actually readable against that light background.
    const fgMatch = rootBlock.match(/--foreground:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    expect(fgMatch).not.toBeNull();
    const fgLightness = Number(fgMatch?.[3]);
    expect(fgLightness).toBeLessThan(20);
  });

  it("keeps a .dark block available, as a real semantic theme rather than an inversion", () => {
    // UI V2 replaced the carried-over legacy dark values (220 40% 8% /
    // 210 20% 92%, a blue-black) with a neutral charcoal theme. This test
    // used to pin those two literals; it now asserts the PROPERTY that
    // matters instead, which is both stronger and survives a future retune.
    expect(darkBlockMatch).not.toBeNull();

    const bg = darkBlock.match(/--background:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    const fg = darkBlock.match(/--foreground:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    expect(bg).not.toBeNull();
    expect(fg).not.toBeNull();

    const bgL = Number(bg?.[3]);
    const fgL = Number(fg?.[3]);

    // Genuinely dark, but never pure black -- a till screen at 8pm is exactly
    // where a 0%-lightness canvas causes eye strain.
    expect(bgL).toBeLessThan(15);
    expect(bgL).toBeGreaterThan(3);
    // Legible, but never pure white, for the same reason.
    expect(fgL).toBeGreaterThan(80);
    expect(fgL).toBeLessThan(97);

    // Surfaces must sit ABOVE the canvas so cards read as elevated.
    const card = darkBlock.match(/--card:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
    expect(card).not.toBeNull();
    expect(Number(card?.[3])).toBeGreaterThan(bgL);
  });
});

describe("UI V2 token contract", () => {
  it("retires the old dark-blue SaaS primary", () => {
    // Every app shared --primary: 207 80% 42% before this programme.
    expect(rootBlock).not.toContain("207 80% 42%");
  });

  it("exposes the brand tokens the runtime theme engine writes over", () => {
    for (const token of [
      "--brand-primary",
      "--brand-primary-hover",
      "--brand-primary-soft",
      "--brand-on-primary",
      "--brand-raw",
    ]) {
      expect(rootBlock).toContain(token);
    }
  });

  it("keeps operational colours defined independently of the brand", () => {
    // These must never be brand-driven: an error has to look like an error in
    // every restaurant, because staff move between them.
    for (const token of ["--success", "--warning", "--destructive", "--info"]) {
      expect(rootBlock).toContain(token);
    }
  });

  it("defines the elevation, radius and motion scales the design system uses", () => {
    for (const token of ["--shadow-sm", "--shadow-md", "--radius-md", "--motion-fast"]) {
      expect(rootBlock).toContain(token);
    }
  });
});

describe("PWA theme metadata", () => {
  const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf-8");
  const viteConfig = fs.readFileSync(path.resolve(__dirname, "../../vite.config.ts"), "utf-8");

  it("index.html's theme-color meta no longer matches the old dark page background", () => {
    expect(indexHtml).not.toContain('content="#0a1628"');
  });

  it("the PWA manifest's theme_color/background_color no longer match the old dark page background", () => {
    expect(viteConfig).not.toContain('"#0a1628"');
  });

  it("neither still carries the retired blue accent (UI V2)", () => {
    expect(indexHtml).not.toContain("#1574c1");
    expect(viteConfig).not.toContain("#1574c1");
  });
});
