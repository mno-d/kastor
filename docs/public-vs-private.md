# Public vs Private Kastor

Kastor has two very different ways to use it.

Public Kastor is the version you give to someone else.
Private Kastor is the version you run on your own machine with your own rules.

Do not mix the two.

## Public Setup

Use this when writing docs, screenshots, templates, demos, or support steps for
other people.

- Use the `project` or `projects` permission preset.
- Show a small sample folder, not a real home folder.
- Keep `KASTOR_ALLOWED_ROOTS` narrow.
- Never include `~/.kastor/auth.json`, `.env`, tunnel URLs, API keys, or logs.
- Run `kastor public-check` before sharing.
- Assume the reader is new and will copy the command exactly.

Good example:

```text
KASTOR_ALLOWED_ROOTS=/Users/alice/dev/demo-project
```

Bad public example:

```text
KASTOR_ALLOWED_ROOTS=C:\
KASTOR_ALLOWED_ROOTS=/Users/alice
KASTOR_ALLOWED_ROOTS=/
```

## Private Setup

Use this only on your own trusted machine.

- `power` can be acceptable if you understand the risk.
- Full-PC access is a private choice, not a tutorial default.
- Keep the owner password and tunnel URL out of git.
- Review diffs before committing or publishing anything.

## Rule Of Thumb

If another person may copy it, keep it narrow.

If it is broad, label it as private-machine-only and do not put it in the main
README path.

