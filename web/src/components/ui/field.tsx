import * as React from "react";
import { cn } from "../../lib/utils.ts";

/**
 * Labelled form controls.
 *
 * ux-guidelines No. 54 / No. 43: every control has a visible `<label>` tied to it by id — a
 * placeholder is a hint, never a name. No. 55: help and error text are wired through
 * `aria-describedby` so a screen reader reads them with the field rather than after it.
 *
 * Native elements, styled with the field tokens. A native input is keyboard-reachable, works
 * with autofill and needs no dependency; there is nothing a custom one would buy here.
 */

const controlClass =
  "w-full rounded-[var(--field-radius)] border border-[var(--field-border)] bg-[var(--field-bg)] " +
  "px-[var(--field-pad-x)] py-[var(--field-pad-y)] text-sm text-[var(--field-fg)] " +
  "placeholder:text-[var(--field-placeholder)] " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export interface FieldProps {
  label: string;
  /** Rendered under the control, and read with it. Use for the sentence that explains a choice. */
  help?: React.ReactNode;
  /** When set, the field is marked invalid and this replaces nothing — it joins the help text. */
  error?: string | null;
  /** Receives the id to put on the control, plus the ids to list in `aria-describedby`. */
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => React.ReactNode;
  className?: string;
}

export function Field({ label, help, error, children, className }: FieldProps) {
  const id = React.useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs font-medium text-[var(--field-label-fg)]">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {help && (
        <p id={helpId} className="text-xs leading-normal text-[var(--field-help-fg)]">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs leading-normal text-[var(--field-error-fg)]">
          {error}
        </p>
      )}
    </div>
  );
}

export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(controlClass, "h-[var(--button-height-md)]", className)} {...props} />;
  },
);

export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(controlClass, "resize-y leading-normal", className)} {...props} />;
  },
);

export interface RadioCardProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  /** The consequence of picking this option, in the user's terms. */
  description: React.ReactNode;
}

/**
 * A radio with its consequence attached. Used where the two options differ in risk rather than
 * in value, so the description has to sit with the choice and not in a footnote.
 */
export const RadioCard = React.forwardRef<HTMLInputElement, RadioCardProps>(function RadioCard(
  { label, description, className, ...props },
  ref,
) {
  const id = React.useId();
  return (
    <div
      className={cn(
        "flex gap-2 rounded-[var(--field-radius)] border border-[var(--field-border)] p-3",
        "has-[:checked]:border-[var(--choice-border-selected)] has-[:checked]:bg-[var(--choice-bg-selected)]",
        className,
      )}
    >
      <input
        ref={ref}
        id={id}
        type="radio"
        className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent)]"
        {...props}
      />
      <label htmlFor={id} className="min-w-0 cursor-pointer select-none">
        <span className="block text-sm font-medium text-fg">{label}</span>
        <span className="mt-0.5 block text-xs leading-normal text-fg-muted">{description}</span>
      </label>
    </div>
  );
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(controlClass, "h-[var(--button-height-md)] cursor-pointer", className)}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  /** What this does, in plain words. Never a recommendation for the riskier setting. */
  help?: React.ReactNode;
  id?: string;
  disabled?: boolean;
}

/**
 * An on/off control. `role="switch"` on a native checkbox: Space toggles it, a screen reader
 * reads "on"/"off" rather than "checked", and there is no custom key handling to get wrong.
 *
 * `onCheckedChange` fires with the value the user asked for, not the value committed — which is
 * what lets a caller put a confirmation in front of turning one on.
 */
export function Switch({ checked, onCheckedChange, label, help, id, disabled }: SwitchProps) {
  const generated = React.useId();
  const inputId = id ?? generated;
  const helpId = help ? `${inputId}-help` : undefined;
  return (
    <div className="flex items-start gap-3">
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={helpId}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className={cn(
          "mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--color-accent)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="cursor-pointer text-sm font-medium text-[var(--field-label-fg)]">
          {label}
        </label>
        {help && (
          <p id={helpId} className="mt-0.5 text-xs leading-normal text-[var(--field-help-fg)]">
            {help}
          </p>
        )}
      </div>
    </div>
  );
}
