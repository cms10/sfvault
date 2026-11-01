const fs = require('node:fs/promises');
const kdbxweb = require('kdbxweb');
const { argon2d, argon2id } = require('hash-wasm');
const BaseVault = require('./BaseVault');
const Prompt = require('../../helpers/Prompt');

// kdbxweb ships without Argon2; hash-wasm provides a pure WebAssembly implementation (no native build)
kdbxweb.CryptoEngine.setArgon2Impl(async (password, salt, memory, iterations, length, parallelism, type, version) => {
  const hash = type === kdbxweb.CryptoEngine.Argon2TypeArgon2id ? argon2id : argon2d;
  if (version !== 0x13) {
    throw new Error(`unsupported Argon2 version 0x${version.toString(16)}`);
  }
  const result = await hash({
    password: new Uint8Array(password),
    salt: new Uint8Array(salt),
    memorySize: memory,
    iterations,
    hashLength: length,
    parallelism,
    outputType: 'binary',
  });
  return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
});

class KeePassVault extends BaseVault {
  static id = 'keepass';
  static displayName = 'KeePass';
  static extension = '.kdbx';

  static GROUP_NAME = 'sfvault';
  static DATABASE_NAME = 'sfvault';

  // KeePassXC-like defaults: Argon2id, 64 MiB
  static KDF = { memoryBytes: 64 * 1024 * 1024, iterations: 10, parallelism: 2 };

  // Org properties mapped onto KeePass standard fields; everything else becomes a custom attribute
  static STANDARD_FIELDS = {
    username: 'UserName',
    instanceUrl: 'URL',
    sfdxAuthUrl: 'Password',
  };

  constructor(file, { prompt = Prompt, ...options } = {}) {
    super(file, options);
    this.prompt = prompt;
    this.db = null;
  }

  async open({ create = false } = {}) {
    if (await this.exists()) {
      const password = await this.prompt.secret(`KeePass password for ${this.file}: `);
      await this.load(password);
      return { created: false };
    }

    if (!create) {
      throw new Error(`KeePass file not found: ${this.file}`);
    }

    console.log(`Creating new KeePass database: ${this.file}`);
    const password = await this.prompt.secret('New KeePass password: ');
    if (!password) {
      throw new Error('password must not be empty');
    }
    const confirmation = await this.prompt.secret('Confirm KeePass password: ');
    if (password !== confirmation) {
      throw new Error('passwords do not match');
    }
    this.createDatabase(password);
    return { created: true };
  }

  async load(password) {
    const data = await fs.readFile(this.file);
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    try {
      this.db = await kdbxweb.Kdbx.load(buffer, KeePassVault.credentials(password));
    } catch (err) {
      if (err.code === kdbxweb.Consts.ErrorCodes.InvalidKey) {
        throw new Error('invalid KeePass password (or key file required)');
      }
      throw err;
    }
  }

  createDatabase(password) {
    this.db = kdbxweb.Kdbx.create(KeePassVault.credentials(password), KeePassVault.DATABASE_NAME);
    this.db.setKdf(kdbxweb.Consts.KdfId.Argon2id);

    const { memoryBytes, iterations, parallelism } = KeePassVault.KDF;
    const params = this.db.header.kdfParameters;
    params.set('M', kdbxweb.VarDictionary.ValueType.UInt64, kdbxweb.Int64.from(memoryBytes));
    params.set('I', kdbxweb.VarDictionary.ValueType.UInt64, kdbxweb.Int64.from(iterations));
    params.set('P', kdbxweb.VarDictionary.ValueType.UInt32, parallelism);
  }

  static credentials(password) {
    return new kdbxweb.KdbxCredentials(kdbxweb.ProtectedValue.fromString(password));
  }

  getGroup() {
    const root = this.db.getDefaultGroup();
    return (
      root.groups.find((g) => g.name === KeePassVault.GROUP_NAME) ?? this.db.createGroup(root, KeePassVault.GROUP_NAME)
    );
  }

  findEntry(group, username) {
    return group.entries.find((e) => KeePassVault.text(e.fields.get('UserName')) === username);
  }

  async upsertOrgs(orgs) {
    this.assertOpen();
    const group = this.getGroup();
    let created = 0;
    let updated = 0;

    for (const org of orgs) {
      let entry = this.findEntry(group, org.username);
      if (entry) {
        updated++;
      } else {
        entry = this.db.createEntry(group);
        created++;
      }
      KeePassVault.writeEntry(entry, org);
    }

    return { created, updated };
  }

  async readOrgs() {
    this.assertOpen();
    const root = this.db.getDefaultGroup();
    const group = root.groups.find((g) => g.name === KeePassVault.GROUP_NAME);
    return group ? group.entries.map((entry) => KeePassVault.readEntry(entry)) : [];
  }

  async save() {
    this.assertOpen();
    const data = Buffer.from(await this.db.save());
    // write to a temp file first so a crash never leaves a half-written database
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  assertOpen() {
    if (!this.db) throw new Error('KeePass database is not open');
  }

  static writeEntry(entry, org) {
    const { STANDARD_FIELDS } = KeePassVault;
    entry.fields.set('Title', org.alias || org.username);

    for (const [key, value] of Object.entries(org)) {
      const field = STANDARD_FIELDS[key] ?? key;
      const text = value === null || value === undefined ? '' : String(value);
      const isSecret = field === 'Password';
      entry.fields.set(field, isSecret ? kdbxweb.ProtectedValue.fromString(text) : text);
    }

    entry.times.update();
  }

  static readEntry(entry) {
    const reverse = Object.fromEntries(Object.entries(KeePassVault.STANDARD_FIELDS).map(([k, v]) => [v, k]));
    const org = {};

    for (const [field, raw] of entry.fields) {
      if (field === 'Title' || field === 'Notes') continue;
      const key = reverse[field] ?? field;
      const text = KeePassVault.text(raw);
      org[key] = KeePassVault.parseValue(text);
    }

    org.alias = org.alias || null;
    org.sfdxAuthUrl = org.sfdxAuthUrl || null;
    return org;
  }

  static text(value) {
    if (value instanceof kdbxweb.ProtectedValue) return value.getText();
    return value ?? '';
  }

  static parseValue(text) {
    if (text === 'true') return true;
    if (text === 'false') return false;
    return text;
  }
}

module.exports = KeePassVault;
