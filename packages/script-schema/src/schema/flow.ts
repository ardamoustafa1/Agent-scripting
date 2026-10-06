import { z } from 'zod';

import { IdentifierSchema, NodeIdSchema } from '../ids.js';

import { OutcomeCodeSchema } from './actions.js';
import { ConditionSchema, I18nKeySchema, ValueSchema } from './primitives.js';

const flowNodeBase = {
  id: NodeIdSchema,
  labelKey: I18nKeySchema.optional(),
  /** Designer canvas position; ignored at runtime and excluded from checksums. */
  position: z.strictObject({ x: z.number(), y: z.number() }).optional(),
};

export const PageFlowNodeSchema = z.strictObject({
  ...flowNodeBase,
  type: z.literal('page'),
  page: NodeIdSchema,
});
export const DecisionFlowNodeSchema = z.strictObject({
  ...flowNodeBase,
  type: z.literal('decision'),
});
export const DataSourceFlowNodeSchema = z.strictObject({
  ...flowNodeBase,
  type: z.literal('dataSource'),
  dataSource: IdentifierSchema,
});
export const SetVariableFlowNodeSchema = z.strictObject({
  ...flowNodeBase,
  type: z.literal('setVariable'),
  variable: IdentifierSchema,
  value: ValueSchema,
});
export const SubflowFlowNodeSchema = z.strictObject({
  ...flowNodeBase,
  type: z.literal('subflow'),
  flow: NodeIdSchema,
});
export const EndFlowNodeSchema = z.strictObject({
  ...flowNodeBase,
  type: z.literal('end'),
  outcome: OutcomeCodeSchema.optional(),
  disposition: OutcomeCodeSchema.optional(),
});

export const StartFlowNodeSchema = z.strictObject({ ...flowNodeBase, type: z.literal('start') });
export const TransferFlowNodeSchema = z.strictObject({
  ...flowNodeBase,
  type: z.literal('transfer'),
  target: z.string().min(1).max(128),
  reasonKey: I18nKeySchema.optional(),
});

export const FlowNodeSchema = z
  .discriminatedUnion('type', [
    StartFlowNodeSchema,
    TransferFlowNodeSchema,
    PageFlowNodeSchema,
    DecisionFlowNodeSchema,
    DataSourceFlowNodeSchema,
    SetVariableFlowNodeSchema,
    SubflowFlowNodeSchema,
    EndFlowNodeSchema,
  ])
  .meta({ id: 'FlowNode' });
export type FlowNode = z.infer<typeof FlowNodeSchema>;
export type FlowNodeType = FlowNode['type'];

export const FlowEdgeSchema = z
  .strictObject({
    id: NodeIdSchema,
    from: NodeIdSchema,
    to: NodeIdSchema,
    /** Edge is taken when the condition holds; edges are evaluated in declaration order. */
    when: ConditionSchema.optional(),
    /** Outcome port of a `dataSource` node. */
    port: z.enum(['success', 'error']).optional(),
    /** Fallback edge when no conditional edge matches. */
    default: z.boolean().optional(),
    /** Marks an intentional loop edge; the runtime stops after this many traversals. */
    maxIterations: z.int().min(1).max(1_000).optional(),
  })
  .meta({ id: 'FlowEdge' });
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const FlowSchema = z
  .strictObject({
    id: NodeIdSchema,
    name: z.string().trim().min(1).max(120).optional(),
    start: NodeIdSchema,
    nodes: z.array(FlowNodeSchema).min(1),
    edges: z.array(FlowEdgeSchema).default([]),
    designer: z
      .strictObject({
        groups: z
          .array(
            z.strictObject({
              id: NodeIdSchema,
              label: z.string().max(120),
              nodes: z.array(NodeIdSchema),
            }),
          )
          .default([]),
        notes: z
          .array(
            z.strictObject({
              id: NodeIdSchema,
              text: z.string().max(2000),
              position: z.strictObject({ x: z.number(), y: z.number() }),
            }),
          )
          .default([]),
      })
      .optional(),
    limits: z.strictObject({ maxSteps: z.int().min(1).max(10_000).default(200) }).prefault({}),
  })
  .meta({ id: 'Flow' });
export type Flow = z.infer<typeof FlowSchema>;
export type FlowInput = z.input<typeof FlowSchema>;
