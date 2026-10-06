import { Check, Minus } from 'lucide-react';
import {
  Checkbox as RadixCheckbox,
  RadioGroup,
  Switch as RadixSwitch,
  Slider as RadixSlider,
} from 'radix-ui';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from 'react';

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
}
function Field({
  id,
  label,
  hint,
  error,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="vb-form-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && (
        <span id={`${id}-hint`} className="vb-field-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} className="vb-field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
function describedBy(
  id: string,
  hint?: string,
  error?: string,
  existing?: string,
): string | undefined {
  return (
    [existing, hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') ||
    undefined
  );
}
export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, FieldProps {}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id: given, className = '', 'aria-describedby': described, ...props },
  ref,
) {
  const generated = useId();
  const id = given ?? generated;
  return (
    <Field
      id={id}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
    >
      <input
        {...props}
        id={id}
        ref={ref}
        className={`vb-input ${className}`}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy(id, hint, error, described)}
      />
    </Field>
  );
});
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldProps {}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, id: given, className = '', 'aria-describedby': described, ...props },
  ref,
) {
  const generated = useId();
  const id = given ?? generated;
  return (
    <Field
      id={id}
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(error === undefined ? {} : { error })}
    >
      <textarea
        {...props}
        ref={ref}
        id={id}
        className={`vb-input vb-textarea ${className}`}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy(id, hint, error, described)}
      />
    </Field>
  );
});
export interface CheckboxProps {
  label: string;
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean | 'indeterminate') => void;
  disabled?: boolean;
  name?: string;
}
export function Checkbox({ label, disabled = false, ...props }: CheckboxProps) {
  const id = useId();
  return (
    <div className="vb-choice">
      <RadixCheckbox.Root {...props} id={id} disabled={disabled} className="vb-checkbox">
        <RadixCheckbox.Indicator>
          {props.checked === 'indeterminate' ? <Minus size={14} /> : <Check size={14} />}
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}
export interface RadioProps {
  label: string;
  options: readonly ChoiceOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  name?: string;
}
export function Radio({ label, options, ...props }: RadioProps) {
  const id = useId();
  return (
    <div className="vb-form-field">
      <span id={id}>{label}</span>
      <RadioGroup.Root {...props} aria-labelledby={id} className="vb-radio-group">
        {options.map((option, index) => (
          <div className="vb-choice" key={option.value}>
            <RadioGroup.Item
              value={option.value}
              disabled={option.disabled === true || props.disabled === true}
              id={`${id}-${index}`}
              className="vb-radio"
            >
              <RadioGroup.Indicator className="vb-radio-dot" />
            </RadioGroup.Item>
            <label htmlFor={`${id}-${index}`}>{option.label}</label>
          </div>
        ))}
      </RadioGroup.Root>
    </div>
  );
}
export interface SwitchProps {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
}
export function Switch({ label, ...props }: SwitchProps) {
  const id = useId();
  return (
    <div className="vb-choice">
      <RadixSwitch.Root {...props} id={id} className="vb-switch">
        <RadixSwitch.Thumb className="vb-switch-thumb" />
      </RadixSwitch.Root>
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
export interface SliderProps {
  label: string;
  value: number[];
  onValueChange: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  thumbLabels?: readonly string[];
}
export function Slider({ label, thumbLabels, ...props }: SliderProps) {
  const id = useId();
  return (
    <div className="vb-form-field">
      <span id={id}>{label}</span>
      <RadixSlider.Root {...props} className="vb-slider" aria-labelledby={id}>
        <RadixSlider.Track className="vb-slider-track">
          <RadixSlider.Range className="vb-slider-range" />
        </RadixSlider.Track>
        {props.value.map((_, index) => (
          <RadixSlider.Thumb
            key={index}
            className="vb-slider-thumb"
            aria-label={
              thumbLabels?.[index] ?? (props.value.length > 1 ? `${label} ${index + 1}` : label)
            }
          />
        ))}
      </RadixSlider.Root>
    </div>
  );
}
export type TimePickerProps = Omit<InputProps, 'type'>;
export function TimePicker(props: TimePickerProps) {
  return <Input {...props} type="time" />;
}
