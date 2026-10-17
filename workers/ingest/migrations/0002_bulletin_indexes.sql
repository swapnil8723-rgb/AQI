-- Every bulletin read filtered on date, but the only index led with city_slug, so
-- each one scanned the whole 2015-on archive (~99k rows). Four such reads per
-- hourly run used ~8M D1 rows_read a day, over the Free plan's 5M.

-- bulletin_count, bulletins_all, day_bulletin (date = / date range, any city).
CREATE INDEX IF NOT EXISTS bulletin_by_date ON bulletin (date);
-- bulletins: launch cities over a date range.
CREATE INDEX IF NOT EXISTS bulletin_slug_by_date ON bulletin (date) WHERE city_slug IS NOT NULL;
-- accuracy: only the days we have our own estimate for. The query names it with
-- INDEXED BY: left to itself the planner prefers bulletin_by_slug, which reads
-- every launch-city row back to 2015.
CREATE INDEX IF NOT EXISTS bulletin_ours ON bulletin (date, aqi, ours, city_slug)
  WHERE city_slug IS NOT NULL AND ours IS NOT NULL;
