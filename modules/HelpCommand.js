const BaseCommand = require('./BaseCommand');

class HelpCommand extends BaseCommand {
  /**
   * @param {string[]} args
   * @param {Record<string, typeof BaseCommand>} commands registered commands, keyed by name
   */
  constructor(args, commands) {
    super(args);
    this.commands = commands;
  }

  static generalUsage(commands) {
    const width = Math.max(...Object.keys(commands).map((name) => name.length));
    const list = Object.entries(commands)
      .map(([name, cmd]) => `  ${name.padEnd(width)}   ${cmd.loadAssets().description}`.trimEnd())
      .join('\n');

    return `Usage: sfvault <command> [options]

Commands:
${list}

Run "sfvault help <command>" for command-specific options.`;
  }

  validate() {
    const { positionals } = this.parse({}, { allowPositionals: true });

    if (positionals.length > 1) {
      this.fail(`unexpected argument(s): ${positionals.slice(1).join(' ')}`);
    }

    const [topic] = positionals;
    if (topic && !this.commands[topic]) {
      this.fail(`unknown command: ${topic}`);
    }

    this.topic = topic;
  }

  async run() {
    this.validate();
    console.log(this.topic ? this.commands[this.topic].loadAssets().usage : HelpCommand.generalUsage(this.commands));
  }
}

module.exports = HelpCommand;
