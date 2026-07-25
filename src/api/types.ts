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
  spo2_percentage: { average: number | null };
  breathing_disturbance_index: number | null;
}

export interface OuraStressDay {
  id: string;
  day: string;
  day_summary?: string | null;
  recovery_high: number | null;
  stress_high: number | null;
}

export interface OuraVo2Max {
  id: string;
  day: string;
  vo2_max: number | null;
  timestamp: string;
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
  | 'sleep';
