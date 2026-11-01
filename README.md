# sfvault

> Back up your Salesforce CLI org connections into an encrypted password-manager file, and restore them on a new machine with one command.

`sfvault` is a small command-line tool for the moment you switch laptops, like replace your current laptop, move to a new machine, or simply keep you connected across devices, and don't want to re-authenticate dozens of orgs by hand. It reads the orgs known to the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`), stores them in an encrypted **KeePass (`.kdbx`)** database, and later logs every org back in.

## Why not just a JSON file?

An SFDX auth URL (`force://...`) contains a **refresh token**. Anyone holding it can access the org without a password or MFA. Keeping those URLs in a plain-text file on OneDrive or Dropbox is risky; an encrypted vault is not.

- Everything is stored in an encrypted KeePass database (Argon2id key derivation, 64 MiB, via [kdbxweb](https://github.com/keeweb/kdbxweb)).
- Auth URLs live in KeePass's **protected Password field**.
- Auth URLs are passed to `sf` through **stdin**, never written to a temporary file.
- Production orgs can be stored **without** an auth URL, so restoring them uses a normal browser (MFA/SSO) login.

## Features

- **`export`** – list your orgs, fetch their auth URLs and save them to a `.kdbx` file (created on first use, updated afterwards).
- **`restore`** – read the file and log in to the selected orgs (automatic for auth URLs, browser for the rest).
- **Wildcard filtering** with `--target-org` (`my-company-*`, `*uat*`, exact alias…).
- **Production protection** with `--hide-production-auth-url`: production orgs are saved without their token.
- **Confirmations before acting**: confirms the file, shows a table of orgs, and asks before connecting anything.
- **Cross-platform**: Windows, macOS and Linux. No native build step; Argon2 runs in WebAssembly.
- Works with any KeePass-compatible app: you can open and inspect the file in KeePassXC, KeePass2Android, etc.

## Requirements

- [Node.js](https://nodejs.org/) **18.3 or later**
- [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`) installed and available on your `PATH`
- Orgs already authenticated with `sf` (for `export`)

## Installation

From npm:

```bash
npm install -g sfvault
```

Check it works:

```bash
sfvault help
```

Other ways to install:

```bash
# from a git repository
npm install -g git+https://github.com/cms10/sfvault.git

# from a local checkout (symlink, good for development)
git clone https://github.com/cms10/sfvault.git
cd sfvault
npm install
npm link

# from a tarball (e.g. to move the tool to another machine)
npm pack
npm install -g ./sfvault-0.1.0.tgz
```

## Quick start (laptop migration)

**On the old machine**

```bash
# 1. Save everything. The .kdbx extension is optional.
sfvault export --file ~/OneDrive/sf-orgs

# Recommended: keep production tokens out of the file
sfvault export --file ~/OneDrive/sf-orgs --hide-production-auth-url
```

You'll be asked to choose a master password (twice, the first time). Wait for OneDrive to finish syncing the file.

**On the new machine**

```bash
npm install -g sfvault
sfvault restore --file ~/OneDrive/sf-orgs
```

Follow the prompts: confirm the file, enter the master password, review the table and confirm.

## Usage

```
sfvault <command> [options]
```

| Command   | Description                                            |
| --------- | ------------------------------------------------------ |
| `export`  | Save authenticated orgs into a password manager file   |
| `restore` | Log in to orgs stored in a password manager file       |
| `help`    | Show help for sfvault or for a specific command        |

`sfvault help <command>`, `sfvault --help` and `sfvault -h` are also available.

### `sfvault export`

```
sfvault export --file <path> [--target-org <pattern>] [--hide-production-auth-url]
```

| Option                             | Description                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `-f, --file <path>`                | **Required.** File to create or update. The extension may be omitted (`.kdbx` is added). Orgs are updated by username.   |
| `-o, --target-org <pattern>`       | Export only orgs whose alias matches the pattern (username is used when there is no alias). See [Patterns](#patterns).   |
| `-p, --hide-production-auth-url`   | Don't read or store auth URLs for production orgs. They are saved for browser login on restore.                          |

What happens:

1. The master password is requested first, so a wrong password fails immediately. If the file doesn't exist, a new database is created and the password is asked twice.
2. `sf org list` is read and filtered by `--target-org`.
3. The auth URL of each org is obtained with `sf org auth show-sfdx-auth-url` (4 orgs in parallel).
4. Orgs are written to the database, then the file is saved atomically.

Orgs that can't be exported (for example a deleted sandbox) are reported and skipped; the exit code is `1` if any failed. Re-running `export` updates existing entries and keeps the others.

**What counts as "production"?** Any org that is not a sandbox, not a scratch org and not a Developer Edition org (Trailhead playgrounds included). Dev Hubs on production are treated as production.

### `sfvault restore`

```
sfvault restore --file <path> [--target-org <pattern>]
```

| Option                       | Description                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `-f, --file <path>`          | **Required.** The file to restore from. `<path>.kdbx` is tried first, then `<path>` as given.                                 |
| `-o, --target-org <pattern>` | Restore only orgs whose alias matches the pattern. Without it, you are asked whether to restore all stored orgs.             |

What happens:

1. The file is located and you confirm it (`y/n`).
2. You enter the master password.
3. Without `--target-org`, the stored orgs are shown and you're asked whether to restore all of them. With `--target-org`, only matching orgs are selected.
4. A table with **alias, username, instance URL and login method** is shown, and you must confirm that all those orgs should be connected.
5. Orgs with an auth URL are logged in automatically with `sf org login sfdx-url` (4 in parallel). The rest are logged in with `sf org login web`, one at a time, and you complete each login in the browser.
6. A summary lists what succeeded and failed (exit code `1` on any failure).

### Patterns

`--target-org` accepts a case-insensitive pattern where `*` matches any characters. The pattern must match the **whole** alias (or the username when an org has no alias).

| Pattern    | Matches                                 |
| ---------- | --------------------------------------- |
| `my-company-int`   | only the org with exactly that alias    |
| `"my-company-*"`   | every alias starting with `my-company-`         |
| `"*uat*"`  | every alias containing `uat`            |
| `"*prod"`  | every alias ending with `prod`          |

> **Quote patterns that contain `*`** on macOS/Linux (`-o "my-company-*"`), otherwise your shell expands them before `sfvault` sees them.

## How data is stored

Each org becomes one entry in a `sfvault` group of the KeePass database:

| KeePass field         | Content                                                              |
| --------------------- | -------------------------------------------------------------------- |
| Title                 | alias (or username when there is no alias)                           |
| UserName              | Salesforce username                                                  |
| URL                   | instance URL                                                         |
| Password *(protected)*| SFDX auth URL, or empty for orgs restored through the browser        |
| Additional attributes | `alias`, `loginMethod` (`sfdx-url` or `web`), `isSandbox`, `isScratch`, `isDevHub` |

You can open the file in KeePassXC (or any KeePass client) to inspect, edit or delete entries. Orgs with an empty Password field are restored through the browser.

## Security notes

- **Choose a strong master password.** It is the only thing protecting the auth URLs. Back it up in a safe place; a lost password means lost data.
- Treat the `.kdbx` file as sensitive even though it is encrypted. Don't commit it to a repository.
- Prefer `--hide-production-auth-url` so production refresh tokens never leave `sf`.
- After migrating, consider revoking the old machine's tokens (*Setup → Connected Apps OAuth Usage* in each org).
- Refresh tokens can expire or be revoked by org policy. Such orgs will fail to restore with an auth URL; log in again with `sf org login web`.
- Copying `~/.sf` / `~/.sfdx` between machines does **not** work, because stored tokens are encrypted with a machine-specific key. This tool exists for that reason.
- JWT-based logins (connected app + `server.key`) are not covered; back up those keys separately.

## Troubleshooting

| Problem                                              | Solution                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `invalid KeePass password`                           | Wrong master password for that file.                                                             |
| `file not found. Tried: ...`                         | Check the path; both `<path>.kdbx` and `<path>` are tried.                                       |
| `DomainNotFoundError` / `The org cannot be found`    | The org (usually a sandbox) no longer exists. Remove it with `sf org logout -o <alias>`.         |
| `export` is slow                                     | Each `sf` call has a startup cost, and it runs once per org. Use `--target-org` to narrow it down. |
| `sf: command not found`                              | Install the [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) and reopen the terminal. |
| `sfvault: command not found` after `npm install -g`  | Make sure npm's global bin directory is on your `PATH` (`npm prefix -g`; on Windows it is that folder, on macOS/Linux its `bin` subfolder).         |

## Project structure

```
index.js                    entry point: validates the command and routes to a module
modules/
  BaseCommand.js            shared argument parsing and asset loading
  ExportCommand.js          export implementation
  RestoreCommand.js         restore implementation
  HelpCommand.js            help implementation
  SfCli.js                  wrapper around the sf CLI (--json)
  vaults/
    BaseVault.js            contract for password-manager backends
    KeePassVault.js         KeePass (.kdbx) backend
    VaultFactory.js         registry of available backends
helpers/                    prompts, tables, wildcard patterns, concurrency
assets/                     <ClassName>Description.txt / <ClassName>Usage.txt help texts
```

### Adding another password manager

Create a class extending `BaseVault`, set its `id`, `displayName` and `extension`, implement `open`, `upsertOrgs`, `readOrgs` and `save`, and register it in `VaultFactory.backends`. The commands themselves don't change, and each backend controls its own file extension.

## Contributing

Issues and pull requests are welcome. Please open an issue first to discuss larger changes.

```bash
git clone https://github.com/cms10/sfvault.git
cd sfvault
npm install
node index.js help
```

## License

[ISC](./LICENSE) © csaramagaio

## Disclaimer

`sfvault` is an independent project and is not affiliated with or endorsed by Salesforce or the KeePass projects. Salesforce and SFDX are trademarks of Salesforce, Inc.
