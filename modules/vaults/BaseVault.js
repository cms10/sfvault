const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Contract for password-manager backends.
 *
 * Org records exchanged with a vault are plain objects:
 *   { alias, username, instanceUrl, sfdxAuthUrl, loginMethod, ...extra }
 * `username` identifies a record; each backend decides how to persist it.
 */
class BaseVault {
  static id = '';
  static displayName = '';
  static extension = '';

  /** @param {{ exactPath?: boolean }} options exactPath: use `file` as given, without adding the extension */
  constructor(file, { exactPath = false } = {}) {
    this.file = exactPath ? path.resolve(file) : this.constructor.resolvePath(file);
  }

  /** Adds the backend's extension when it was omitted. Backends may override. */
  static resolvePath(file) {
    const resolved = path.resolve(file);
    const { extension } = this;
    if (!extension || resolved.toLowerCase().endsWith(extension.toLowerCase())) {
      return resolved;
    }
    return `${resolved}${extension}`;
  }

  /** Paths tried when looking for an existing file: first with the extension appended, then as given. */
  static candidatePaths(file) {
    const resolved = path.resolve(file);
    const candidates = this.extension ? [`${resolved}${this.extension}`, resolved] : [resolved];
    return [...new Set(candidates)];
  }

  /** Returns the first existing candidate path, or null. */
  static async findExisting(file) {
    for (const candidate of this.candidatePaths(file)) {
      try {
        if ((await fs.stat(candidate)).isFile()) return candidate;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    return null;
  }

  async exists() {
    try {
      return (await fs.stat(this.file)).isFile();
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  /** Unlocks the vault, creating it when `create` is true and the file does not exist. */
  async open({ create = false } = {}) {
    throw new Error(`${this.constructor.name} must implement open()`);
  }

  /** Inserts or updates records by username. Returns { created, updated }. */
  async upsertOrgs(orgs) {
    throw new Error(`${this.constructor.name} must implement upsertOrgs()`);
  }

  async readOrgs() {
    throw new Error(`${this.constructor.name} must implement readOrgs()`);
  }

  async save() {
    throw new Error(`${this.constructor.name} must implement save()`);
  }
}

module.exports = BaseVault;
