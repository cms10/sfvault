const readline = require('node:readline');

class Prompt {
  static #lines = null;

  /** Asks a visible question and returns the raw answer. */
  static async ask(question) {
    if (!process.stdin.isTTY) return Prompt.#readLine(question);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await new Promise((resolve) => rl.question(question, resolve));
    } finally {
      rl.close();
    }
  }

  /** Asks a y/n question until a valid answer is given. */
  static async confirm(question) {
    for (;;) {
      const answer = (await Prompt.ask(`${question} (y/n): `)).trim().toLowerCase();
      if (answer === 'y' || answer === 'yes') return true;
      if (answer === 'n' || answer === 'no') return false;
      console.log('Please answer "y" or "n".');
    }
  }

  /** Asks for a secret without echoing it. Falls back to reading a plain line when stdin is piped. */
  static async secret(question) {
    return process.stdin.isTTY ? Prompt.#readHidden(question) : Prompt.#readLine(question);
  }

  static #readHidden(question) {
    const { stdin, stdout } = process;

    return new Promise((resolve, reject) => {
      let value = '';
      stdout.write(question);
      stdin.setRawMode(true);
      stdin.setEncoding('utf8');
      stdin.resume();

      const finish = (err) => {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        stdout.write('\n');
        err ? reject(err) : resolve(value);
      };

      const onData = (chunk) => {
        for (const char of chunk) {
          if (char === '\r' || char === '\n' || char === '\u0004') return finish();
          if (char === '\u0003') return finish(new Error('cancelled by user'));
          if (char === '\u007f' || char === '\b') {
            value = value.slice(0, -1);
          } else if (char >= ' ') {
            value += char;
          }
        }
      };

      stdin.on('data', onData);
    });
  }

  static async #readLine(question) {
    process.stderr.write(question);
    if (!Prompt.#lines) {
      const rl = readline.createInterface({ input: process.stdin, terminal: false });
      Prompt.#lines = rl[Symbol.asyncIterator]();
    }
    const { value, done } = await Prompt.#lines.next();
    process.stderr.write('\n');
    if (done) {
      throw new Error('no input available for prompt');
    }
    return value;
  }
}

module.exports = Prompt;
