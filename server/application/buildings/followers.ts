import { runInTransaction } from '../../db/transaction.ts';
import { socialRepository } from '../../repositories/social-repository.ts';

/** Building logistics links: a building may list other buildings of the same
 * company as "followers" (the official HQ logistics-link view). */
export function listFollowers(buildingId: number): Array<{ id: number }> {
  return socialRepository.listBuildingFollowers(buildingId);
}

export function addFollower(buildingId: number, followerBuildingId: number, companyId: number): Array<{ id: number }> {
  if (!Number.isFinite(followerBuildingId)) throw new Error('follower id required');
  if (buildingId === followerBuildingId) throw new Error('Cannot link a building to itself');
  if (!socialRepository.buildingsOwnedByCompany(buildingId, followerBuildingId, companyId)) {
    throw new Error('Buildings must belong to your company');
  }
  runInTransaction(() => {
    socialRepository.linkBuildingFollower(buildingId, followerBuildingId);
  });
  return listFollowers(buildingId);
}

export function removeFollower(buildingId: number, followerBuildingId: number): Array<{ id: number }> {
  runInTransaction(() => {
    socialRepository.unlinkBuildingFollower(buildingId, followerBuildingId);
  });
  return listFollowers(buildingId);
}
