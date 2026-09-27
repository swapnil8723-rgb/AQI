/**
 * Graded Response Action Plan (Delhi-NCR), curated by hand from CAQM orders.
 * https://caqm.nic.in → "GRAP" orders. Update `GRAP_STATUS` the day an order is
 * issued, and bump `checked` whenever you confirm nothing has changed.
 *
 * `stage: 0` means GRAP is not invoked. `null` means not yet curated, and the
 * GRAP section stays hidden rather than guessing.
 */

export interface GrapStatus {
  /** 0 = not invoked, 1–4 = stage in force. */
  stage: 0 | 1 | 2 | 3 | 4;
  /** Date the current stage took effect (YYYY-MM-DD, IST). */
  since: string;
  /** Link to the CAQM order. */
  orderUrl: string;
  /** Date someone last checked CAQM (YYYY-MM-DD). */
  checked: string;
}

export const GRAP_STATUS: GrapStatus | null = null;

export const GRAP_STAGES: Readonly<Record<1 | 2 | 3 | 4, { en: string; hi: string; aqi: string }>> = {
  1: { en: 'Stage I · Poor', hi: 'चरण I · खराब', aqi: '201–300' },
  2: { en: 'Stage II · Very Poor', hi: 'चरण II · बहुत खराब', aqi: '301–400' },
  3: { en: 'Stage III · Severe', hi: 'चरण III · गंभीर', aqi: '401–450' },
  4: { en: 'Stage IV · Severe+', hi: 'चरण IV · गंभीर+', aqi: '450+' },
};

export const CAQM_URL = 'https://caqm.nic.in/';
