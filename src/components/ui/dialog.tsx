import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// A tap that lands on the on-screen TouchKeyboard (components/TouchKeyboard.tsx,
// mounted once at the app root, OUTSIDE this dialog's portal) must never
// count as an "outside" interaction — Radix's default behaviour closes the
// dialog on any pointerdown/focus outside its own content, which would
// otherwise dismiss the dialog the instant a cashier taps a key.
function isTouchKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-touch-keyboard-root]") != null;
}

// Every dialog must stay fully clear of the on-screen TouchKeyboard
// (components/TouchKeyboard.tsx) whenever one is open, without each call
// site having to remember to handle it:
//  - `top` re-centers the dialog within the viewport space ABOVE the
//    keyboard (not the full viewport) — i.e. half the keyboard's height
//    higher than normal centering. Without this, a dialog that happens to
//    fit within the viewport can still have its lower half sit behind the
//    keyboard, since simple bottom padding on the content just grows the
//    (still centered-on-the-full-viewport) box rather than moving it.
//  - `maxHeight` + `overflowY: auto` guarantee the box itself never
//    extends past that safe area, whatever its content — tall content
//    scrolls internally instead of being clipped with no way to reach it
//    (the previous failure mode for the cash-up/open-till dialog, which had
//    no max-height at all).
// A call site's own `style` prop (e.g. an extra bottom-padding spacer) is
// merged on top, not replaced, so nothing existing silently stops working.
//
// Mobile/PWA viewport fit: the usable area is the VISIBLE viewport
// (--app-height: 100dvh with a 100vh fallback, src/index.css) minus the
// status-bar/notch inset at the top and, at the bottom, whichever is taller
// of the home-indicator inset or the on-screen keyboard. It is max(), not a
// sum: the keyboard already pads itself by the home-indicator inset
// (TouchKeyboard.tsx), so adding both would count that inset twice.
// `top` centres the box inside exactly that area.
//
// scroll-padding: the action rows in these dialogs are `sticky bottom-0`
// (~5.5rem tall, and pinned ~1.5rem above the box's bottom edge by the
// box's own p-6 -- measured 89px + 24px = 113px in Chromium, hence 7.5rem).
// Reserving that much at the bottom of the scrollport means
// any scrollIntoView (a field gaining focus, or TouchKeyboard's
// keep-the-focused-field-visible nudge) stops ABOVE the pinned
// "Complete sale"/"Send link" row instead of parking the field behind it.
const DIALOG_BOTTOM_OBSTRUCTION = "max(var(--safe-area-bottom, 0px), var(--touch-keyboard-height, 0px))";
function keyboardAwareContentStyle(): React.CSSProperties {
  return {
    top: `calc(50% + (var(--safe-area-top, 0px) - ${DIALOG_BOTTOM_OBSTRUCTION}) / 2)`,
    maxHeight: `calc(var(--app-height, 100vh) - 2rem - var(--safe-area-top, 0px) - ${DIALOG_BOTTOM_OBSTRUCTION})`,
    overflowY: "auto",
    overscrollBehavior: "contain",
    scrollPaddingTop: "1rem",
    // Overridden to ~0 in index.css where those rows stop being sticky.
    scrollPaddingBottom: "var(--dialog-scroll-padding-bottom, 7.5rem)",
  };
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, style, onPointerDownOutside, onInteractOutside, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onPointerDownOutside={(e) => {
        if (isTouchKeyboardTarget(e.target)) {
          e.preventDefault();
          return;
        }
        onPointerDownOutside?.(e);
      }}
      onInteractOutside={(e) => {
        if (isTouchKeyboardTarget(e.target)) {
          e.preventDefault();
          return;
        }
        onInteractOutside?.(e);
      }}
      className={cn(
        "fixed left-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className,
      )}
      style={{ ...keyboardAwareContentStyle(), ...style }}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
