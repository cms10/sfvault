const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const UsageError = require('../helpers/UsageError');

class BaseCommand {
  static ASSETS_DIR = path.join(__dirname, '..', 'assets');

  description = '';
  usage = '';

  constructor(args = []) {
    this.args = args;

    const { description, usage } = this.constructor.loadAssets();
    this.description = description;
    this.usage = usage;
  }

  /** Reads <ClassName>Description.txt and <ClassName>Usage.txt; missing files yield ''. */
  static loadAssets() {
    return {
      description: BaseCommand.readAsset(`${this.name}Description.txt`),
      usage: BaseCommand.readAsset(`${this.name}Usage.txt`),
    };
  }

  static readAsset(fileName) {
    try {
      return fs
        .readFileSync(path.join(BaseCommand.ASSETS_DIR, fileName), 'utf8')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
        .trimEnd();
    } catch (err) {
      if (err.code === 'ENOENT') return '';
      throw err;
    }
  }

  /**
   * Parses this command's arguments with node:util parseArgs.
   * Unknown flags and unexpected positionals are reported as usage errors.
   */
  parse(options = {}, { allowPositionals = false } = {}) {
    try {
      return parseArgs({ args: this.args, options, allowPositionals, strict: true });
    } catch (err) {
      this.fail(err.message);
    }
  }

  fail(message) {
    throw new UsageError(message, this.usage);
  }

  async run() {
    throw new Error(`${this.constructor.name} must implement run()`);
  }
}

module.exports = BaseCommand;
