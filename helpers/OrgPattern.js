/** Case-insensitive wildcard matcher for org aliases ("*" matches any characters). */
class OrgPattern {
  constructor(pattern) {
    this.pattern = pattern;
    this.regex = OrgPattern.wildcardToRegExp(pattern);
  }

  static wildcardToRegExp(pattern) {
    const source = pattern
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${source}$`, 'i');
  }

  /** Matches the alias, or the username for orgs without alias. */
  matches(org) {
    return this.regex.test(org.alias || org.username);
  }

  toString() {
    return this.pattern;
  }
}

module.exports = OrgPattern;
