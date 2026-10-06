import type { RendererProps } from '@verbis/core-runtime';

import { ActionComponent } from './actions.js';
import { DataComponent } from './data.js';
import { InputComponent, SecureInput } from './inputs.js';
import { LayoutComponent } from './layout.js';
import { MediaComponent, Signature as SignatureRenderer } from './media.js';
import { ScriptContent } from './script-text.js';

export function ScriptText(props: RendererProps) {
  return <ScriptContent {...props} node={{ ...props.node, type: 'scriptText' }} />;
}
export function Callout(props: RendererProps) {
  return <ScriptContent {...props} node={{ ...props.node, type: 'callout' }} />;
}
export function ObjectionHandler(props: RendererProps) {
  return <ScriptContent {...props} node={{ ...props.node, type: 'objectionHandler' }} />;
}
export function Checklist(props: RendererProps) {
  return <ScriptContent {...props} node={{ ...props.node, type: 'checklist' }} />;
}
export function KnowledgeLink(props: RendererProps) {
  return <ScriptContent {...props} node={{ ...props.node, type: 'knowledgeLink' }} />;
}
export function Text(props: RendererProps) {
  return <ScriptContent {...props} node={{ ...props.node, type: 'text' }} />;
}
export function Heading(props: RendererProps) {
  return <ScriptContent {...props} node={{ ...props.node, type: 'heading' }} />;
}
export function RichContent(props: RendererProps) {
  return <ScriptContent {...props} node={{ ...props.node, type: 'richContent' }} />;
}
export function Alert(props: RendererProps) {
  return <ScriptContent {...props} node={{ ...props.node, type: 'alert' }} />;
}
export function TextInput(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'textInput' }} />;
}
export function TextArea(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'textArea' }} />;
}
export function NumberInput(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'numberInput' }} />;
}
export function CurrencyInput(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'currencyInput' }} />;
}
export function Select(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'select' }} />;
}
export function MultiSelect(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'multiSelect' }} />;
}
export function RadioGroup(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'radioGroup' }} />;
}
export function CheckboxGroup(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'checkboxGroup' }} />;
}
export function Checkbox(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'checkbox' }} />;
}
export function Toggle(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'toggle' }} />;
}
export function DatePicker(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'datePicker' }} />;
}
export function TimePicker(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'timePicker' }} />;
}
export function Rating(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'rating' }} />;
}
export function Slider(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'slider' }} />;
}
export function PhoneInput(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'phoneInput' }} />;
}
export function EmailInput(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'emailInput' }} />;
}
export function MaskedInput(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'maskedInput' }} />;
}
export function AddressInput(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'addressInput' }} />;
}
export function TCKNInput(props: RendererProps) {
  return <SecureInput {...props} node={{ ...props.node, type: 'tcknInput' }} />;
}
export function VKNInput(props: RendererProps) {
  return <SecureInput {...props} node={{ ...props.node, type: 'vknInput' }} />;
}
export function IBANInput(props: RendererProps) {
  return <SecureInput {...props} node={{ ...props.node, type: 'ibanInput' }} />;
}
export function CreditCardInput(props: RendererProps) {
  return <SecureInput {...props} node={{ ...props.node, type: 'creditCardInput' }} />;
}
export function Section(props: RendererProps) {
  return <LayoutComponent {...props} node={{ ...props.node, type: 'section' }} />;
}
export function Card(props: RendererProps) {
  return <LayoutComponent {...props} node={{ ...props.node, type: 'card' }} />;
}
export function Columns(props: RendererProps) {
  return <LayoutComponent {...props} node={{ ...props.node, type: 'columns' }} />;
}
export function Tabs(props: RendererProps) {
  return <LayoutComponent {...props} node={{ ...props.node, type: 'tabs' }} />;
}
export function Accordion(props: RendererProps) {
  return <LayoutComponent {...props} node={{ ...props.node, type: 'accordion' }} />;
}
export function Stepper(props: RendererProps) {
  return <LayoutComponent {...props} node={{ ...props.node, type: 'stepper' }} />;
}
export function Wizard(props: RendererProps) {
  return <LayoutComponent {...props} node={{ ...props.node, type: 'wizard' }} />;
}
export function Modal(props: RendererProps) {
  return <LayoutComponent {...props} node={{ ...props.node, type: 'modal' }} />;
}
export function Divider(props: RendererProps) {
  return <LayoutComponent {...props} node={{ ...props.node, type: 'divider' }} />;
}
export function Spacer(props: RendererProps) {
  return <LayoutComponent {...props} node={{ ...props.node, type: 'spacer' }} />;
}
export function Repeater(props: RendererProps) {
  return <LayoutComponent {...props} node={{ ...props.node, type: 'repeater' }} />;
}
export function Lookup(props: RendererProps) {
  return <DataComponent {...props} node={{ ...props.node, type: 'lookup' }} />;
}
export function AutoComplete(props: RendererProps) {
  return <DataComponent {...props} node={{ ...props.node, type: 'autoComplete' }} />;
}
export function DataGrid(props: RendererProps) {
  return <DataComponent {...props} node={{ ...props.node, type: 'dataGrid' }} />;
}
export function KeyValueList(props: RendererProps) {
  return <DataComponent {...props} node={{ ...props.node, type: 'keyValueList' }} />;
}
export function CustomerCard(props: RendererProps) {
  return <DataComponent {...props} node={{ ...props.node, type: 'customerCard' }} />;
}
export function Timeline(props: RendererProps) {
  return <DataComponent {...props} node={{ ...props.node, type: 'timeline' }} />;
}
export function Chart(props: RendererProps) {
  return <DataComponent {...props} node={{ ...props.node, type: 'chart' }} />;
}
export function Table(props: RendererProps) {
  return <DataComponent {...props} node={{ ...props.node, type: 'table' }} />;
}
export function ActionButton(props: RendererProps) {
  return <ActionComponent {...props} node={{ ...props.node, type: 'actionButton' }} />;
}
export function NextButton(props: RendererProps) {
  return <ActionComponent {...props} node={{ ...props.node, type: 'nextButton' }} />;
}
export function BackButton(props: RendererProps) {
  return <ActionComponent {...props} node={{ ...props.node, type: 'backButton' }} />;
}
export function ButtonGroup(props: RendererProps) {
  return <ActionComponent {...props} node={{ ...props.node, type: 'buttonGroup' }} />;
}
export function DispositionPicker(props: RendererProps) {
  return <ActionComponent {...props} node={{ ...props.node, type: 'dispositionPicker' }} />;
}
export function OutcomeSubmit(props: RendererProps) {
  return <ActionComponent {...props} node={{ ...props.node, type: 'outcomeSubmit' }} />;
}
export function TransferHint(props: RendererProps) {
  return <ActionComponent {...props} node={{ ...props.node, type: 'transferHint' }} />;
}
export function CallbackScheduler(props: RendererProps) {
  return <ActionComponent {...props} node={{ ...props.node, type: 'callbackScheduler' }} />;
}
export function Image(props: RendererProps) {
  return <MediaComponent {...props} node={{ ...props.node, type: 'image' }} />;
}
export function Video(props: RendererProps) {
  return <MediaComponent {...props} node={{ ...props.node, type: 'video' }} />;
}
export function Iframe(props: RendererProps) {
  return <MediaComponent {...props} node={{ ...props.node, type: 'iframe' }} />;
}
export function Timer(props: RendererProps) {
  return <MediaComponent {...props} node={{ ...props.node, type: 'timer' }} />;
}
export function Countdown(props: RendererProps) {
  return <MediaComponent {...props} node={{ ...props.node, type: 'countdown' }} />;
}
export function Note(props: RendererProps) {
  return <InputComponent {...props} node={{ ...props.node, type: 'note' }} />;
}
export function Badge(props: RendererProps) {
  return <MediaComponent {...props} node={{ ...props.node, type: 'badge' }} />;
}
export function ProgressIndicator(props: RendererProps) {
  return <MediaComponent {...props} node={{ ...props.node, type: 'progressIndicator' }} />;
}
export function Signature(props: RendererProps) {
  return <SignatureRenderer {...props} node={{ ...props.node, type: 'signature' }} />;
}
