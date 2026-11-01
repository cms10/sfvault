const fs = require('node:fs/promises');
const path = require('node:path');
const BaseCommand = require('./BaseCommand');
const SfCli = require('./SfCli');
const VaultFactory = require('./vaults/VaultFactory');
const OrgPattern = require('../helpers/OrgPattern');
const Concurrency = require('../helpers/Concurrency');

class ExportCommand extends BaseCommand {

  static CONCURRENCY = 4;

  file;
  vault;
  protectProductionOrgs = false;
  targetOrg = null;
  targetOrgPattern = null;

  constructor(args, sf = new SfCli(), vaultOptions = {}) {
    super(args);
    this.sf = sf;
    this.vaultOptions = vaultOptions;
  }

  validate() {
    const { values } = this.parse({
      file: { type: 'string', short: 'f' },
      'hide-production-auth-url': { type: 'boolean', short: 'p' },
      'target-org': { type: 'string', short: 'o' }
    });

    if (!values.file) {
      this.fail('missing required flag --file <path>');
    }

    this.vault = VaultFactory.create(values.file, VaultFactory.defaultId, this.vaultOptions);
    this.file = this.vault.file;
    this.protectProductionOrgs = Boolean(values['hide-production-auth-url']);
    this.targetOrg = values['target-org'] ?? null;

    if (this.targetOrg !== null) {
      if (this.targetOrg.trim() === '') {
        this.fail('--target-org requires a non-empty pattern');
      }
      this.targetOrgPattern = new OrgPattern(this.targetOrg.trim());
    }
  }

  matchesTargetOrg(org) {
    return !this.targetOrgPattern || this.targetOrgPattern.matches(org);
  }

  async run() {
    this.validate();
    await this.ensureTargetDirectory();

    // unlock first so a wrong password fails before the (slow) sf calls
    const { created } = await this.vault.open({ create: true });
    if (!created) console.log(`Opened ${this.file}`);

    console.log('Listing authenticated orgs...');
    const allOrgs = await this.sf.listOrgs();
    if (allOrgs.length === 0) {
      console.log('No authenticated orgs found. Nothing to export.');
      return;
    }

    const orgs = allOrgs.filter((org) => this.matchesTargetOrg(org));
    if (orgs.length === 0) {
      console.log(`No orgs match --target-org "${this.targetOrg}" (${allOrgs.length} org(s) checked). Nothing to export.`);
      return;
    }

    const matchInfo = this.targetOrgPattern ? ` (${orgs.length} matching "${this.targetOrg}")` : '';
    console.log(`Found ${allOrgs.length} org(s)${matchInfo}. Retrieving auth URLs...`);

    const results = await Concurrency.map(orgs, ExportCommand.CONCURRENCY, (org) => this.exportOrg(org));
    const exported = results.filter((r) => r.ok).map((r) => r.entry);
    const failed = results.filter((r) => !r.ok);

    let stats = { created: 0, updated: 0 };
    if (exported.length > 0) {
      stats = await this.vault.upsertOrgs(exported);
      await this.vault.save();
    }

    this.printSummary(exported, failed, stats);
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  }

  async ensureTargetDirectory() {
    const dir = path.dirname(this.file);
    let stat;
    try {
      stat = await fs.stat(dir);
    } catch (err) {
      if (err.code === 'ENOENT') this.fail(`directory not found: ${dir}`);
      throw err;
    }
    if (!stat.isDirectory()) this.fail(`not a directory: ${dir}`);
  }

  async exportOrg(org) {
    const label = org.alias || org.username;
    const entry = {
      alias: org.alias ?? null,
      username: org.username,
      instanceUrl: org.instanceUrl,
      isSandbox: org.isSandbox,
      isScratch: org.isScratch,
      isDevHub: org.isDevHub,
      loginMethod: 'sfdx-url',
      sfdxAuthUrl: null,
    };

    if (this.protectProductionOrgs && SfCli.isProduction(org)) {
      entry.loginMethod = 'web';
      console.log(`  • ${label} (production: auth URL hidden)`);
      return { ok: true, entry };
    }

    try {
      // username is unique and always present; aliases are optional
      entry.sfdxAuthUrl = await this.sf.showSfdxAuthUrl(org.username);
      console.log(`  ✔ ${label}`);
      return { ok: true, entry };
    } catch (err) {
      const reason = err.message.replace(/See more help with --help/g, '').replace(/\s+/g, ' ').trim();
      const status = org.connectedStatus && org.connectedStatus !== 'Connected' ? ` [${org.connectedStatus}]` : '';
      console.log(`  ✖ ${label}${status}: ${reason}`);
      return { ok: false, label, error: reason };
    }
  }

  printSummary(exported, failed, { created, updated }) {
    console.log('');
    if (exported.length > 0) {
      const hidden = exported.filter((e) => e.loginMethod === 'web').length;
      console.log(`Exported ${exported.length} org(s) to ${this.file} (${created} new, ${updated} updated)`);
      if (hidden > 0) {
        console.log(`  ${hidden} production org(s) stored without auth URL (web login on restore)`);
      }
    } else {
      console.log('No orgs exported; file was not saved.');
    }
    if (failed.length > 0) {
      console.log(`Failed ${failed.length} org(s): ${failed.map((f) => f.label).join(', ')}`);
    }
  }
}

module.exports = ExportCommand;
