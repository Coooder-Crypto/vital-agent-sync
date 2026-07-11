import { z } from "zod";

export const workoutSummarySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  started_at: z.string().min(1),
  duration_minutes: z.number().int().nonnegative(),
  active_energy_kcal: z.number().nullable().optional(),
  avg_heart_rate_bpm: z.number().nullable().optional()
});

export const dailyHealthSummarySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.string().min(1),
  steps: z.number().int().nonnegative().nullable().optional(),
  sleep_minutes: z.number().int().nonnegative().nullable().optional(),
  resting_heart_rate_bpm: z.number().nullable().optional(),
  avg_heart_rate_bpm: z.number().nullable().optional(),
  max_heart_rate_bpm: z.number().nullable().optional(),
  active_energy_kcal: z.number().nullable().optional(),
  basal_energy_kcal: z.number().nullable().optional(),
  distance_walking_running_m: z.number().nullable().optional(),
  distance_cycling_m: z.number().nullable().optional(),
  flights_climbed: z.number().int().nonnegative().nullable().optional(),
  exercise_minutes: z.number().int().nonnegative().nullable().optional(),
  stand_minutes: z.number().int().nonnegative().nullable().optional(),
  heart_rate_variability_ms: z.number().nullable().optional(),
  walking_heart_rate_average_bpm: z.number().nullable().optional(),
  vo2_max_ml_kg_min: z.number().nullable().optional(),
  oxygen_saturation_percent: z.number().nullable().optional(),
  respiratory_rate_bpm: z.number().nullable().optional(),
  body_temperature_c: z.number().nullable().optional(),
  body_mass_kg: z.number().nullable().optional(),
  body_fat_percentage: z.number().nullable().optional(),
  lean_body_mass_kg: z.number().nullable().optional(),
  body_mass_index: z.number().nullable().optional(),
  workout_minutes: z.number().int().nonnegative().nullable().optional(),
  workouts: z.array(workoutSummarySchema).default([])
});

export const healthSyncPayloadSchema = z.object({
  device_id: z.string().min(1),
  sync_id: z.string().min(1),
  generated_at: z.string().min(1),
  timezone: z.string().min(1),
  health_daily_summaries: z.array(dailyHealthSummarySchema).default([])
});

export type WorkoutSummary = z.infer<typeof workoutSummarySchema>;
export type DailyHealthSummary = z.infer<typeof dailyHealthSummarySchema>;
export type HealthSyncPayload = z.infer<typeof healthSyncPayloadSchema>;
