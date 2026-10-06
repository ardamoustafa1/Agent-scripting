import { Command } from 'cmdk';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover as RadixPopover } from 'radix-ui';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePortalContainer } from '../provider.js';

import { Checkbox, Input, type ChoiceOption } from './fields.js';

export interface ComboboxProps {
  label: string;
  options: readonly ChoiceOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}
export function Combobox({
  label,
  options,
  value,
  onValueChange,
  disabled = false,
}: ComboboxProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const portal = usePortalContainer();
  const { t } = useTranslation();
  const selected = options.find((option) => option.value === value);
  return (
    <div className="vb-form-field">
      <label id={`${id}-label`}>{label}</label>
      <RadixPopover.Root open={open} onOpenChange={setOpen}>
        <RadixPopover.Trigger
          className="vb-input vb-select-trigger"
          disabled={disabled}
          aria-labelledby={`${id}-label`}
        >
          <span>{selected?.label ?? t('ui.select')}</span>
          <ChevronsUpDown size={16} aria-hidden />
        </RadixPopover.Trigger>
        <RadixPopover.Portal {...(portal === null ? {} : { container: portal })}>
          <RadixPopover.Content
            className="vb-floating vb-combobox"
            sideOffset={6}
            aria-label={label}
          >
            <Command label={label}>
              <Command.Input
                className="vb-command-input"
                placeholder={t('ui.search')}
                aria-label={t('ui.search')}
              />
              <Command.List className="vb-command-list">
                <Command.Empty className="vb-command-empty">{t('ui.noResults')}</Command.Empty>
                {options.map((option) => (
                  <Command.Item
                    key={option.value}
                    value={option.value}
                    keywords={[option.label]}
                    disabled={option.disabled === true}
                    onSelect={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span>{option.label}</span>
                    {value === option.value && <Check size={16} aria-hidden />}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
    </div>
  );
}
export interface MultiSelectProps {
  label: string;
  options: readonly ChoiceOption[];
  value: readonly string[];
  onValueChange: (value: string[]) => void;
  disabled?: boolean;
}
export function MultiSelect({
  label,
  options,
  value,
  onValueChange,
  disabled = false,
}: MultiSelectProps) {
  const id = useId();
  const [search, setSearch] = useState('');
  const portal = usePortalContainer();
  const { t, i18n } = useTranslation();
  const visible = useMemo(
    () =>
      options.filter((option) =>
        option.label
          .toLocaleLowerCase(i18n.language)
          .includes(search.toLocaleLowerCase(i18n.language)),
      ),
    [search, options, i18n.language],
  );
  return (
    <div className="vb-form-field">
      <label id={id}>{label}</label>
      <RadixPopover.Root>
        <RadixPopover.Trigger
          disabled={disabled}
          aria-labelledby={id}
          className="vb-input vb-select-trigger"
        >
          <span>{value.length ? t('ui.selected', { count: value.length }) : t('ui.select')}</span>
          <ChevronsUpDown size={16} aria-hidden />
        </RadixPopover.Trigger>
        <RadixPopover.Portal {...(portal === null ? {} : { container: portal })}>
          <RadixPopover.Content
            className="vb-floating vb-multiselect"
            sideOffset={6}
            aria-label={label}
          >
            <Input
              label={t('ui.search')}
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
            <div className="vb-multiselect-options" role="group" aria-label={label}>
              {visible.map((option) => (
                <Checkbox
                  key={option.value}
                  label={option.label}
                  checked={value.includes(option.value)}
                  disabled={option.disabled === true}
                  onCheckedChange={(checked) => {
                    onValueChange(
                      checked
                        ? [...new Set([...value, option.value])]
                        : value.filter((item) => item !== option.value),
                    );
                  }}
                />
              ))}
              {!visible.length && <p role="status">{t('ui.noResults')}</p>}
            </div>
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </RadixPopover.Root>
    </div>
  );
}
