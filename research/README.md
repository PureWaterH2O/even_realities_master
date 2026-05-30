# Research (raw, append-only audit trail)

Every research sweep gets its own dated folder. Nothing here is edited after the
fact — this is the source-of-truth audit trail. Trustworthy facts get **distilled**
from here into `../knowledge/` (a deliberate review step, not automatic).

## Folder format

```
research/YYYY-MM-DD-<topic-slug>/
├── findings.md     # raw findings, grouped by sub-topic, each linked to a source id
└── sources.md      # numbered source list (s1, s2, ...) with URL + access date + type
```

## `sources.md` format

```markdown
# Sources — <topic> (YYYY-MM-DD)

- **s1** — <title>. <url> · accessed YYYY-MM-DD · type: first-party | repo | reddit | discord | article | video
- **s2** — ...
```

## `findings.md` format

Tag each finding with the confidence it deserves *from the source alone*
(🟡 single source, ✅ corroborated, 🔴 rumor) and cite the source id:

```markdown
- 🟡 <finding>. _[s1]_
- ✅ <finding>. _[s2][s5]_
```
