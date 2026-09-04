import type { CollectAccumulatorResult } from '../../application/production/collect-accumulator.ts';
import type { SimCompaniesBuildingDTO } from './building-dto.ts';
import { toSimCompaniesBuildingDTO } from './building-dto.ts';

/**
 * The original Forest Nursery modal reads only `resource` and `building` from
 * this legacy POST response. Keep this adapter narrow; accumulator state is
 * carried by the refreshed building's productionAccumulator object.
 */
export interface SimCompaniesCollectAccumulatorDTO {
  resource: {
    kind: number;
    quality: number;
    amount: number;
  };
  building: SimCompaniesBuildingDTO;
}

export function toSimCompaniesCollectAccumulatorDTO(
  result: CollectAccumulatorResult
): SimCompaniesCollectAccumulatorDTO {
  return {
    resource: result.resource,
    building: toSimCompaniesBuildingDTO(result.building)
  };
}
