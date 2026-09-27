export const POLLUTANTS = ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3', 'nh3'] as const;
export type Pollutant = (typeof POLLUTANTS)[number];

export const NAQI_CATEGORIES = ['good', 'satisfactory', 'moderate', 'poor', 'verypoor', 'severe'] as const;
export type NaqiCategory = (typeof NAQI_CATEGORIES)[number];

export const US_CATEGORIES = ['good', 'moderate', 'usg', 'unhealthy', 'veryunhealthy', 'hazardous'] as const;
export type UsCategory = (typeof US_CATEGORIES)[number];

/** Colour slot shared by both scales: 1 = Good … 6 = Severe / Hazardous. 0 = no data. */
export type Slot = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const POLLUTANT_LABEL: Readonly<Record<Pollutant, string>> = {
  pm25: 'PM2.5',
  pm10: 'PM10',
  no2: 'NO₂',
  so2: 'SO₂',
  co: 'CO',
  o3: 'O₃',
  nh3: 'NH₃',
};

export const POLLUTANT_UNIT: Readonly<Record<Pollutant, string>> = {
  pm25: 'µg/m³',
  pm10: 'µg/m³',
  no2: 'µg/m³',
  so2: 'µg/m³',
  co: 'mg/m³',
  o3: 'µg/m³',
  nh3: 'µg/m³',
};

/** NAQI averaging period per pollutant, in hours. */
export const POLLUTANT_WINDOW: Readonly<Record<Pollutant, 8 | 24>> = {
  pm25: 24,
  pm10: 24,
  no2: 24,
  so2: 24,
  co: 8,
  o3: 8,
  nh3: 24,
};
