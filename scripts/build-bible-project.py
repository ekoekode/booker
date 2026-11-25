#!/usr/bin/env python3
"""
Build "The Bible" as a Booker project from the Theographic Bible Metadata (CC BY-SA 4.0).

  python3 scripts/build-bible-project.py <folder with people.json places.json events.json books.json> <output folder>

The output folder holds `Booker/The Bible/...` (copy the Booker folder into an Obsidian vault) and an import guide.
Only open data is used: events with dates, people with family links, places with coordinates. No Bible text.
Data: https://github.com/robertrouse/theographic-bible-metadata (Robert Rouse and contributors, CC BY-SA 4.0).
Dates follow Dr. Floyd Nolen Jones, The Chronology of the Old Testament, as Theographic does.
"""
import collections, json, os, re, sys, uuid, zipfile

SRC, OUT = sys.argv[1], sys.argv[2]
TODAY = "2026-11-25"
ROOT = f"{OUT}/Booker-Bible-Project"
BASE = f"{ROOT}/Booker/The Bible"

people = json.load(open(f"{SRC}/people.json"))
places = json.load(open(f"{SRC}/places.json"))
events = json.load(open(f"{SRC}/events.json"))
books = json.load(open(f"{SRC}/books.json"))
BOOK = {b["fields"]["bookOrder"]: b["fields"]["bookName"] for b in books}


# ------------------------------------------------------------------ yaml-ish front matter
def q(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    if re.fullmatch(r"\d{4}-\d\d-\d\d", s):
        return s
    if s == "" or re.search(r'[:#\[\]{}",&*!|>\'%@`]', s) or s != s.strip() or s.lower() in ("true", "false", "null", "yes", "no") or re.fullmatch(r"[\d.\-]+", s):
        return json.dumps(s, ensure_ascii=False)
    return s


def fm(d):
    out = ["---"]
    for k, v in d.items():
        if isinstance(v, list):
            if not v:
                continue
            out.append(f"{k}:")
            out += [f"  - {q(x)}" for x in v]
        elif isinstance(v, dict):
            out.append(f"{k}:")
            out += [f"  {q(a)}: {q(b)}" for a, b in v.items()]
        elif v is None or v == "":
            continue
        else:
            out.append(f"{k}: {q(v)}")
    out.append("---")
    return "\n".join(out) + "\n"


def write(rel, front, body=""):
    p = f"{BASE}/{rel}"
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(fm(front) + ("\n" + body.strip() + "\n" if body.strip() else ""))


# ------------------------------------------------------------------ names that are safe and unique across the vault
BAD = re.compile(r'[\\/:*?"<>|#^\[\]]')


def clean_name(s):
    return re.sub(r"\s+", " ", BAD.sub("", s)).strip().rstrip(".") or "Unnamed"


counts = collections.Counter()
for r in people:
    counts[clean_name(r["fields"]["displayTitle"]).lower()] += 1
for r in places:
    counts[clean_name(r["fields"]["displayTitle"]).lower()] += 1
for r in events:
    counts[clean_name(r["fields"]["title"]).lower()] += 1
taken = set()


def unique(base, suffix):
    n = clean_name(base)
    if counts[n.lower()] > 1 or n.lower() in taken:
        n = f"{n} ({suffix})"
    i = 2
    while n.lower() in taken:
        n = f"{clean_name(base)} ({suffix} {i})"
        i += 1
    taken.add(n.lower())
    return n


PNAME, LNAME, ENAME = {}, {}, {}
for r in people:
    f = r["fields"]
    m = re.search(r"_(\d+)$", f.get("personLookup", ""))
    PNAME[r["id"]] = unique(f["displayTitle"], m.group(1) if m else str(f["personID"]))
for r in places:
    f = r["fields"]
    LNAME[r["id"]] = unique(f["displayTitle"], "place")
for r in events:
    ENAME[r["id"]] = unique(r["fields"]["title"], "event")


def link(n):
    return f"[[{n}]]"


# ------------------------------------------------------------------ text from the dictionary entries
def tidy(t):
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t or "")
    t = t.replace("�", " ").replace("’", "'")
    return re.sub(r"[ \t]+", " ", t).strip()


