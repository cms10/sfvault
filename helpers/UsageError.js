class UsageError extends Error {
  constructor(message, usage = '') {
    super(message);
    this.name = 'UsageError';
    this.usage = usage;
  }
}

module.exports = UsageError;
