import type { Migration } from './open.js';

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS daily_sleep (
    id TEXT PRIMARY KEY,
    day TEXT UNIQUE,
    score INTEGER,
    contributors TEXT,
    timestamp TEXT
);
CREATE TABLE IF NOT EXISTS daily_readiness (
    id TEXT PRIMARY KEY,
    day TEXT UNIQUE,
    score INTEGER,
    contributors TEXT,
    temperature_deviation REAL,
    temperature_trend_deviation REAL,
    timestamp TEXT
);
CREATE TABLE IF NOT EXISTS daily_activity (
    id TEXT PRIMARY KEY,
    day TEXT UNIQUE,
    score INTEGER,
    active_calories INTEGER,
    steps INTEGER,
    equivalent_walking_distance REAL,
    high_activity_time INTEGER,
    medium_activity_time INTEGER,
    low_activity_time INTEGER,
    sedentary_time INTEGER,
    total_calories INTEGER,
    target_calories INTEGER,
    contributors TEXT,
    timestamp TEXT
);
CREATE TABLE IF NOT EXISTS daily_spo2 (
    id TEXT PRIMARY KEY,
    day TEXT UNIQUE,
    spo2_average REAL,
    breathing_disturbance_index REAL
);
CREATE TABLE IF NOT EXISTS daily_stress (
    id TEXT PRIMARY KEY,
    day TEXT UNIQUE,
    day_summary TEXT,
    recovery_high INTEGER,
    stress_high INTEGER
);
CREATE TABLE IF NOT EXISTS heartrate (
    timestamp TEXT,
    bpm INTEGER,
    source TEXT,
    day TEXT
);
CREATE INDEX IF NOT EXISTS idx_heartrate_ts ON heartrate(timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS idx_heartrate_unique ON heartrate(timestamp, source);
CREATE INDEX IF NOT EXISTS idx_heartrate_day ON heartrate(day);
CREATE TABLE IF NOT EXISTS vo2max (
    id TEXT PRIMARY KEY,
    day TEXT UNIQUE,
    vo2_max REAL,
    timestamp TEXT
);
CREATE TABLE IF NOT EXISTS cardiovascular_age (
    id TEXT PRIMARY KEY,
    day TEXT UNIQUE,
    vascular_age INTEGER
);
CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY,
    day TEXT,
    activity TEXT,
    calories REAL,
    distance REAL,
    start_datetime TEXT,
    end_datetime TEXT,
    intensity TEXT,
    label TEXT,
    source TEXT
);
CREATE TABLE IF NOT EXISTS sleep_model (
    id TEXT PRIMARY KEY,
    day TEXT,
    average_breath REAL,
    average_heart_rate REAL,
    average_hrv REAL,
    awake_time INTEGER,
    bedtime_end TEXT,
    bedtime_start TEXT,
    deep_sleep_duration INTEGER,
    efficiency INTEGER,
    latency INTEGER,
    light_sleep_duration INTEGER,
    lowest_heart_rate INTEGER,
    period INTEGER,
    rem_sleep_duration INTEGER,
    restless_periods INTEGER,
    time_in_bed INTEGER,
    total_sleep_duration INTEGER,
    type TEXT
);
    `,
  },
  {
    version: 2,
    sql: `
CREATE VIEW IF NOT EXISTS v_weekly_sleep AS
    SELECT strftime('%Y-W%W', day) as week, ROUND(AVG(score),1) as avg_score, COUNT(*) as days
    FROM daily_sleep WHERE score IS NOT NULL GROUP BY week ORDER BY week DESC;

CREATE VIEW IF NOT EXISTS v_weekly_readiness AS
    SELECT strftime('%Y-W%W', day) as week, ROUND(AVG(score),1) as avg_score,
        ROUND(AVG(temperature_deviation),2) as avg_temp_dev, COUNT(*) as days
    FROM daily_readiness WHERE score IS NOT NULL GROUP BY week ORDER BY week DESC;

CREATE VIEW IF NOT EXISTS v_weekly_activity AS
    SELECT strftime('%Y-W%W', day) as week, ROUND(AVG(score),1) as avg_score,
        SUM(steps) as total_steps, SUM(active_calories) as total_active_cal, COUNT(*) as days
    FROM daily_activity WHERE score IS NOT NULL GROUP BY week ORDER BY week DESC;

CREATE VIEW IF NOT EXISTS v_sleep_detail AS
    SELECT day, ROUND(total_sleep_duration/3600.0,1) as sleep_hours,
        ROUND(deep_sleep_duration/3600.0,1) as deep_hours,
        ROUND(rem_sleep_duration/3600.0,1) as rem_hours,
        average_hrv, average_heart_rate as avg_hr, lowest_heart_rate as lowest_hr, efficiency
    FROM sleep_model ORDER BY day DESC;
    `,
  },
  {
    // 0.6.0: collections from openapi-1.37 (#44). `vo2max` already exists since version 1.
    version: 3,
    sql: `
CREATE TABLE IF NOT EXISTS daily_resilience (
    id TEXT PRIMARY KEY,
    day TEXT UNIQUE,
    level TEXT,
    sleep_recovery REAL,
    daytime_recovery REAL,
    stress REAL
);
CREATE TABLE IF NOT EXISTS sleep_time (
    id TEXT PRIMARY KEY,
    day TEXT UNIQUE,
    status TEXT,
    recommendation TEXT,
    bedtime_start_offset INTEGER,
    bedtime_end_offset INTEGER,
    day_tz INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    day TEXT,
    type TEXT,
    mood TEXT,
    start_datetime TEXT,
    end_datetime TEXT,
    heart_rate TEXT,
    heart_rate_variability TEXT,
    motion_count TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions(day);
CREATE TABLE IF NOT EXISTS rest_mode_periods (
    id TEXT PRIMARY KEY,
    day TEXT,
    end_day TEXT,
    start_time TEXT,
    end_time TEXT,
    episodes TEXT
);
CREATE INDEX IF NOT EXISTS idx_rest_mode_periods_day ON rest_mode_periods(day);
CREATE TABLE IF NOT EXISTS enhanced_tags (
    id TEXT PRIMARY KEY,
    day TEXT,
    end_day TEXT,
    start_time TEXT,
    end_time TEXT,
    tag_type_code TEXT,
    comment TEXT,
    custom_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_enhanced_tags_day ON enhanced_tags(day);
CREATE TABLE IF NOT EXISTS ring_configuration (
    id TEXT PRIMARY KEY,
    color TEXT,
    design TEXT,
    firmware_version TEXT,
    hardware_type TEXT,
    set_up_at TEXT,
    size INTEGER
);
CREATE TABLE IF NOT EXISTS ring_battery_level (
    timestamp TEXT,
    level INTEGER,
    charging INTEGER,
    in_charger INTEGER,
    day TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ring_battery_level_unique ON ring_battery_level(timestamp);
CREATE INDEX IF NOT EXISTS idx_ring_battery_level_day ON ring_battery_level(day);
    `,
  },
];
