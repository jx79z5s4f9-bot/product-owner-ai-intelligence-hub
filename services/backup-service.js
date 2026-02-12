/**
 * Backup Service
 * Automated database backups using node-cron
 * 
 * Schedule: Daily at midnight
 * Location: ~/ProductOwnerAI/backups/
 * Retention: Last 7 backups
 */

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DB_PATH = path.join(__dirname, '..', 'database.db');
const BACKUP_DIR = path.join(os.homedir(), 'ProductOwnerAI', 'backups');
const MAX_BACKUPS = 7;  // Keep last 7 backups

class BackupService {
  constructor() {
    this.isRunning = false;
    this.lastBackup = null;
    this.schedule = '0 0 * * *';  // Daily at midnight
  }

  /**
   * Initialize backup service
   * @param {string} schedule - Cron schedule (default: daily at midnight)
   */
  init(schedule) {
    if (schedule) this.schedule = schedule;

    // Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      console.log(`[Backup] Created backup directory: ${BACKUP_DIR}`);
    }

    // Schedule automated backups
    cron.schedule(this.schedule, () => {
      this.createBackup();
    });

    console.log(`[Backup] Scheduled: ${this.schedule}`);
    this.isRunning = true;
  }

  /**
   * Create a backup of the database
   * @returns {{success: boolean, path?: string, error?: string}}
   */
  createBackup() {
    try {
      if (!fs.existsSync(DB_PATH)) {
        console.log('[Backup] No database to backup');
        return { success: false, error: 'Database not found' };
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFilename = `database-${timestamp}.db`;
      const backupPath = path.join(BACKUP_DIR, backupFilename);

      // Copy database file
      fs.copyFileSync(DB_PATH, backupPath);
      console.log(`[Backup] Created: ${backupPath}`);

      // Also backup WAL file if exists
      const walPath = DB_PATH + '-wal';
      if (fs.existsSync(walPath)) {
        fs.copyFileSync(walPath, backupPath + '-wal');
      }

      this.lastBackup = {
        timestamp: new Date(),
        path: backupPath,
        size: fs.statSync(backupPath).size
      };

      // Cleanup old backups
      this.cleanupOldBackups();

      return { success: true, path: backupPath };
    } catch (error) {
      console.error('[Backup] Failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove old backups, keeping only MAX_BACKUPS
   */
  cleanupOldBackups() {
    try {
      const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('database-') && f.endsWith('.db'))
        .map(f => ({
          name: f,
          path: path.join(BACKUP_DIR, f),
          time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);  // Newest first

      if (files.length > MAX_BACKUPS) {
        const toDelete = files.slice(MAX_BACKUPS);
        toDelete.forEach(f => {
          fs.unlinkSync(f.path);
          // Also delete WAL if exists
          const walPath = f.path + '-wal';
          if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
          console.log(`[Backup] Deleted old: ${f.name}`);
        });
      }
    } catch (error) {
      console.error('[Backup] Cleanup failed:', error.message);
    }
  }

  /**
   * Get list of available backups
   * @returns {Array} List of backup files with metadata
   */
  listBackups() {
    try {
      if (!fs.existsSync(BACKUP_DIR)) return [];

      return fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('database-') && f.endsWith('.db'))
        .map(f => {
          const stats = fs.statSync(path.join(BACKUP_DIR, f));
          return {
            filename: f,
            path: path.join(BACKUP_DIR, f),
            size: stats.size,
            created: stats.mtime
          };
        })
        .sort((a, b) => b.created - a.created);
    } catch (error) {
      console.error('[Backup] List failed:', error.message);
      return [];
    }
  }

  /**
   * Restore from a backup
   * @param {string} backupFilename - Name of backup file to restore
   * @returns {{success: boolean, error?: string}}
   */
  restore(backupFilename) {
    try {
      const backupPath = path.join(BACKUP_DIR, backupFilename);
      
      if (!fs.existsSync(backupPath)) {
        return { success: false, error: 'Backup file not found' };
      }

      // Create a backup of current database first
      const preRestoreBackup = this.createBackup();
      console.log(`[Backup] Pre-restore backup: ${preRestoreBackup.path}`);

      // Restore
      fs.copyFileSync(backupPath, DB_PATH);
      console.log(`[Backup] Restored from: ${backupPath}`);

      return { success: true };
    } catch (error) {
      console.error('[Backup] Restore failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      schedule: this.schedule,
      lastBackup: this.lastBackup,
      backupDir: BACKUP_DIR,
      backupCount: this.listBackups().length,
      maxBackups: MAX_BACKUPS
    };
  }
}

module.exports = new BackupService();
