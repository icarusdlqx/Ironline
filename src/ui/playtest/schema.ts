import { z } from 'zod';

export const PLAYTEST_STORAGE_KEY = 'ironline.playtest.v1';
export const PLAYTEST_EXPORT_SCHEMA = 'ironline.playtest/v1';
export const MAX_PLAYTEST_EVENTS = 32;
export const MAX_PLAYTEST_BYTES = 16 * 1024;
export const MAX_PLAYTEST_SECONDS = 10 * 60;

const RatingSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export type Rating = z.infer<typeof RatingSchema>;

export const RouteChoiceSchema = z.enum(['learn', 'campaign', 'skirmish']);
export type RouteChoice = z.infer<typeof RouteChoiceSchema>;

export const TrainingOutcomeSchema = z.enum(['success', 'failure']);
export type TrainingOutcome = z.infer<typeof TrainingOutcomeSchema>;

export const PerformanceReadSchema = z.enum([
  'smooth',
  'minor_stutter',
  'frequent_stutter',
  'unplayable',
]);
export type PerformanceRead = z.infer<typeof PerformanceReadSchema>;

export const ContinueIntentSchema = z.enum(['yes', 'maybe', 'no']);
export type ContinueIntent = z.infer<typeof ContinueIntentSchema>;

export const ConfusionAreaSchema = z.enum([
  'front_door',
  'briefing',
  'select',
  'move',
  'attack',
  'heat',
  'camera',
  'campaign',
  'mechbay',
]);
export type ConfusionArea = z.infer<typeof ConfusionAreaSchema>;

const EventStampSchema = z.strictObject({
  seq: z.number().int().nonnegative(),
  visit: z.number().int().min(1).max(999),
  elapsedSeconds: z.number().int().min(0).max(MAX_PLAYTEST_SECONDS).multipleOf(5),
});

const bareEvent = <Name extends string>(name: Name) =>
  EventStampSchema.extend({ name: z.literal(name) }).strict();

export const FirstRunEventSchema = z.discriminatedUnion('name', [
  bareEvent('front_door_viewed'),
  EventStampSchema.extend({
    name: z.literal('route_chosen'),
    route: RouteChoiceSchema,
  }).strict(),
  bareEvent('training_deployed'),
  bareEvent('training_selected'),
  bareEvent('training_moved'),
  bareEvent('training_engaged'),
  bareEvent('training_heat_seen'),
  EventStampSchema.extend({
    name: z.literal('training_finished'),
    outcome: TrainingOutcomeSchema,
  }).strict(),
  bareEvent('training_skipped'),
  bareEvent('campaign_opened'),
  bareEvent('contract_signed'),
  bareEvent('drop_prep_opened'),
  bareEvent('manifest_opened'),
  bareEvent('contract_launched'),
  bareEvent('feedback_opened'),
  bareEvent('report_downloaded'),
]);

export type FirstRunEvent = z.infer<typeof FirstRunEventSchema>;

export type FirstRunEventInput =
  | { name: 'front_door_viewed' }
  | { name: 'route_chosen'; route: RouteChoice }
  | { name: 'training_deployed' }
  | { name: 'training_selected' }
  | { name: 'training_moved' }
  | { name: 'training_engaged' }
  | { name: 'training_heat_seen' }
  | { name: 'training_finished'; outcome: TrainingOutcome }
  | { name: 'training_skipped' }
  | { name: 'campaign_opened' }
  | { name: 'contract_signed' }
  | { name: 'drop_prep_opened' }
  | { name: 'manifest_opened' }
  | { name: 'contract_launched' }
  | { name: 'feedback_opened' }
  | { name: 'report_downloaded' };

const confusionSchema = z
  .array(ConfusionAreaSchema)
  .max(ConfusionAreaSchema.options.length)
  .refine((areas) => new Set(areas).size === areas.length, 'confusion areas must be unique');

export const PlaytestSurveySchema = z.strictObject({
  clarity: RatingSchema.nullable(),
  combatReadability: RatingSchema.nullable(),
  performance: PerformanceReadSchema.nullable(),
  continueIntent: ContinueIntentSchema.nullable(),
  confusion: confusionSchema,
});

export type PlaytestSurvey = z.infer<typeof PlaytestSurveySchema>;
export type PlaytestSurveyPatch = Partial<PlaytestSurvey>;

export const EMPTY_PLAYTEST_SURVEY: PlaytestSurvey = {
  clarity: null,
  combatReadability: null,
  performance: null,
  continueIntent: null,
  confusion: [],
};

export const PlaytestReportSchema = z
  .strictObject({
    version: z.literal(1),
    visits: z.number().int().min(1).max(999),
    nextSequence: z.number().int().nonnegative(),
    truncated: z.boolean(),
    events: z.array(FirstRunEventSchema).max(MAX_PLAYTEST_EVENTS),
    survey: PlaytestSurveySchema,
  })
  .superRefine((report, context) => {
    let prior = -1;
    for (const [index, event] of report.events.entries()) {
      if (event.seq <= prior) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'seq'],
          message: 'event sequences must increase',
        });
      }
      if (event.visit > report.visits) {
        context.addIssue({
          code: 'custom',
          path: ['events', index, 'visit'],
          message: 'event visit exceeds report visits',
        });
      }
      prior = event.seq;
    }
    if (report.nextSequence <= prior) {
      context.addIssue({
        code: 'custom',
        path: ['nextSequence'],
        message: 'next sequence must follow every event',
      });
    }
  });

export type PlaytestReport = z.infer<typeof PlaytestReportSchema>;

export function emptyPlaytestReport(): PlaytestReport {
  return {
    version: 1,
    visits: 1,
    nextSequence: 0,
    truncated: false,
    events: [],
    survey: { ...EMPTY_PLAYTEST_SURVEY, confusion: [] },
  };
}

export function eventIdentity(event: FirstRunEventInput): string {
  if (event.name === 'training_finished') return `${event.name}:${event.outcome}`;
  return event.name;
}
