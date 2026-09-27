-- Saans D1 schema v1 (PLAN.md §3.4, adapted to what the feed actually is).
-- The data.gov.in feed publishes CPCB sub-indices, so station_hour stores the
-- sub-index per pollutant exactly as received; concentrations are derived.
-- Tables are WITHOUT ROWID so each insert is one write against D1's quota.

CREATE TABLE IF NOT EXISTS stations (
  id         TEXT PRIMARY KEY,          -- slug of CPCB's full name
  name       TEXT NOT NULL,             -- "Anand Vihar, Delhi - DPCC"
  city       TEXT NOT NULL,             -- feed city (CPCB's bulletin grouping)
  state      TEXT NOT NULL,
  city_slug  TEXT,                      -- launch city, if any
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  first_seen TEXT NOT NULL,             -- YYYY-MM-DD IST
  last_seen  TEXT NOT NULL              -- YYYY-MM-DD IST (updated once a day to save writes)
) WITHOUT ROWID;

-- One wide row per station per IST hour. `hour` is the start of the IST hour
-- of the station's own last_update, as ISO UTC ("…T10:30:00.000Z" = 16:00 IST).
CREATE TABLE IF NOT EXISTS station_hour (
  station_id TEXT NOT NULL,
  hour       TEXT NOT NULL,
  pm25 REAL, pm10 REAL, no2 REAL, so2 REAL, co REAL, o3 REAL, nh3 REAL,
  lo         TEXT,                      -- JSON: lowest hourly sub-index in 24 h, per pollutant
  hi         TEXT,                      -- JSON: highest hourly sub-index in 24 h
  flags      TEXT,                      -- "co:flat,pm25:spike" (flagged values are excluded from aqi)
  aqi        INTEGER,
  us         INTEGER,
  dominant   TEXT,
  valid      INTEGER NOT NULL,
  PRIMARY KEY (station_id, hour)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS station_hour_by_hour ON station_hour (hour);

-- Our live estimate per launch city per IST hour.
CREATE TABLE IF NOT EXISTS city_hour (
  city_slug TEXT NOT NULL,
  hour      TEXT NOT NULL,
  aqi       INTEGER NOT NULL,
  min       INTEGER NOT NULL,
  max       INTEGER NOT NULL,
  valid     INTEGER NOT NULL,
  total     INTEGER NOT NULL,
  dominant  TEXT,
  us        INTEGER,
  PRIMARY KEY (city_slug, hour)
) WITHOUT ROWID;

-- CPCB's 4 PM bulletin: every city it lists, back to 2015 (scripts/backfill-bulletins.ts).
CREATE TABLE IF NOT EXISTS bulletin (
  city_key  TEXT NOT NULL,              -- letters of the printed name, qualifier kept ("aurangabadmaharashtra")
  date      TEXT NOT NULL,              -- YYYY-MM-DD IST
  city      TEXT NOT NULL,              -- as printed
  city_slug TEXT,                       -- launch city, if any
  aqi       INTEGER NOT NULL,
  category  TEXT NOT NULL,
  prominent TEXT NOT NULL,              -- "PM10,CO"
  used      INTEGER NOT NULL,
  total     INTEGER,                    -- printed from 2023 on
  ours      INTEGER,                    -- our live estimate at 16:00 IST that day
  PRIMARY KEY (city_key, date)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS bulletin_by_slug ON bulletin (city_slug, date);

CREATE TABLE IF NOT EXISTS runs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  job      TEXT NOT NULL,
  started  TEXT NOT NULL,
  ms       INTEGER,
  ok       INTEGER NOT NULL,
  rows     INTEGER,
  stations INTEGER,
  message  TEXT
);
