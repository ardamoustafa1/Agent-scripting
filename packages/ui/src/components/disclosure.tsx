import { ChevronDown } from 'lucide-react';
import { Tabs as RadixTabs, Accordion as RadixAccordion, Toolbar as RadixToolbar } from 'radix-ui';
import { type ReactNode, type ComponentProps } from 'react';

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}
export interface TabsProps {
  label: string;
  items: readonly TabItem[];
  value?: string;
  onValueChange?: (value: string) => void;
}
export function Tabs({ label, items, ...props }: TabsProps) {
  return (
    <RadixTabs.Root {...props} defaultValue={items[0]?.value ?? ''} className="vb-tabs">
      <RadixTabs.List className="vb-tab-list" aria-label={label}>
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            disabled={item.disabled === true}
            className="vb-tab"
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value} className="vb-tab-content">
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
export interface AccordionProps {
  items: readonly { value: string; title: string; content: ReactNode; disabled?: boolean }[];
  defaultValue?: string[];
}
export function Accordion({ items, ...props }: AccordionProps) {
  return (
    <RadixAccordion.Root type="multiple" {...props} className="vb-accordion">
      {items.map((item) => (
        <RadixAccordion.Item
          key={item.value}
          value={item.value}
          disabled={item.disabled === true}
          className="vb-accordion-item"
        >
          <RadixAccordion.Header className="vb-accordion-heading">
            <RadixAccordion.Trigger className="vb-accordion-trigger">
              {item.title}
              <ChevronDown size={16} aria-hidden />
            </RadixAccordion.Trigger>
          </RadixAccordion.Header>
          <RadixAccordion.Content className="vb-accordion-content">
            <div>{item.content}</div>
          </RadixAccordion.Content>
        </RadixAccordion.Item>
      ))}
    </RadixAccordion.Root>
  );
}
export interface ToolbarProps {
  label: string;
  children: ReactNode;
}
export function Toolbar({ label, children }: ToolbarProps) {
  return (
    <RadixToolbar.Root className="vb-toolbar" aria-label={label}>
      {children}
    </RadixToolbar.Root>
  );
}
export const ToolbarButton = RadixToolbar.Button;
export const ToolbarLink = RadixToolbar.Link;
export function ToolbarSeparator(props: ComponentProps<typeof RadixToolbar.Separator>) {
  return <RadixToolbar.Separator orientation="vertical" {...props} />;
}
export const ToolbarToggleGroup = RadixToolbar.ToggleGroup;
export const ToolbarToggleItem = RadixToolbar.ToggleItem;
