import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Toast, ToastClose, ToastProvider, ToastViewport } from "@/components/ui/toast";

/**
 * Souk e2e layout probe (Pixel 7 / iPad): dialog "Close" buttons measured
 * 15-16px and toast close buttons 24x24. jsdom has no layout, so this pins
 * the sizing classes that give a 44x44 target (h-11 w-11 = 2.75rem = 44px).
 */
afterEach(cleanup);

describe("touch targets", () => {
  it("the dialog close button is 44x44", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Example</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toMatch(/\bh-11\b/);
    expect(close.className).toMatch(/\bw-11\b/);
    // no tinted 44px block where a 16px icon used to be
    expect(close.className).not.toMatch(/bg-accent/);
  });

  it("the toast close button is 44x44 and the toast leaves room for it", () => {
    render(
      <ToastProvider>
        <Toast open data-testid="toast">
          <span>Till opened</span>
          <ToastClose aria-label="Dismiss" />
        </Toast>
        <ToastViewport />
      </ToastProvider>,
    );
    const close = screen.getByRole("button", { name: "Dismiss" });
    expect(close.className).toMatch(/\bh-11\b/);
    expect(close.className).toMatch(/\bw-11\b/);
    expect(screen.getByTestId("toast").className).toMatch(/\bpr-12\b/);
  });

  it("on phones the toast viewport starts below the header, not over it (md+ unchanged)", () => {
    render(
      <ToastProvider>
        <ToastViewport data-testid="viewport" />
      </ToastProvider>,
    );
    const cls = screen.getByTestId("viewport").className;
    expect(cls).toMatch(/top-\[calc\(4\.75rem/);
    expect(cls).toMatch(/\bmd:top-0\b/);
    expect(cls).not.toMatch(/(^|\s)top-0(\s|$)/);
  });
});