def year_of(date):
    m = re.match(r"^(-?\d+)", date or "")
    return int(m.group(1)) if m else None


def label_year(date):
    if not date:
        return None
    if re.fullmatch(r"-?\d+", date):
        y = int(date)
        return f"{-y} BCE" if y < 0 else str(y)
    return date  # a full date such as 0026-12-25


def verse_ref(sort):
    m = re.fullmatch(r"(\d\d)(\d{3})(\d{3})", sort or "")
    if not m:
        return ""
    return f"{BOOK.get(int(m.group(1)), '')} {int(m.group(2))}:{int(m.group(3))}"


def duration_text(d):
    m = re.fullmatch(r"(\d+(?:\.\d+)?)([DWMY])(?:(\d+)([DWMY]))?", d or "")
    if not m:
        return ""
    unit = {"D": "day", "W": "week", "M": "month", "Y": "year"}
    parts = []
    for n, u in ((m.group(1), m.group(2)), (m.group(3), m.group(4))):
        if n:
            n = float(n)
            n = int(n) if n == int(n) else n
            parts.append(f"{n} {unit[u]}{'' if n == 1 else 's'}")
    return " and ".join(parts)


# ------------------------------------------------------------------ parts of the book (eras) and chapters (Bible books)
PARTS = [
    ("Creation to the Flood", -2348),
    ("The Patriarchs", -1707),
    ("Egypt, the Exodus and the Wilderness", -1452),
    ("The Conquest and the Judges", -1097),
    ("The United Kingdom", -977),
    ("The Divided Kingdom", -587),
    ("Exile and Return", -5),
    ("The Life of Christ", 33),
    ("The Early Church", 10**6),
]


def part_of(year):
    for i, (_, last) in enumerate(PARTS, 1):
        if year <= last:
            return i
    return len(PARTS)


evs = []
for r in events:
    f = r["fields"]
    y = year_of(f["startDate"])
    if y is None:
        continue
    evs.append((part_of(y), f.get("sortKey", 0), r))
evs.sort(key=lambda t: (t[0], t[1]))

chapter_no, chapter_label, seq_in_part = {}, {}, collections.Counter()
nxt = 1
scene_rows = []
for part, _, r in evs:
    f = r["fields"]
    bk = int(f["verseSort"][:2]) if f.get("verseSort") else 0
    key = (part, bk)
    if key not in chapter_no:
        chapter_no[key] = nxt
        chapter_label[nxt] = BOOK.get(bk, "Other")
        nxt += 1
    seq_in_part[part] += 1
    scene_rows.append((part, chapter_no[key], seq_in_part[part], r))

# ------------------------------------------------------------------ scenes: the events
for part, ch, seq, r in scene_rows:
    f = r["fields"]
    name = ENAME[r["id"]]
    chars = [link(PNAME[i]) for i in f.get("participants", []) if i in PNAME]
    locs = [link(LNAME[i]) for i in f.get("locations", []) if i in LNAME]
    when = label_year(f["startDate"])
    dur = duration_text(f.get("duration"))
    ref = verse_ref(f.get("verseSort"))
    body = [f"**Passage:** {ref}" if ref else "", f"**When:** {when}" + (f", lasting {dur}" if dur else "")]
    if f.get("notes"):
        body.append("")
        body.append(tidy(f["notes"]))
    front = dict(type="scene", title=name, act=part, chapter=ch, sequence=seq, status="final", characters=chars, location=locs, storyDate=when)
    write(f"Scenes/Act {part}/{part:02d}-{seq:03d} {name}.md", front, "\n".join(b for b in body))

