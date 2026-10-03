import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";
import { Button } from "./button.tsx";

/**
 * The non-destructive modal: a form the user fills in and submits.
 *
 * ConfirmDialog is its sibling for "are you sure" — that one is an AlertDialog, which steals
 * focus to Cancel and refuses to close on an outside click. This one behaves like a form: focus
 * lands on the first field, Escape and the backdrop close it. Both get the same focus trap and
 * the same focus restore on close, because both come from Radix rather than a hand-rolled div.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogPanelProps {
  title: string;
  /** One line under the title saying what this form does. Shown, and used as the a11y description. */
  description: string;
  children: React.ReactNode;
  /** Buttons, right-aligned under a hairline. */
  footer?: React.ReactNode;
  className?: string;
}

export function DialogPanel({ title, description, children, footer, className }: DialogPanelProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="overlay-scrim fixed inset-0 z-50 bg-[var(--overlay-scrim)]" />
      <DialogPrimitive.Content
        className={cn(
          "overlay-panel fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-var(--space-8))] w-[min(34rem,calc(100vw-2rem))]",
          "-translate-x-1/2 -translate-y-1/2 flex-col",
          "rounded-[var(--overlay-radius)] border border-[var(--overlay-border)]",
          "bg-[var(--overlay-bg)] shadow-[var(--overlay-shadow)]",
          className,
        )}
      >
        <div className="flex items-start gap-4 px-6 pb-4 pt-6">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-lg font-semibold leading-tight text-fg">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-sm leading-normal text-fg-muted">
              {description}
            </DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close">
              <X aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
