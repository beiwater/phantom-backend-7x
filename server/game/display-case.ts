import { db } from '../db/database.ts';
import { DomainError } from '../errors/domain-error.ts';
import { getResourceDef } from './constants.ts';
import { getNftAsset } from './collectibles.ts';
import { CANONICAL_ACHIEVEMENTS } from './achievement-definitions.ts';

// Issue #88: a display case slot can hold a production resource, a
// certificate, an achievement, or a collectible (NFT). item_kind records
// which, item_ref the achievement id / certificate id / nft asset id.
// Legacy rows default to 'resource' so pre-existing cases keep rendering.
const displayCaseCols = db.prepare('PRAGMA table_info(display_case)').all() as Array<{ name: string }>;
if (!displayCaseCols.some((c) => c.name === 'item_kind')) {
  db.exec("ALTER TABLE display_case ADD COLUMN item_kind TEXT NOT NULL DEFAULT 'resource'");
}
if (!displayCaseCols.some((c) => c.name === 'item_ref')) {
  db.exec('ALTER TABLE display_case ADD COLUMN item_ref TEXT');
}

export interface DisplayCaseRow {
  id: number;
  company_id: number;
  slot: number;
  resource_kind: number;
  quality: number;
  title: string;
  item_kind?: string;
  item_ref?: string | null;
}

export type DisplayItemKind = 'resource' | 'certificate' | 'achievement' | 'collectible';

export interface DisplayCasePlacement {
  slot: number;
  itemKind: DisplayItemKind;
  achievementId?: string;
  certificateId?: number;
  nftId?: number;
  resourceKind?: number;
  quality?: number;
  title?: string;
}

/** Hard slot bounds of the display case (decompiled spec: max 12 slots). */
export const DISPLAY_CASE_MIN_SLOT = 1;
export const DISPLAY_CASE_MAX_SLOT = 12;

