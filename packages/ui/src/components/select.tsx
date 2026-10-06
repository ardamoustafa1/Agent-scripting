import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePortalContainer } from '../provider.js';

import { type ChoiceOption } from './fields.js';

export interface SelectProps {
  label: string;
  options: readonly ChoiceOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  name?: string;
}
export function Select({ label, options, placeholder, disabled = false, ...props }: SelectProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const portal = usePortalContainer();
  const { t } = useTranslation();
  return (
    <div className="vb-form-field">
      <label htmlFor={id}>{label}</label>
      <RadixSelect.Root {...props} disabled={disabled} open={open} onOpenChange={setOpen}>
        <RadixSelect.Trigger id={id} className="vb-input vb-select-trigger">
          <RadixSelect.Value placeholder={placeholder ?? t('ui.select')} />
          <RadixSelect.Icon>
            <ChevronDown size={16} />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal {...(portal === null ? {} : { container: portal })}>
          <RadixSelect.Content
            className="vb-floating vb-select-content"
            position="popper"
            sideOffset={6}
          >
            <RadixSelect.ScrollUpButton className="vb-select-scroll">
              <ChevronUp size={16} />
            </RadixSelect.ScrollUpButton>
            <RadixSelect.Viewport>
              {options.map((option) => (
                <RadixSelect.Item
                  className="vb-menu-item"
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled === true}
                  onPointerDown={(event) => {
                    // Finish mouse selection before the opening pointer-up guard
                    // can cancel it and keep the focus trap over the next field.
                    // Touch and keyboard retain Radix's normal selection path.
                    if (event.pointerType === 'mouse' && event.button === 0 && !option.disabled) {
                      event.preventDefault();
                      props.onValueChange(option.value);
                      setOpen(false);
                    }
                  }}
                >
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator>
                    <Check size={14} />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
            <RadixSelect.ScrollDownButton className="vb-select-scroll">
              <ChevronDown size={16} />
            </RadixSelect.ScrollDownButton>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}