# ------------------------------------------------------------------ people
GROUPS = {}
for r in people:
    f = r["fields"]
    name = PNAME[r["id"]]
    front = dict(type="character", name=name, created=TODAY, modified=TODAY, gender=f.get("gender"))
    if f.get("father"):
        front["parents"] = [link(PNAME[i]) for i in f["father"] if i in PNAME] + [link(PNAME[i]) for i in f.get("mother", []) if i in PNAME]
    elif f.get("mother"):
        front["parents"] = [link(PNAME[i]) for i in f["mother"] if i in PNAME]
    if f.get("partners"):
        front["partners"] = [link(PNAME[i]) for i in f["partners"] if i in PNAME]
    if f.get("birthYear"):
        front["born"] = label_year(f["birthYear"])
    if f.get("deathYear"):
        front["died"] = label_year(f["deathYear"])
    if f.get("birthPlace"):
        front["birthPlace"] = [link(LNAME[i]) for i in f["birthPlace"] if i in LNAME]
    if f.get("deathPlace"):
        front["deathPlace"] = [link(LNAME[i]) for i in f["deathPlace"] if i in LNAME]
    body = []
    if f.get("alsoCalled"):
        ac = f["alsoCalled"] if isinstance(f["alsoCalled"], str) else ", ".join(f["alsoCalled"])
        body.append(f"Also called: {ac}")
    n = f.get("verseCount")
    if n:
        body.append(f"Mentioned in {n} verse{'' if n == 1 else 's'}.")
    dt = f.get("dictText")
    if dt:
        text = dt[0] if isinstance(dt, list) else dt
        body.append("")
        body.append(tidy(text))
    write(f"Codex/Characters/{name}.md", front, "\n".join(body))
    # a life on the timeline for those whose birth and death are both dated
    if f.get("birthYear") and f.get("deathYear"):
        lname = unique(f"{clean_name(f['displayTitle'])}'s life", "life")
        write(f"Codex/Lives/{lname}.md", dict(type="life", name=lname, character=link(name), number=1, lifeName=lname, storyDate=f"{label_year(f['birthYear'])}..{label_year(f['deathYear'])}", created=TODAY, modified=TODAY))

# ------------------------------------------------------------------ places
for r in places:
    f = r["fields"]
    name = LNAME[r["id"]]
    front = dict(type="location", name=name, created=TODAY, modified=TODAY, locationType=f.get("featureType") or "Place")
    try:
        lat, lng = float(f["latitude"]), float(f["longitude"])
        if abs(lat) <= 90 and abs(lng) <= 180:
            front["geoLat"], front["geoLng"] = round(lat, 6), round(lng, 6)
            front["geoPlace"] = f["displayTitle"]
    except (KeyError, ValueError, TypeError):
        pass
    body = []
    if f.get("comment"):
        body.append(f"{tidy(f['comment'])}")
    if f.get("otherNames"):
        on = f["otherNames"] if isinstance(f["otherNames"], str) else ", ".join(f["otherNames"])
        body.append(f"Other names: {on}")
    n = f.get("verseCount")
    if n:
        body.append(f"Mentioned in {n} verse{'' if n == 1 else 's'}.")
    dt = f.get("dictText")
    if dt:
        body.append("")
        body.append(tidy(dt[0] if isinstance(dt, list) else dt))
    write(f"Codex/Locations/{name}.md", front, "\n".join(body))

# ------------------------------------------------------------------ project note, notes, system files
ABOUT = """This project maps the Bible as a book you can read in time and place: every dated event as a section on the timeline, every person with their family links, and every place on a map. It holds no Bible text; read the Bible itself in Booker's Bible reader (Resource manager, Bibles) beside it.

## Using it
- Open the Hub, then **Timeline map** for events and lives, **Map** for places, and the **Codex** for people and places.
- Each part of the book is an era; each chapter is the Bible book the events are told in; each section is an event.
- Make it your own: add notes, sermon outlines or a study guide beside it.

## Dates
Dates and the order of events follow Dr. Floyd Nolen Jones, *The Chronology of the Old Testament*, as used by the Theographic project. Other chronologies place many events differently, so treat years as a framework, not a verdict.

## Sources and licence
People, places, events, family links and coordinates come from the Theographic Bible Metadata (Robert Rouse and contributors, https://github.com/robertrouse/theographic-bible-metadata). Dictionary text in the notes is adapted from Easton's Bible Dictionary (1897, public domain) as presented there. This project is released under the Creative Commons Attribution-ShareAlike 4.0 licence (https://creativecommons.org/licenses/by-sa/4.0/). You may share and adapt it with credit, under the same licence."""
write("Notes/About this project.md", dict(type="note", title="About this project", created=TODAY), ABOUT)

