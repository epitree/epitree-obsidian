# Epitree for Obsidian

Send notes from the folders you choose to [Epitree](https://epitree.com). There
they become words in your Concept Tree, with reviews spaced out so that you
remember them.

- **One note is one word.** For vocabulary or concept notes: the note's title
  is the word, and your own definition is kept exactly as you wrote it.
- **AI finds the terms in my notes.** For lecture or reading notes: Epitree's
  AI picks up to 10 terms worth learning out of each note, with a sentence
  from the note and a short definition.

Your folders become branches in the Concept Tree, and your `[[links]]` between
notes become links between the words. Only notes that changed are sent again,
and the sync goes one way: nothing in your vault is changed or deleted.

## What you need

- **An Epitree account.** Free accounts can import 200 notes in total. Paid
  plans import more each month (Starter 1,000, Pro 5,000). See
  [epitree.com/pricing](https://epitree.com/dashboard/pricing).
- Obsidian 1.11.4 or later, on desktop or mobile.

## Set up

1. In Epitree, open **Settings → Connected apps** and create a token.
2. In Obsidian, open **Settings → Epitree**, paste the token and select
   **Test connection**.
3. Under **Folders to send**, add the folders to send, and for each one choose
   how its notes are read.
4. Run **Epitree: Preview what would be sent**, then **Send**.

### Beta testing (before it is in Obsidian's directory)

1. In Obsidian, open **Settings → Community plugins → Browse**, install
   **BRAT**, and enable it.
2. Run BRAT's command **Add a beta plugin for testing**, enter
   `epitree/epitree-obsidian`, and confirm.
3. Enable **Epitree** under **Settings → Community plugins**, then follow the
   steps above.

BRAT checks for new versions of the plugin when Obsidian starts.

### Commands

| Command | What it does |
|---|---|
| Preview what would be sent | Counts the new and changed notes and the allowance they use. Sends nothing. |
| Sync changed notes | Sends every new or changed note in your folders. Also the ribbon icon. |
| Send this note | Sends the open note, even if it isn't in one of your folders. |
| Send every note again | Forgets what was sent and sends everything again. Notes Epitree already has cost nothing. |

**Sync automatically** (off by default) syncs when Obsidian starts and then
every 30 minutes.

### How a note is read

| In the note | Becomes |
|---|---|
| The file name, or `term:` in frontmatter | The word |
| `definition:` in frontmatter, or a `Definition:` line | Its definition, as written |
| `context:` / `example:` in frontmatter, or a `Context:` line | The sentence it is asked in |
| `language:` in frontmatter | Its language |
| The rest of the note, and its tags | Your notes on the word |
| `[[links]]` to other notes you send | Links between the words |
| Its folders (if the folder's switch is on) | Branches in the Concept Tree |
| `epitree: false` in frontmatter | Nothing: the note is never sent |

A note without a definition gets one from Epitree's AI, in your Epitree
language. If you edit a word in Epitree, a later sync never overwrites your
edit; it only fills in what is empty.

## Privacy and network use

This plugin connects to **epitree.com**, run by Teqard Labs Private Limited.
It sends nothing until you add a token and choose folders, and then it sends
only:

- **What is sent:** for each note in your chosen folders, its title, path,
  folder, frontmatter `term`, `definition`, `context` and `language`, its
  other text (up to 2,000 characters, or 8,000 in "AI finds the terms"
  mode), its tags, which of your other notes it links to, your vault's name
  (so that the word's source link opens the note), and a fingerprint of the
  note.
- **Why:** to make words from your notes in your Epitree account.
- **AI:** to write missing definitions and to find terms, Epitree sends the
  term and its sentence, or in "AI finds the terms" mode the note's text, to
  its AI provider, DeepSeek (servers in China). Notes with their own
  definition are not sent to be defined. Your name and email are never
  sent with them. See the [Epitree privacy policy](https://epitree.com/privacy).
- **Your token** is kept in Obsidian's secret storage, not in your vault or
  in `data.json`. You can revoke it in Epitree at any time.
- The plugin itself collects no analytics or telemetry, shows no ads and does
  not update itself. `data.json` holds your settings and a list of which notes
  were sent and their fingerprints.

## Develop

```bash
npm install
npm run dev       # rebuilds main.js on change
npm test          # unit tests (vitest)
npm run coverage  # the same, with a coverage report
npm run lint      # ESLint with Obsidian's community-review rules
npm run build     # typecheck and production build
```

The tests run without Obsidian: `tests/obsidian-stub.ts` stands in for its
API, and `tests/fake-app.ts` builds a small vault around it. CI
(`.github/workflows/ci.yml`) runs lint, tests and the build on every push and
pull request.

To try it, copy or link `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/epitree/`, turn on community plugins, and enable
Epitree. Under **Settings → Epitree → Advanced → Server**, point it at your
local backend (for example `http://localhost:8000`).

## Release

1. `npm version patch` (or `minor`) updates `manifest.json` and `versions.json`.
2. Push the commit and the tag (`git push --follow-tags`). The release
   workflow builds the plugin, runs the tests, and drafts a GitHub release
   with `main.js`, `manifest.json` and `styles.css`.
3. Publish the draft. Obsidian installs from the latest release.

## License

[MIT](LICENSE)
