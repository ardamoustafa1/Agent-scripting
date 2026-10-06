import { useId } from 'react';

export interface SelectOption<V extends string> {
  value: V;
  label: string;
}

export interface SelectFieldProps<V extends string> {
  label: string;
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
}

/** Native select with a programmatic label: keyboard and screen-reader friendly by default. */
export function SelectField<V extends string>({
  label,
  value,
  options,
  onChange,
}: SelectFieldProps<V>) {
  const id = useId();
  return (
    <span className="vb-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="vb-select"
        value={value}
        onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) onChange(next.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
