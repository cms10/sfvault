const KeePassVault = require('./KeePassVault');

class VaultFactory {
  static backends = {
    [KeePassVault.id]: KeePassVault,
  };

  static defaultId = KeePassVault.id;

  static get(id = VaultFactory.defaultId) {
    const Backend = VaultFactory.backends[id];
    if (!Backend) {
      throw new Error(`unknown password manager "${id}". Available: ${Object.keys(VaultFactory.backends).join(', ')}`);
    }
    return Backend;
  }

  static create(file, id = VaultFactory.defaultId, options = {}) {
    const Backend = VaultFactory.get(id);
    return new Backend(file, options);
  }
}

module.exports = VaultFactory;
