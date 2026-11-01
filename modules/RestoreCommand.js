const BaseCommand = require('./BaseCommand');
const SfCli = require('./SfCli');
const VaultFactory = require('./vaults/VaultFactory');
const OrgPattern = require('../helpers/OrgPattern');
const Concurrency = require('../helpers/Concurrency');
const Prompt = require('../helpers/Prompt');
const Table = require('../helpers/Table');

class RestoreCommand extends BaseCommand {
  static CONCURRENCY = 4;

  static TABLE_COLUMNS = [
    { key: 'alias', title: 'Alias' },
    { key: 'username', title: 'Username' },
    { key: 'instanceUrl', title: 'Instance URL' },
    { key: 'loginMethod', title: 'Login' },
  ];

  fileArg;
  file;
  vault;
  targetOrg = null;
  targetOrgPattern = null;

  constructor(args, sf = new SfCli(), { prompt = Prompt, vaultOptions = {} } = {}) {
    super(args);
    this.sf = sf;
    this.prompt = prompt;
    this.vaultOptions = { prompt, ...vaultOptions };
  }

  validate() {
    const { values } = this.parse({
      file: { type: 'string', short: 'f' },
      'target-org': { type: 'string', short: 'o' },
    });

    if (!values.file) {
      this.fail('missing required flag --file <path>');
    }
    this.fileArg = values.file;

    this.targetOrg = values['target-org'] ?? null;
    if (this.targetOrg !== null) {
      if (this.targetOrg.trim() === '') {
        this.fail('--target-org requires a non-empty pattern');
      }
      this.targetOrgPattern = new OrgPattern(this.targetOrg.trim());
    }
  }

  async run() {
    this.validate();

    if (!(await this.selectFile())) return this.cancel();

    this.vault = VaultFactory.create(this.file, VaultFactory.defaultId, { ...this.vaultOptions, exactPath: true });
    await this.vault.open();

    const stored = await this.vault.readOrgs();
    if (stored.length === 0) {
      console.log('No orgs stored in this file. Nothing to restore.');
      return;
    }

    const orgs = await this.selectOrgs(stored);
    if (!orgs) return this.cancel();
    if (orgs.length === 0) return;

    // the restore-all question already showed the table
    if (this.targetOrgPattern) this.printOrgTable(orgs);
    if (!(await this.prompt.confirm(`Connect the ${orgs.length} org(s) listed above?`))) return this.cancel();

    const results = await this.restoreOrgs(orgs);
    this.printSummary(results);
    if (results.some((r) => !r.ok)) {
      process.exitCode = 1;
    }
  }

  /** Looks for the file with the extension appended first, then as given, and asks the user to confirm it. */
  async selectFile() {
    const Backend = VaultFactory.get();
    const found = await Backend.findExisting(this.fileArg);
    if (!found) {
      this.fail(`file not found. Tried:\n  ${Backend.candidatePaths(this.fileArg).join('\n  ')}`);
    }

    this.file = found;
    console.log(`Found file: ${this.file}`);
    return this.prompt.confirm('Do you want to proceed with this file?');
  }

  /** Returns the orgs to restore, [] when nothing matches, or null when the user declines. */
  async selectOrgs(stored) {
    if (!this.targetOrgPattern) {
      this.printOrgTable(stored);
      const all = await this.prompt.confirm(`Restore all ${stored.length} connection(s) listed above?`);
      return all ? stored : null;
    }

    const orgs = stored.filter((org) => this.targetOrgPattern.matches(org));
    if (orgs.length === 0) {
      console.log(`No stored orgs match --target-org "${this.targetOrg}" (${stored.length} org(s) checked). Nothing to restore.`);
    }
    return orgs;
  }

  printOrgTable(orgs) {
    const rows = orgs.map((org) => ({ ...org, loginMethod: RestoreCommand.loginMethodOf(org) }));
    console.log('');
    console.log(Table.render(RestoreCommand.TABLE_COLUMNS, rows));
    console.log('');
  }

  static loginMethodOf(org) {
    return org.sfdxAuthUrl ? 'sfdx-url' : 'web';
  }

  /** Auth-URL logins run unattended in parallel; browser logins run one at a time afterwards. */
  async restoreOrgs(orgs) {
    const automatic = orgs.filter((org) => RestoreCommand.loginMethodOf(org) === 'sfdx-url');
    const interactive = orgs.filter((org) => RestoreCommand.loginMethodOf(org) === 'web');
    const results = [];

    if (automatic.length > 0) {
      console.log(`\nConnecting ${automatic.length} org(s) with auth URL...`);
      results.push(...(await Concurrency.map(automatic, RestoreCommand.CONCURRENCY, (org) => this.restoreOrg(org))));
    }

    if (interactive.length > 0) {
      console.log(`\nConnecting ${interactive.length} org(s) through the browser (complete each login in the browser)...`);
      for (const org of interactive) {
        console.log(`  → ${RestoreCommand.label(org)}: waiting for browser login at ${org.instanceUrl || 'login.salesforce.com'}`);
        results.push(await this.restoreOrg(org));
      }
    }

    return results;
  }

  async restoreOrg(org) {
    const label = RestoreCommand.label(org);
    const method = RestoreCommand.loginMethodOf(org);
    try {
      if (method === 'sfdx-url') {
        await this.sf.loginWithSfdxUrl({ sfdxAuthUrl: org.sfdxAuthUrl, alias: org.alias });
      } else {
        await this.sf.loginWeb({ instanceUrl: org.instanceUrl, alias: org.alias });
      }
      console.log(`  ✔ ${label}`);
      return { ok: true, label, method };
    } catch (err) {
      const reason = err.message.replace(/See more help with --help/g, '').replace(/\s+/g, ' ').trim();
      console.log(`  ✖ ${label}: ${reason}`);
      return { ok: false, label, method, error: reason };
    }
  }

  static label(org) {
    return org.alias || org.username;
  }

  cancel() {
    console.log('Restore cancelled.');
  }

  printSummary(results) {
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    console.log('');
    console.log(`Restored ${ok.length} of ${results.length} org(s).`);
    if (failed.length > 0) {
      console.log(`Failed ${failed.length} org(s): ${failed.map((f) => f.label).join(', ')}`);
    }
  }
}

module.exports = RestoreCommand;
