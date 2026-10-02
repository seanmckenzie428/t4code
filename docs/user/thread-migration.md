# Threads from older Pilot versions

On your first V2 launch, Pilot copies the V1 database, `state.sqlite`, into `statev2.sqlite`
in the same data directory and migrates the copy. Your threads appear automatically, with full
transcripts imported as needed. You do not need to run an import command.

V1 keeps its original database while V2 uses the copy. Opening V2 again resumes your V2 history.
The copy happens only once: later conversations and changes in either version do not sync to the
other. Server settings, attachments, and workspace files remain shared.

Close the old desktop app before your first V2 desktop launch. Pilot copies its saved browser
profile into the new profile location, preserving Viewed marks, UI preferences, and browser
session data. The old profile stays in place as a recovery copy. Caches are rebuilt, and some
websites may still require you to sign in again. An existing V2 profile is left untouched;
later changes in either profile do not sync to the other.

Your threads keep their settings and organization. Pilot also imports messages, reasoning,
supported attachments, past runs, checkpoints, tool activity, approval history, and plans.
Historical diffs remain available when their Git checkpoint refs still exist. Old approvals
and unfinished tasks are retained as history rather than restarted. Large histories may appear
in stages while the server imports transcripts.

## Continuing a migrated thread

Pilot reuses supported saved provider sessions when their native history is available. This
preserves the provider's conversation context without restarting an old in-progress turn.
When no reusable session was saved, Pilot starts a fresh session with imported conversation
context, subject to the [handoff budget](./portable-handoffs.md). Text omitted from the handoff
remains in the thread and can be retrieved by the agent. The separate 32,000-character recovery
excerpt does not replace the full imported transcript.

Before continuing a long or important thread, read the recent transcript and include any older
requirements the agent still needs in your next message. Starting a new thread and pasting a short
handoff is also a good choice when the old conversation contains conflicting instructions.

## Keeping a recovery copy

Pilot does not currently have a whole-thread export command. Before a major server update, stop
the server and copy its `userdata` directory to a safe location. The default is
`~/.t3/userdata`; a server started with `--home-dir <path>` uses `<path>/userdata`.

If a migrated transcript is missing from the app, keep that copy unchanged. You can inspect the
old transcript without starting a server against it:

```sh
sqlite3 -readonly /path/to/recovery-copy/state.sqlite
```

At the SQLite prompt, list recent legacy threads:

```sql
.headers on
.mode tabs
SELECT thread_id, title, updated_at
FROM projection_threads
ORDER BY updated_at DESC;
```

Then print one transcript, replacing `<thread-id>` with the value from the first query:

```sql
SELECT role, text, created_at
FROM projection_thread_messages
WHERE thread_id = '<thread-id>'
  AND role IN ('user', 'assistant')
ORDER BY created_at, message_id;
```

Open only the copied database. Do not edit it or point a newer or older server at your recovery
copy. If the affected environment is remote, make and inspect the copy on the machine that runs
that environment.
