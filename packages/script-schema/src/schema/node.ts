import { z } from 'zod';

import { IdentifierSchema, NodeIdSchema } from '../ids.js';

import { ActionSchema } from './actions.js';
import {
  ConditionSchema,
  ExpressionSchema,
  I18nKeySchema,
  JsonValueSchema,
  SpaceTokenSchema,
  ToneTokenSchema,
} from './primitives.js';

/**
 * Component type key: a core primitive (`box`, `button`, `webService`), a library component
 * (`textInput`) or a registered third-party component (`acme.creditGauge`).
 */
export const ComponentTypeSchema = z
  .string()
  .max(128)
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/, 'Expected a component type key');

/** Component prop names and event names. */
export const PropNameSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*$/, 'Expected a camelCase prop name');
export const EventKeySchema = z
  .string()
  .regex(/^on[A-Z][a-zA-Z0-9]*$/, 'Expected an event name like "onPress"');

const SizeSchema = z.enum([
  'auto',
  'full',
  'fit',
  '1/4',
  '1/3',
  '1/2',
  '2/3',
  '3/4',
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
]);

/**
 * Token-only style properties. No raw CSS: keeps themes consistent and closes the
 * CSS-injection surface (SECURITY, CLAUDE.md §9).
 */
export const StylePropsSchema = z
  .strictObject({
    display: z.enum(['flex', 'grid', 'block', 'none']).optional(),
    direction: z.enum(['row', 'column']).optional(),
    wrap: z.boolean().optional(),
    gap: SpaceTokenSchema.optional(),
    padding: SpaceTokenSchema.optional(),
    paddingInline: SpaceTokenSchema.optional(),
    paddingBlock: SpaceTokenSchema.optional(),
    margin: SpaceTokenSchema.optional(),
    width: SizeSchema.optional(),
    minWidth: SizeSchema.optional(),
    maxWidth: SizeSchema.optional(),
    columns: z.int().min(1).max(12).optional(),
    colSpan: z.int().min(1).max(12).optional(),
    grow: z.int().min(0).max(12).optional(),
    shrink: z.int().min(0).max(12).optional(),
    align: z.enum(['start', 'center', 'end', 'stretch', 'baseline']).optional(),
    justify: z.enum(['start', 'center', 'end', 'between', 'around', 'evenly']).optional(),
    textAlign: z.enum(['start', 'center', 'end']).optional(),
    tone: ToneTokenSchema.optional(),
    emphasis: z.enum(['low', 'normal', 'high']).optional(),
    scroll: z.boolean().optional(),
  })
  .meta({ id: 'StyleProps' });

export const BREAKPOINTS = ['base', 'sm', 'md', 'lg', 'xl'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

/** Mobile-first responsive style: `base` applies everywhere, larger breakpoints override. */
export const ResponsiveStyleSchema = z
  .strictObject({
    base: StylePropsSchema.optional(),
    sm: StylePropsSchema.optional(),
    md: StylePropsSchema.optional(),
    lg: StylePropsSchema.optional(),
    xl: StylePropsSchema.optional(),
  })
  .meta({ id: 'ResponsiveStyle' });
export type ResponsiveStyle = z.infer<typeof ResponsiveStyleSchema>;

/** One-way binding: the prop is recomputed from the expression. */
export const ExpressionBindingSchema = z.strictObject({
  prop: PropNameSchema,
  expression: ExpressionSchema,
});

/** Two-way binding: an input's prop reads from and writes to a variable. */
export const TwoWayBindingSchema = z.strictObject({
  prop: PropNameSchema.default('value'),
  variable: IdentifierSchema,
});

export const BindingSchema = z
  .union([ExpressionBindingSchema, TwoWayBindingSchema])
  .meta({ id: 'Binding' });
export type Binding = z.infer<typeof BindingSchema>;
export type ExpressionBinding = z.infer<typeof ExpressionBindingSchema>;
export type TwoWayBinding = z.infer<typeof TwoWayBindingSchema>;

export const A11ySchema = z.strictObject({
  labelKey: I18nKeySchema.optional(),
  descriptionKey: I18nKeySchema.optional(),
  /** e.g. `Alt+L`. */
  shortcut: z
    .string()
    .regex(
      /^((Ctrl|Alt|Shift|Meta)\+)*[A-Za-z0-9]$|^F([1-9]|1[0-2])$/,
      'Expected a shortcut like "Alt+L"',
    )
    .optional(),
});

const nodeBaseShape = {
  id: NodeIdSchema,
  type: ComponentTypeSchema,
  props: z.record(PropNameSchema, JsonValueSchema).default({}),
  style: ResponsiveStyleSchema.optional(),
  bindings: z.array(BindingSchema).default([]),
  events: z.record(EventKeySchema, z.array(ActionSchema)).default({}),
  visibleWhen: ConditionSchema.optional(),
  enabledWhen: ConditionSchema.optional(),
  requiredWhen: ConditionSchema.optional(),
  a11y: A11ySchema.optional(),
};

type NodeBaseShape = typeof nodeBaseShape;
type NodeShape = NodeBaseShape & {
  children: z.ZodOptional<z.ZodArray<NodeSchemaType>>;
};
type NodeSchemaType = z.ZodObject<NodeShape, z.core.$strict>;

/** A node in a page's layout tree (SCRIPT_MODEL §4). */
export const NodeSchema: NodeSchemaType = z
  .strictObject({
    ...nodeBaseShape,
    get children() {
      return z.array(NodeSchema).optional();
    },
  })
  .meta({ id: 'Node' });

export type Node = z.infer<typeof NodeSchema>;
export type NodeInput = z.input<typeof NodeSchema>;
