import { z } from 'zod';

import { IdentifierSchema, NodeIdSchema } from '../ids.js';

import { ConditionSchema, I18nKeySchema, ToneTokenSchema, ValueSchema } from './primitives.js';

/** Tenant-defined outcome/disposition codes (DOMAIN Outcome). */
export const OutcomeCodeSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, 'Expected an outcome code like "SALE_OK"');

/** Analytics/log event names: dotted camelCase, e.g. `offer.accepted`. */
export const EventNameSchema = z
  .string()
  .max(128)
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/, 'Expected a dotted event name');

/** Platform attribute names written back via the connector. */
export const PlatformAttributeSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/, 'Expected a platform attribute name');

const ValueMapSchema = z.record(IdentifierSchema, ValueSchema);

const actionList = (): z.ZodArray<typeof ActionSchema> => z.array(ActionSchema);

export const SetVariableActionSchema = z.strictObject({
  type: z.literal('setVariable'),
  variable: IdentifierSchema,
  value: ValueSchema,
});

export const CallDataSourceActionSchema = z.strictObject({
  type: z.literal('callDataSource'),
  dataSource: IdentifierSchema,
  /** Per-call input overrides on top of the data source's default input mapping. */
  inputs: ValueMapSchema.optional(),
  get onSuccess() {
    return actionList().optional();
  },
  get onError() {
    return actionList().optional();
  },
});

export const NavigateActionSchema = z.strictObject({
  type: z.literal('navigate'),
  page: NodeIdSchema,
});

export const NextActionSchema = z.strictObject({ type: z.literal('next') });
export const BackActionSchema = z.strictObject({ type: z.literal('back') });

export const ShowToastActionSchema = z.strictObject({
  type: z.literal('showToast'),
  messageKey: I18nKeySchema,
  tone: ToneTokenSchema.default('info'),
  params: ValueMapSchema.optional(),
});

export const OpenModalActionSchema = z.strictObject({
  type: z.literal('openModal'),
  /** The page rendered inside the modal dialog. */
  page: NodeIdSchema,
});

export const CloseModalActionSchema = z.strictObject({ type: z.literal('closeModal') });

export const ValidatePageActionSchema = z.strictObject({
  type: z.literal('validatePage'),
  /** Defaults to the current page. */
  page: NodeIdSchema.optional(),
  get onInvalid() {
    return actionList().optional();
  },
});

/**
 * `early` is an author-declared early exit (wrong party, failed verification, technical error,
 * refusal): it skips the mandatory-page check and only demands that values the agent DID enter
 * are valid (ADR-0047). Omission means a completing outcome and keeps the original behaviour.
 */
export const OutcomeCompletionSchema = z.enum(['complete', 'early']);
export const SubmitOutcomeActionSchema = z.strictObject({
  type: z.literal('submitOutcome'),
  outcome: OutcomeCodeSchema,
  notes: ValueSchema.optional(),
  completion: OutcomeCompletionSchema.optional(),
});

export const SetDispositionActionSchema = z.strictObject({
  type: z.literal('setDisposition'),
  code: OutcomeCodeSchema,
  subCode: OutcomeCodeSchema.optional(),
});

export const WriteBackToPlatformActionSchema = z.strictObject({
  type: z.literal('writeBackToPlatform'),
  attributes: z.record(PlatformAttributeSchema, ValueSchema),
});

export const TransferHintActionSchema = z.strictObject({
  type: z.literal('transferHint'),
  /** Queue or skill code; the agent (or platform policy) performs the actual transfer. */
  target: z.string().min(1).max(128),
  reasonKey: I18nKeySchema.optional(),
});

export const RunSubflowActionSchema = z.strictObject({
  type: z.literal('runSubflow'),
  flow: NodeIdSchema,
});

export const ConditionalActionSchema = z.strictObject({
  type: z.literal('conditional'),
  if: ConditionSchema,
  get then() {
    return actionList();
  },
  get else() {
    return actionList().optional();
  },
});

export const SequenceActionSchema = z.strictObject({
  type: z.literal('sequence'),
  get actions() {
    return actionList();
  },
});

export const ParallelActionSchema = z.strictObject({
  type: z.literal('parallel'),
  get actions() {
    return actionList();
  },
});

export const EmitEventActionSchema = z.strictObject({
  type: z.literal('emitEvent'),
  name: EventNameSchema,
  payload: ValueMapSchema.optional(),
});

export const StartTimerActionSchema = z.strictObject({
  type: z.literal('startTimer'),
  timer: NodeIdSchema,
});

export const StopTimerActionSchema = z.strictObject({
  type: z.literal('stopTimer'),
  timer: NodeIdSchema,
});

export const MaskFieldActionSchema = z.strictObject({
  type: z.literal('maskField'),
  node: NodeIdSchema,
  masked: z.boolean().default(true),
});

export const LogEventActionSchema = z.strictObject({
  type: z.literal('logEvent'),
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  event: EventNameSchema,
  data: ValueMapSchema.optional(),
});

export type ActionOptions = [
  typeof SetVariableActionSchema,
  typeof CallDataSourceActionSchema,
  typeof NavigateActionSchema,
  typeof NextActionSchema,
  typeof BackActionSchema,
  typeof ShowToastActionSchema,
  typeof OpenModalActionSchema,
  typeof CloseModalActionSchema,
  typeof ValidatePageActionSchema,
  typeof SubmitOutcomeActionSchema,
  typeof SetDispositionActionSchema,
  typeof WriteBackToPlatformActionSchema,
  typeof TransferHintActionSchema,
  typeof RunSubflowActionSchema,
  typeof ConditionalActionSchema,
  typeof SequenceActionSchema,
  typeof ParallelActionSchema,
  typeof EmitEventActionSchema,
  typeof StartTimerActionSchema,
  typeof StopTimerActionSchema,
  typeof MaskFieldActionSchema,
  typeof LogEventActionSchema,
];

/** Closed, typed action set (SCRIPT_MODEL §5, ADR-0010). */
export const ActionSchema: z.ZodDiscriminatedUnion<ActionOptions, 'type'> = z
  .discriminatedUnion('type', [
    SetVariableActionSchema,
    CallDataSourceActionSchema,
    NavigateActionSchema,
    NextActionSchema,
    BackActionSchema,
    ShowToastActionSchema,
    OpenModalActionSchema,
    CloseModalActionSchema,
    ValidatePageActionSchema,
    SubmitOutcomeActionSchema,
    SetDispositionActionSchema,
    WriteBackToPlatformActionSchema,
    TransferHintActionSchema,
    RunSubflowActionSchema,
    ConditionalActionSchema,
    SequenceActionSchema,
    ParallelActionSchema,
    EmitEventActionSchema,
    StartTimerActionSchema,
    StopTimerActionSchema,
    MaskFieldActionSchema,
    LogEventActionSchema,
  ])
  .meta({ id: 'Action' });

export type Action = z.infer<typeof ActionSchema>;
export type ActionInput = z.input<typeof ActionSchema>;
export type ActionType = Action['type'];
export type ActionOf<T extends ActionType> = Extract<Action, { type: T }>;

export const ACTION_TYPES = ActionSchema.options.map((option) => option.shape.type.value);
