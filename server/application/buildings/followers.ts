import { runInTransaction } from '../../db/transaction.ts';
import { buildingRepository } from '../../repositories/building-repository.ts';
import { socialRepository } from '../../repositories/social-repository.ts';

/** Building logistics links: a building may list other buildings of the same
 * company as "followers" (the official HQ logistics-link view). */
export function listFollowers(buildingId: number): Array<{ id: number; controllerId: number; followerId: number }> {
  return socialRepository.listBuildingFollowers(buildingId);
}

export async function addFollower(
  buildingId: number,
  followerBuildingId: number,
  companyId: number
): Promise<Array<{ id: number; controllerId: number; followerId: number }>> {
  if (!Number.isFinite(buildingId) || !Number.isFinite(followerBuildingId)) {
    throw new Error('follower id required');
  }
  if (buildingId === followerBuildingId) throw new Error('Cannot link a building to itself');
  if (!socialRepository.buildingsOwnedByCompany(buildingId, followerBuildingId, companyId)) {
    throw new Error('Buildings must belong to your company');
  }
  await runInTransaction(() => {
    socialRepository.linkBuildingFollower(buildingId, followerBuildingId);
  });
  return socialRepository.listCompanyBuildingFollowers(companyId);
}

export async function removeFollower(
  buildingId: number,
  followerBuildingId?: number | null,
  companyId?: number | null
): Promise<Array<{ id: number; controllerId: number; followerId: number }>> {
  if (companyId !== null && companyId !== undefined) {
    const building = buildingRepository.findById(buildingId);
    if (!building || building.companyId !== companyId) {
      throw new Error('Building must belong to your company');
    }
  }
  await runInTransaction(() => {
    if (followerBuildingId != null && Number.isFinite(followerBuildingId)) {
      socialRepository.unlinkBuildingFollower(buildingId, followerBuildingId);
    } else {
      socialRepository.unlinkFollower(buildingId);
    }
  });
  return companyId !== null && companyId !== undefined
    ? socialRepository.listCompanyBuildingFollowers(companyId)
    : listFollowers(buildingId);
}