export function isAchievementCollected(companyId: number, achievementId: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM company_achievements
    WHERE company_id = ? AND (achievement_id = ? OR LOWER(achievement_id) = LOWER(?))
  `).get(companyId, achievementId, achievementId);
  return row !== undefined;
}

/**
 * Issue #88: placing an item requires OWNING it.
 *   achievement  → must be in company_achievements (already claimed)
 *   certificate  → must be a certificates row awarded to this company
 *   collectible  → NFT asset whose current owner is this company (issue #100
 *                  collectibles domain: getNftAsset().currentOwnerId)
 * Violations fail closed with 400 ITEM_NOT_OWNED.
 */
function assertItemOwnership(companyId: number, placement: DisplayCasePlacement): void {
  if (placement.itemKind === 'achievement') {
    const achievementId = String(placement.achievementId ?? '');
    if (!achievementId) {
      throw new DomainError('achievement_id is required to display an achievement', 400, 'INVALID_ITEM');
    }
    if (!isAchievementCollected(companyId, achievementId)) {
      throw new DomainError('You do not own this achievement', 400, 'ITEM_NOT_OWNED');
    }
    return;
  }

  if (placement.itemKind === 'certificate') {
    const certificateId = Number(placement.certificateId);
    if (!Number.isSafeInteger(certificateId) || certificateId <= 0) {
      throw new DomainError('certificate_id is required to display a certificate', 400, 'INVALID_ITEM');
    }
    const owned = db.prepare('SELECT 1 FROM certificates WHERE id = ? AND company_id = ?')
      .get(certificateId, companyId);
    if (!owned) {
      throw new DomainError('You do not own this certificate', 400, 'ITEM_NOT_OWNED');
    }
    return;
  }

  if (placement.itemKind === 'collectible') {
    const nftId = Number(placement.nftId);
    if (!Number.isSafeInteger(nftId) || nftId <= 0) {
      throw new DomainError('nft_id is required to display a collectible', 400, 'INVALID_ITEM');
    }
    let asset: { currentOwnerId?: number | null } | null = null;
    try {
      asset = getNftAsset(nftId);
    } catch {
      asset = null;
    }
    if (!asset || Number(asset.currentOwnerId) !== companyId) {
      throw new DomainError('You do not own this collectible', 400, 'ITEM_NOT_OWNED');
    }
  }
}

export function getDisplayCase(companyId: number) {
  const rows = db.prepare(`
    SELECT * FROM display_case WHERE company_id = ? ORDER BY slot ASC
  `).all(companyId) as unknown as DisplayCaseRow[];

  return rows.map(r => {
    const itemKind = (r.item_kind || 'resource') as DisplayItemKind;
    if (itemKind === 'resource') {
      return {
        slot: r.slot,
        itemKind,
        resource: {
          kind: r.resource_kind,
          quality: r.quality,
          title: r.title
        }
      };
    }
    const item: Record<string, unknown> = {
      slot: r.slot,
      itemKind,
      title: r.title
    };
    if (itemKind === 'achievement') item.achievement = { id: r.item_ref, name: r.title };
    if (itemKind === 'certificate') item.certificate = { id: Number(r.item_ref), name: r.title };
    if (itemKind === 'collectible') item.collectible = { id: Number(r.item_ref), name: r.title };
    return item;
  });
}

export function updateDisplayCase(companyId: number, placement: DisplayCasePlacement) {
  const slot = Number(placement.slot);
  if (!Number.isSafeInteger(slot) || slot < DISPLAY_CASE_MIN_SLOT || slot > DISPLAY_CASE_MAX_SLOT) {
    throw new DomainError(
      `Display case slot must be between ${DISPLAY_CASE_MIN_SLOT} and ${DISPLAY_CASE_MAX_SLOT}`,
      400,
      'INVALID_SLOT'
    );
  }

  if (placement.itemKind === 'resource') {
    const resourceKind = Number(placement.resourceKind);
    const quality = Number(placement.quality ?? 0);
    if (!Number.isSafeInteger(resourceKind) || resourceKind <= 0 || !getResourceDef(resourceKind)) {
      throw new DomainError('Unknown resource kind', 400, 'INVALID_ITEM');
    }
    if (!Number.isSafeInteger(quality) || quality < 0 || quality > 12) {
      throw new DomainError('Resource quality must be between 0 and 12', 400, 'INVALID_ITEM');
    }
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM display_case WHERE company_id = ? AND slot = ?').run(companyId, slot);
      db.prepare(`
        INSERT INTO display_case (company_id, slot, resource_kind, quality, title, item_kind, item_ref)
        VALUES (?, ?, ?, ?, ?, 'resource', NULL)
      `).run(companyId, slot, resourceKind, quality, placement.title ?? '');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return getDisplayCase(companyId);
  }

  assertItemOwnership(companyId, placement);

  let itemRef: string;
  let title: string;
  if (placement.itemKind === 'achievement') {
    itemRef = String(placement.achievementId);
    const matched = CANONICAL_ACHIEVEMENTS.find(a => a.id === itemRef || a.aliases.includes(itemRef));
    title = placement.title ?? matched?.label ?? itemRef;
  } else if (placement.itemKind === 'certificate') {
    itemRef = String(Number(placement.certificateId));
    title = placement.title
      ?? (db.prepare('SELECT name FROM certificates WHERE id = ? AND company_id = ?')
        .get(Number(itemRef), companyId) as { name?: string } | undefined)?.name
      ?? `Certificate #${itemRef}`;
  } else {
    itemRef = String(Number(placement.nftId));
    title = placement.title ?? `Collectible #${itemRef}`;
  }

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM display_case WHERE company_id = ? AND slot = ?').run(companyId, slot);
    db.prepare(`
      INSERT INTO display_case (company_id, slot, resource_kind, quality, title, item_kind, item_ref)
      VALUES (?, ?, 0, 0, ?, ?, ?)
    `).run(companyId, slot, title, placement.itemKind, itemRef);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return getDisplayCase(companyId);
}

export function removeDisplayCaseSlot(companyId: number, slot: number) {
  db.prepare('DELETE FROM display_case WHERE company_id = ? AND slot = ?').run(companyId, slot);
  return getDisplayCase(companyId);
}
