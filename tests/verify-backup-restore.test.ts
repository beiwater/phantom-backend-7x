import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { BackupEngine } from '../server/db/backup.ts';

console.log('=== Verifying SQLite Backup & Disaster Recovery (Issue #148) ===');

const testBackupDir = path.join(process.cwd(), 'data', 'test-backups');
if (fs.existsSync(testBackupDir)) {
  fs.rmSync(testBackupDir, { recursive: true, force: true });
}

const engine = new BackupEngine(testBackupDir);

// [1/4] Test hot backup creation
console.log('[1/4] Creating hot backup using VACUUM INTO...');
const backup1 = engine.createBackup({ retentionCount: 5 });
assert.ok(fs.existsSync(backup1.filepath), 'Backup db file must exist');
assert.ok(fs.existsSync(`${backup1.filepath}.sha256`), 'Checksum file must exist');
assert.strictEqual(backup1.integrity, 'OK', 'Integrity must be OK');
assert.ok(backup1.sizeBytes > 0, 'Backup size must be > 0');
console.log(`  -> Created backup: ${backup1.filename} (${backup1.sizeBytes} bytes, SHA: ${backup1.sha256.substring(0, 16)}...)`);

// [2/4] Test backup listing and verification
console.log('[2/4] Verifying backup listing and SHA-256 check...');
const list = engine.listBackups();
assert.strictEqual(list.length, 1);
assert.strictEqual(list[0].filename, backup1.filename);

const verification = engine.verifyBackup(backup1.filepath);
assert.strictEqual(verification.valid, true);
assert.strictEqual(verification.checksumMatch, true);
assert.strictEqual(verification.quickCheck, 'ok');
console.log('  -> Verification confirmed valid.');

// [3/4] Test tampered file detection
console.log('[3/4] Testing detection of tampered/corrupted backup...');
const tamperedPath = path.join(testBackupDir, 'backup_tampered.db');
fs.copyFileSync(backup1.filepath, tamperedPath);
fs.writeFileSync(`${tamperedPath}.sha256`, `${backup1.sha256}  backup_tampered.db\n`);

// Tamper with content
const buf = fs.readFileSync(tamperedPath);
buf[100] = (buf[100] + 1) % 256;
fs.writeFileSync(tamperedPath, buf);

const tamperedResult = engine.verifyBackup(tamperedPath);
assert.strictEqual(tamperedResult.checksumMatch, false, 'Tampered file checksum MUST fail');
assert.strictEqual(tamperedResult.valid, false, 'Tampered backup MUST NOT be valid');
console.log('  -> Tampered backup correctly detected and rejected.');

// [4/4] Test retention rotation
console.log('[4/4] Testing automatic retention rotation...');
for (let i = 0; i < 4; i++) {
  // Small delay to ensure distinct filenames
  const target = path.join(testBackupDir, `backup_rot_${i}.db`);
  fs.copyFileSync(backup1.filepath, target);
  fs.writeFileSync(`${target}.sha256`, `${backup1.sha256}  backup_rot_${i}.db\n`);
}

const beforeRotate = engine.listBackups();
assert.strictEqual(beforeRotate.length >= 5, true);

const deleted = engine.rotateBackups(3);
const afterRotate = engine.listBackups();
assert.strictEqual(afterRotate.length, 3, 'Must retain exactly 3 backups');
console.log(`  -> Rotated old backups (deleted ${deleted} excess backups).`);

// Cleanup test dir
fs.rmSync(testBackupDir, { recursive: true, force: true });

console.log('================================================================');
console.log(' [OK] ISSUE #148 BACKUP & DISASTER RECOVERY PASSED ALL TESTS');
console.log('================================================================');
