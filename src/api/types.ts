export interface OuraSleepDay {
  id: string;
  day: string;
  score: number | null;
  contributors: {
    deep_sleep: number | null;
    efficiency: number | null;
    latency: number | null;
    rem_sleep: number | null;
    restfulness: number | null;
    timing: number | null;
    total_sleep: number | null;
  };
  timestamp: string;
}

export interface OuraReadinessDay {
  id: string;
  day: string;
  score: number | null;
  contributors: Record<string, number | null>;
  temperature_deviation: number | null;
  temperature_trend_deviation: number | null;
  timestamp: string;
}

export interface OuraActivityDay {
  id: string;
  day: string;
  score: number | null;
  active_calories: number | null;
  steps: number | null;
  equivalent_walking_distance: number | null;
  high_activity_time: number | null;
  medium_activity_time: number | null;
  low_activity_time: number | null;
  sedentary_time: number | null;
  total_calories: number | null;
  target_calories: number | null;
  contributors: Record<string, number | null>;
  timestamp: string;
}

export interface OuraHeartRate {
  bpm: number;
  source: string;
  timestamp: string;
}

export interface OuraSpO2Day {
  id: string;
  day: string;
  spo2_percentage: { average: number | null } | null;
  breathing_disturbance_index: number | null;
}

export interface OuraStressDay {
  id: string;
  day: string;
  day_summary?: string | null;
  recovery_high: number | null;
  stress_high: number | null;
}

export interface OuraCardiovascularAge {
  id: string;
  day: string;
  vascular_age: number | null;
}

export interface OuraWorkout {
  id: string;
  day: string;
  activity: string;
  calories: number | null;
  distance: number | null;
  start_datetime: string;
  end_datetime: string;
  intensity: string;
  label?: string | null;
  source: string;
}

export interface OuraSleepModel {
  id: string;
  day: string;
  average_breath: number | null;
  average_heart_rate: number | null;
  average_hrv: number | null;
  awake_time: number | null;
  bedtime_end: string;
  bedtime_start: string;
  deep_sleep_duration: number | null;
  efficiency: number | null;
  latency: number | null;
  light_sleep_duration: number | null;
  lowest_heart_rate: number | null;
  period: number | null;
  rem_sleep_duration: number | null;
  restless_periods: number | null;
  time_in_bed: number | null;
  total_sleep_duration: number | null;
  type?: string | null;
}

export type OuraEndpoint =
  | 'daily_sleep'
  | 'daily_readiness'
  | 'daily_activity'
  | 'heartrate'
  | 'daily_spo2'
  | 'daily_stress'
  | 'daily_cardiovascular_age'
  | 'workout'
  | 'sleep'
  | 'daily_resilience'
  | 'vO2_max'
  | 'sleep_time'
  | 'session'
  | 'rest_mode_period'
  | 'enhanced_tag'
  | 'ring_configuration'
  | 'ring_battery_level';

// Shapes below follow openapi-1.37; every field the spec does not mark required is nullable (#23).

export interface OuraResilienceDay {
  id: string;
  day: string;
  level: string | null;
  contributors: { sleep_recovery: number | null; daytime_recovery: number | null; stress: number | null } | null;
}

export interface OuraVo2Max {
  id: string;
  day: string;
  timestamp: string;
  vo2_max: number | null;
}

export interface OuraSleepTime {
  id: string;
  day: string;
  optimal_bedtime: { day_tz: number | null; start_offset: number | null; end_offset: number | null } | null;
  recommendation: string | null;
  status: string | null;
}

export interface OuraSession {
  id: string;
  day: string;
  start_datetime: string;
  end_datetime: string;
  type: string | null;
  mood: string | null;
  heart_rate: unknown;
  heart_rate_variability: unknown;
  motion_count: unknown;
}

export interface OuraRestModePeriod {
  id: string;
  start_day: string;
  end_day: string | null;
  start_time: string | null;
  end_time: string | null;
  episodes: unknown[] | null;
}

export interface OuraEnhancedTag {
  id: string;
  start_day: string;
  end_day: string | null;
  start_time: string | null;
  end_time: string | null;
  tag_type_code: string | null;
  comment: string | null;
  custom_name: string | null;
}

export interface OuraRingConfiguration {
  id: string;
  color: string | null;
  design: string | null;
  firmware_version: string | null;
  hardware_type: string | null;
  set_up_at: string | null;
  size: number | null;
}

export interface OuraRingBatteryLevel {
  timestamp: string; // timestamp_unix in the spec is the same instant and is not kept
  level: number | null;
  charging: boolean | null;
  in_charger: boolean | null;
}