acts = list(range(1, len(PARTS) + 1))
write(
    "The Bible.md",
    dict(
        type="booker", title="The Bible", created=TODAY, language="en", bookId=str(uuid.uuid4()), profile="nonfiction-history", numberScenes=False, formatVersion=2,
        timeline_start="4003 BCE", acts=acts, chapters=sorted(chapter_label), chapterLabels={str(k): v for k, v in chapter_label.items()},
        actLabels={str(i): p[0] for i, p in enumerate(PARTS, 1)},
    ),
    "The Bible in time and place: events, people and places. See Notes / About this project.",
)
SYS = {
    "timeline.json": {}, "board.json": {}, "plotlines.json": dict(tagColors={}, tagTypeOverrides={}, plotlineDescriptions={}),
    "stats.json": dict(writingTrackerData=dict(history={}, revisionHistory={}, changeHistory={}, projectDeadlineIncludeWeekends=False, sprintLog=[])),
    "characters.json": dict(characterAliases={}, ignoredCharacters=[]),
    "custom-sections.json": dict(characterCustomSections=[], locationCustomSections=[], codexCategoryCustomSections={}, codexVisualGroups={}, customLocationTypes=[], codexCustomCategories=[], codexEnabledCategories=[]),
    "templates.json": dict(templates=[]),
}
os.makedirs(f"{BASE}/System", exist_ok=True)
os.makedirs(f"{BASE}/Archive", exist_ok=True)
for name, data in SYS.items():
    with open(f"{BASE}/System/{name}", "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)

# ------------------------------------------------------------------ import guide and licence
GUIDE = """BOOKER: THE BIBLE (project)

A Booker project of the Bible's events, people and places, with a timeline, a map and a codex. It has no Bible text.

WHAT YOU NEED
- Obsidian 1.5 or newer, with the Booker plugin installed and turned on (https://github.com/ekoekode/booker).

HOW TO IMPORT
1. Unzip this file. Inside is a folder called "Booker".
2. In Obsidian, find your vault's folder on your computer (Settings > About > "Open vault folder", or look for it in Finder / File Explorer).
3. Copy the "Booker" folder into your vault. If your vault already has a Booker folder, open both and copy "The Bible" from this one into yours, so you end up with: <your vault>/Booker/The Bible/
4. Go back to Obsidian. It will take a moment to read about 5,000 notes the first time.
5. Open the command palette (Cmd/Ctrl+P) and run "Booker: Open Booker hub". Choose "The Bible" in the project list at the top.
6. Try: Timeline map (Plan card) for the events and lives, Map for the places, and Codex for people and places.

TIPS
- "Hide properties in project notes" is on by default; use File info to see a note's properties.
- Add the World English Bible or the Berean Standard Bible from Booker's Resource manager (Downloads) to read the text beside the events.
- To keep your own notes, add them inside the project's Notes folder.

WHAT IS IN IT
- 9 parts (eras) and about 450 dated events as sections, grouped into chapters by the Bible book they are told in.
- About 3,000 people with family links, 1,300 places with coordinates, and lives for those with dated births and deaths.

SOURCES AND LICENCE
Data: Theographic Bible Metadata, Robert Rouse and contributors, https://github.com/robertrouse/theographic-bible-metadata. Dictionary text adapted from Easton's Bible Dictionary (1897, public domain) as presented there. Dates follow Dr. Floyd Nolen Jones, The Chronology of the Old Testament.
This project is released under Creative Commons Attribution-ShareAlike 4.0 (https://creativecommons.org/licenses/by-sa/4.0/): share and adapt with credit, under the same licence.
"""
open(f"{ROOT}/README - Import instructions.txt", "w", encoding="utf-8").write(GUIDE)

# ------------------------------------------------------------------ zip
zip_path = f"{OUT}/Booker-Bible-Project.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for dp, _, files in os.walk(ROOT):
        for name in files:
            full = os.path.join(dp, name)
            z.write(full, os.path.relpath(full, OUT))
n = sum(len(fs) for _, _, fs in os.walk(BASE))
print("notes", n, "parts", len(PARTS), "chapters", len(chapter_label), "events", len(scene_rows), "people", len(people), "places", len(places))
print("zip", zip_path, os.path.getsize(zip_path))
