# Booker reference library (.nlib)

A reference library is one **SQLite 3** file with the extension `.nlib`. It holds a work or reference book as a tree of entries: the writings of a Church Father, an encyclopedia, a lexicon, a catechism, a creeds collection, a commentary, anything with text and a place to cite it from. Booker searches it, shows it in its reader, lets you quote from it, and cites it as a source.

No existing standard fits (OSIS, TEI and ThML are for markup, e-Sword modules are Bible-shaped), so this is deliberately small. Booker also reads e-Sword/MySword dictionaries (`.dctx`, `.dct.mybible`) as libraries, and TEI/ThML XML as documents.

## Tables

### `meta` (key, value), both text

| key | required | meaning |
|---|---|---|
| `format` | yes | `nlib` |
| `version` | yes | `1` |
| `title` | yes | the work's title, as it should be cited |
| `author` | no | one or more, separated by `;` |
| `category` | no | `fathers`, `encyclopedia`, `lexicon`, `creeds`, `commentary`, `catechism`, `reference`, or your own word |
| `container` | no | the larger work it appears in, e.g. `Nicene and Post-Nicene Fathers, Series 2, Vol. 4` |
| `volume`, `edition`, `publisher`, `place`, `year`, `url` | no | citation details |
| `translator`, `editor`, `language`, `license`, `description` | no | kept for the record |
| `source_type` | no | `book` (default), `chapter`, `article` or `web` |

### `entries`

```sql
create table entries (
  id      integer primary key,
  parent  integer,   -- id of the containing entry, null at the top
  seq     integer,   -- reading order (defaults to id)
  level   text,      -- work, book, chapter, section, entry, ... (free)
  locator text,      -- how to cite the place: "3.5.2", "Book II, ch. 4", "s.v. Grace". May be empty
  key     text,      -- exact lookup word or number: "H430", "Nicaea". May be empty
  title   text,      -- heading or headword shown to the reader
  text    text       -- Markdown or plain text; paragraphs separated by a blank line. Null for pure headings
);
```

Rules:

- Entries are read in `seq` order. Put a heading entry (no `text`) before the entries under it; `parent` links them.
- If `locator` is empty, Booker builds one from the titles up the tree (`On the Incarnation › Chapter 1`). Give a `locator` whenever the work has a conventional citation (section numbers, page of a standard edition).
- Only entries with `text` are searched. Keep an entry to one natural unit (a chapter, section or article). Very long entries are split for search automatically, so there is no need to chop them.
- Text is UTF-8. Hebrew, Greek and other scripts are fine; search ignores accents and Hebrew vowel points.
- Use Markdown sparingly (paragraphs, `*italics*`, `**bold**`, `> quotes`). Do not include HTML.
- For big works, make indexes on `parent` and `key` and run `vacuum`.

## Making one

Write any SQLite file with those two tables, or write JSON and convert it:

```
node scripts/make-nlib.mjs input.json output.nlib
```

```json
{
  "meta": { "title": "On the Incarnation", "author": "Athanasius of Alexandria", "category": "fathers", "year": "1891",
            "container": "Nicene and Post-Nicene Fathers, Series 2, Vol. 4" },
  "entries": [
    { "level": "work", "title": "On the Incarnation" },
    { "parent": 1, "level": "chapter", "locator": "1.1", "title": "Chapter 1", "text": "In our former book we dealt with…" }
  ]
}
```

## Adding it to Booker

**Documents tab, Add a document**, choose the `.nlib` file. The title, author and citation details come from `meta` and can be edited. The file is copied into the vault's `Booker/Library/Databases` folder and indexed in the background. After that it is searchable with everything else, opens in the reader at the matching entry, and can be quoted and cited like any source.
