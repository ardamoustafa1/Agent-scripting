import { tr, enUS } from 'date-fns/locale';
import { CalendarDays } from 'lucide-react';
import { Popover as RadixPopover, Direction } from 'radix-ui';
import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { useTranslation } from 'react-i18next';

import { usePortalContainer } from '../provider.js';

export interface DatePickerProps {
  label: string;
  value?: Date;
  onValueChange: (date: Date | undefined) => void;
  disabled?: boolean;
  min?: Date;
  max?: Date;
}
export function DatePicker({
  label,
  value,
  onValueChange,
  disabled = false,
  min,
  max,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const { t, i18n } = useTranslation();
  const portal = usePortalContainer();
  const direction = Direction.useDirection();
  const locale = i18n.language.startsWith('tr') ? tr : enUS;
  const blocked = [
    ...(min === undefined ? [] : [{ before: min }]),
    ...(max === undefined ? [] : [{ after: max }]),
  ];
  return (
    <div className="vb-form-field">
      <span>{label}</span>
      <RadixPopover.Root open={open} onOpenChange={setOpen}>
        <RadixPopover.Trigger
          disabled={disabled}
          className="vb-input vb-select-trigger"
          aria-label={label}
        >
          <span>
            {value
              ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(value)
              : t('ui.calendar')}
          </span>
          <CalendarDays size={16} aria-hidden />
        </RadixPopover.Trigger>
        <RadixPopover.Portal {...(portal === null ? {} : { container: portal })}>
          <RadixPopover.Content
            className="vb-floating vb-calendar"
            sideOffset={8}
            aria-label={label}
          >
            <DayPicker
              dir={direction}
              mode="single"
              selected={value}
              locale={locale}
              disabled={blocked}
              onSelect={(date) => {
                onValueChange(date);
                setOpen(false);
              }}
              labels={{
                labelNext: () => t('ui.nextMonth'),
                labelPrevious: () => t('ui.previousMonth'),
              }}
            />
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
    </div>
  );
}
