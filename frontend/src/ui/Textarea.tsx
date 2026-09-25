import { TextareaHTMLAttributes, forwardRef } from 'react';
import { cn } from './cn';
import { controlBase, controlInvalid } from './Input';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/** Многострочное поле: те же рамка/фокус, что у Input; ресайз только по вертикали. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className, rows = 3, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, 'resize-y px-3 py-2 text-sm leading-snug', invalid && controlInvalid, className)}
      {...rest}
    />
  );
});

export default Textarea;
