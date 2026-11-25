# Booker

Booker is a plugin for [Obsidian](https://obsidian.md) for writing a book: a novel, history, reference work, devotional and more, with a profile for each kind. It keeps a book as plain notes: scenes grouped into acts and chapters, plus characters and places. It has a clear interface, a typeset writing mode, name detection and a full export window.

It works on Mac, Windows, iPhone and iPad. A project is plain notes in your vault, so it can be shared with a co-author through the Collaborative Folders plugin.

## What it does

- **Hub.** One place to start: **Write**, **Plan**, **Codex** and **Export** cards, plus a Getting started checklist. It lives in the left sidebar; the right sidebar's Documents and Reference panel holds sources, scripture, word studies, citations and footnotes. Properties are hidden in project notes by default (toggle in the hub's ⋯ menu).
- **Plain notes.** A project note, scenes in `Scenes/Act N/AA-SS Title.md`, world notes in `Codex/`, and JSON files in `System/`. Projects in the `StoryLine/` folder layout open as they are.
- **Board.** Acts, chapters and scenes as columns and cards. Drag a scene to another chapter or act. Name your acts and chapters, add a Prologue (act 0), and keep empty chapters.
- **Plotlines.** A subway map: a line for each plotline, a station for each scene. Click a station for a list: put the scene on the line, mark a setup or payoff, branch a new line, split it into subplots, or run it into another line.
- **Timeline map.** A smooth, zoomable time axis with lanes for characters, places and plotlines. Pinch or scroll to zoom, drag to pan, drag a bar to change a scene's date.
- **Map.** Scenes, chapters, places and any Codex note on a real world map (Natural Earth, built in, works offline) or on your own drawn maps with their own coordinates and grids, several worlds per book, and a fallback engine for computers without WebGL. Type a city, state, country or zip to place a note, or click the map; filter by story-date window, type, character and plotline.
- **Stats.** Words, streak, sprint timer and history, progress by act, prose analysis and an echo finder, characters and point of view.
- **Backups.** Full or incremental copies of a project to a folder you choose, on a schedule, with restore into a new folder.
- **Inspector.** The details of the open note in the note's own fields: a scene's status, people, place, plotlines and story time, or a character's or place's profile.
- **Codex.** Characters, places, items, creatures, lore, culture, systems and notes, plus categories of your own.
- **Writing mode.** First-line indent, paragraph and dialogue spacing, and Tab to indent, shown in the editor without changing your text.
- **Name detection.** When you write a character's or place's name, it is added to the scene's properties. If a name could mean two notes (Mike Anderson or Mike Johnson), a small floating box asks which one.
- **Footnotes.** `[^1]` and `^[inline]` notes, an Insert footnote command, and export as page-bottom, chapter-end or book-end notes.
- **Scripture.** Insert Bible verses from your own e-Sword, MySword, OSIS, Zefania or USFX modules: reference or word search, verse numbers, reference styles, partial verses (a, b, c).
- **Sources.** A library of books, PDFs, ePubs and web pages with search, highlights, quotes with references, and Chicago citations (`[@key]`) with a bibliography.
- **Reference libraries.** Add databases (Church Fathers, encyclopedias, lexicons) in the open `.nlib` format; searchable and citable. See `docs/REFERENCE-LIBRARY-FORMAT.md`.
- **Hebrew.** Right-to-left export and a word-study insert from your own lexicon.
- **Export.** Word, ePub and PDF, with an Advanced window for page size, margins, fonts, spacing, chapter breaks, page numbers and more.

## The Bible project

A free Booker project of the Bible's events, people and places, with a timeline, a map and a codex. It holds no Bible text, so you read the Bible in Booker's reader beside it.

**[Download Booker-Bible-Project.zip](https://github.com/ekoekode/booker/releases/download/bible-project-v1/Booker-Bible-Project.zip)** (about 2 MB)

- 9 eras and 501 dated events as sections, grouped by the Bible book they are told in.
- 3,068 people with family links, and lives for those with dated births and deaths.
- 1,297 places with coordinates for the Map.

To import it: unzip the file, copy the `Booker` folder into your Obsidian vault (so you have `<your vault>/Booker/The Bible/`), reload Obsidian, run **Booker: Open Booker hub** and pick "The Bible". The zip also holds a short `README - Import instructions.txt`.

Data: [Theographic Bible Metadata](https://github.com/robertrouse/theographic-bible-metadata) by Robert Rouse and contributors, with dates after Dr. Floyd Nolen Jones, *The Chronology of the Old Testament*; dictionary text adapted from Easton's Bible Dictionary (1897). The project is shared under [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Rebuild it with `python3 scripts/build-bible-project.py`.

## Install

You need Obsidian 1.5.0 or newer.

1. Download `booker-<version>-desktop.zip` from the [Releases](https://github.com/ekoekode/booker/releases) page and unzip it. One download covers Mac (Apple silicon), Windows and Linux. The `-no-guide` zip is the same without the PDF guide.
2. Copy the `booker` folder into `<your vault>/.obsidian/plugins/`. (`.obsidian` is hidden: Cmd+Shift+. in Finder, View > Show > Hidden items in File Explorer.)
3. In Obsidian, open Settings, then Community plugins, and turn on Booker.

To build it yourself instead, see Development below, then run `node scripts/install.mjs "<path to your vault>" --enable`.

### Updating

Open Booker's settings (in a project's settings window, the Plugin settings tab) and press **Check for updates**. If a newer release exists, Booker downloads it and replaces only its own program files. Your books, Bibles, libraries, downloaded models and settings are not touched.

## Quick start

1. Open the command palette and run **Booker: Open Booker hub**.
2. Follow the Getting started card: create your project, add a scene, write.
3. Open the **Board** from the Plan card to arrange acts, chapters and scenes.
4. Add characters and places in **Codex**. Name them in a scene and Booker adds them to the scene's properties.
5. When you are ready, use the **Export** card.

## The guide

The full guide is in [docs/GUIDE.md](docs/GUIDE.md).

## Development

You need Node.js. From the project folder:

```
npm install            # install the libraries
npm run build          # check the types and build main.js
npm test               # run the tests
```

`npm run dev` rebuilds as you change files. To build the PDF guide, run `node scripts/build-guide.mjs`.

## License

Booker is released under the MIT license. See `LICENSE`.

Everything bundled is under a permissive licence (MIT, BSD, ISC, Apache-2.0, the SIL Open Font License, CC BY 4.0 or public domain). The list, with attributions, is in `THIRD_PARTY_NOTICES.md`, and the release zips carry the full texts in a `LICENSES/` folder.

Downloads such as Bibles, Church Fathers, dictionaries and place data come from their own sources under their own licences, which the Resource manager shows beside each one. Booker does not redistribute them.

## Privacy and security

- Booker goes online only when you press a Download button in the Resource manager (models, Bibles, libraries, CCEL works, and the place data the Map uses to find a city or zip) or press Check for updates (which asks GitHub for the newest release). It has no telemetry and writes only to your vault and its own `data.json`.
- The Apple AI hand-off copies the prompt to the system clipboard and opens a local `shortcuts://` link. Nothing leaves your device.
