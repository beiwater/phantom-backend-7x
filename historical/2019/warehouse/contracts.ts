/**
 * Historical 2019 SimCompanies Warehouse Contract Refresh Logic
 * Source: artifacts/archeology/golden-versions/2019-angular-django/reactjs.2ebf9ff0e2ef.early-react.js
 */

export const CONTRACT_REFRESH_COOLDOWN_SECONDS = 180;

export function shouldRefreshContractsIncoming(lastTimestampSec: number | null, nowSec = Date.now() / 1000): boolean {
  return !lastTimestampSec || lastTimestampSec < nowSec - CONTRACT_REFRESH_COOLDOWN_SECONDS;
}
