#!/usr/bin/env node
const ExportCommand = require('./modules/ExportCommand');
const RestoreCommand = require('./modules/RestoreCommand');
const HelpCommand = require('./modules/HelpCommand');
const UsageError = require('./helpers/UsageError');

class App {
  static commands = {
    export: ExportCommand,
    restore: RestoreCommand,
    help: HelpCommand,
  };

  static helpAliases = ['--help', '-h'];

  constructor(argv) {
    this.argv = argv;
  }

  resolve() {
    const [name, ...args] = this.argv;

    if (!name) {
      throw new UsageError('missing command', HelpCommand.generalUsage(App.commands));
    }

    if (App.helpAliases.includes(name)) {
      return new HelpCommand(args, App.commands);
    }

    const Command = App.commands[name];
    if (!Command) {
      throw new UsageError(`unknown command: ${name}`, HelpCommand.generalUsage(App.commands));
    }

    return Command === HelpCommand ? new HelpCommand(args, App.commands) : new Command(args);
  }

  async run() {
    try {
      await this.resolve().run();
    } catch (err) {
      console.error(`Error: ${err.message}`);
      if (err instanceof UsageError && err.usage) {
        console.error(`\n${err.usage}`);
      }
      process.exitCode = 1;
    }
  }
}

new App(process.argv.slice(2)).run();
