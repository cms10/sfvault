const { exec } = require('node:child_process');

class SfCli {
  constructor({ bin = 'sf', maxBuffer = 50 * 1024 * 1024 } = {}) {
    this.bin = bin;
    this.maxBuffer = maxBuffer;
  }

  static quote(arg) {
    return `"${String(arg).replace(/"/g, '\\"')}"`;
  }

  /**
   * Runs an sf command with --json and returns its `result` payload.
   * A shell is used so that sf.cmd resolves on Windows; args are always quoted.
   * `input` is written to the command's stdin (used to pass secrets without touching disk).
   */
  run(args, { input } = {}) {
    const command = [this.bin, ...args.map(SfCli.quote), '--json'].join(' ');

    return new Promise((resolve, reject) => {
      const child = exec(command, { maxBuffer: this.maxBuffer, windowsHide: true }, (error, stdout, stderr) => {
        let payload;
        try {
          payload = JSON.parse(stdout);
        } catch {
          const detail = (stderr || stdout || error?.message || '').trim();
          return reject(new Error(`could not parse output of "${args.join(' ')}": ${detail}`));
        }

        if (payload.status !== 0) {
          return reject(new Error(payload.message || `"${args.join(' ')}" failed`));
        }
        resolve(payload.result);
      });

      if (input !== undefined) {
        child.stdin.end(input);
      }
    });
  }

  /** Returns every authenticated org once, regardless of category. */
  async listOrgs() {
    const result = await this.run(['org', 'list', '--verbose']);
    const byUsername = new Map();

    for (const [group, orgs] of Object.entries(result)) {
      if (!Array.isArray(orgs)) continue;
      for (const org of orgs) {
        if (!org?.username) continue;
        const merged = byUsername.get(org.username) ?? { ...org };
        // the same org can appear in several groups; group membership is the reliable type indicator
        merged.isSandbox = Boolean(merged.isSandbox || org.isSandbox || group === 'sandboxes');
        merged.isScratch = Boolean(merged.isScratch || org.isScratch || group === 'scratchOrgs');
        merged.isDevHub = Boolean(merged.isDevHub || org.isDevHub || group === 'devHubs');
        byUsername.set(org.username, merged);
      }
    }

    return [...byUsername.values()];
  }

  static isProduction(org) {
    return !SfCli.isSandbox(org) && !SfCli.isScratch(org) && !SfCli.isDeveloperEdition(org);
  }

  static isSandbox(org) {
    return Boolean(org.isSandbox) || SfCli.hostMatches(org, /\.sandbox\.my\.salesforce\.com$/);
  }

  static isScratch(org) {
    return Boolean(org.isScratch) || SfCli.hostMatches(org, /\.scratch\.my\.salesforce\.com$/);
  }

  // Covers Trailhead playgrounds too; older auth files lack orgEdition, so the domain is the fallback
  static isDeveloperEdition(org) {
    return (
      org.orgEdition === 'Developer Edition' ||
      SfCli.hostMatches(org, /(\.develop|\.trailblaze)\.my\.salesforce\.com$|-dev-ed\.my\.salesforce\.com$/)
    );
  }

  static hostMatches(org, pattern) {
    try {
      return pattern.test(new URL(org.instanceUrl).hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  async showSfdxAuthUrl(targetOrg) {
    const result = await this.run(['org', 'auth', 'show-sfdx-auth-url', '--target-org', targetOrg, '--no-prompt']);
    if (!result?.sfdxAuthUrl) {
      throw new Error('no sfdxAuthUrl returned');
    }
    return result.sfdxAuthUrl;
  }

  /** Logs in with an auth URL passed through stdin, so it is never written to disk. */
  async loginWithSfdxUrl({ sfdxAuthUrl, alias }) {
    const args = ['org', 'login', 'sfdx-url', '--sfdx-url-stdin', '-', '--no-prompt'];
    if (alias) args.push('--alias', alias);
    return this.run(args, { input: sfdxAuthUrl.trim() });
  }

  /** Opens the browser for an interactive login; resolves once the user completes it. */
  async loginWeb({ instanceUrl, alias }) {
    const args = ['org', 'login', 'web', '--no-prompt'];
    if (instanceUrl) args.push('--instance-url', instanceUrl);
    if (alias) args.push('--alias', alias);
    return this.run(args);
  }
}

module.exports = SfCli;
