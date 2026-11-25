import os, json, re, uuid

import sys
ROOT = sys.argv[1] if len(sys.argv) > 1 else "."  # the path to your vault
PROJ = "StoryLine/Sample Novel"
BASE = f"{ROOT}/{PROJ}"
D = "2026-10-25"


def q(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    if re.fullmatch(r"\d{4}-\d\d-\d\d", s) and not isinstance(v, (int,float)):
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
        else:
            out.append(f"{k}: {q(v)}")
    out.append("---")
    return "\n".join(out) + "\n"


def write(rel, front, body=""):
    p = f"{BASE}/{rel}"
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(fm(front) + ("\n" + body.strip() + "\n" if body.strip() else ""))


def link(n):
    return f"[[{n}]]"


# ---------------------------------------------------------------- cast & places
CHARS = {
    "Mara Vance": dict(role="Protagonist", occupation="Marine surveyor", residency="Bristol, then Saltmarrow", appearance="Tall, sun-freckled, always in her grandfather's old oilskin.", personality="Dry, stubborn, notices everything and says half of it.", goal="Learn what happened to her grandfather", belief="Facts will settle it", misbelief="Leaving a place means it can't hurt you", fears="Being stuck in the same life as her mother", flaws="Withholds, walks out of rooms", strengths="Patient, precise, brave in the water"),
    "Tomas Vance": dict(role="Missing grandfather", occupation="Sailor, then lighthouse keeper", residency="Saltmarrow Lighthouse", appearance="Broad, silver-bearded, one crooked finger.", personality="Gentle, secretive, hums when he lies.", goal="Keep the town's secret safe", fears="The Marigold's bell", flaws="Silence"),
    "Eliot Reyes": dict(role="Ally, love interest", occupation="Harbourmaster", residency="Harbour flat", appearance="Wiry, ink on his cuffs.", personality="Warm, evasive about his own past.", goal="Keep the harbour open", strengths="Knows every boat and every grudge"),
    "Nell Okafor": dict(role="Ally", occupation="Journalist, Saltmarrow Courier", residency="Above the print shop", personality="Relentless, funny, bad at sleeping.", goal="A story that matters", flaws="Publishes too fast"),
    "Silas Brandt": dict(role="Antagonist", occupation="Property developer", residency="The Cannery House", appearance="Immaculate coat, cold hands.", personality="Charming in a way that costs you.", goal="Buy the headland and the lighthouse", misbelief="Everything has a price", fears="The 1987 ledger surfacing"),
    "Ines Vance": dict(role="Mara's mother", occupation="Retired schoolteacher", residency="Vance Cottage", personality="Brittle, loving, controlling.", goal="Stop Mara repeating her father's fate", fears="Losing another Vance to the sea", flaws="Lies by omission"),
    "Pip Calloway": dict(role="Witness", occupation="Schoolchild, twelve", residency="Harbour terrace", personality="Curious, fearless, collects bottle caps.", goal="Be taken seriously"),
    "Dr. Hale": dict(role="Red herring", occupation="Town doctor", residency="Chapel Lane", personality="Kind, tired, nervous around Brandt.", goal="Keep his clinic funded", flaws="Cowardice"),
    "Oren Voss": dict(role="Old fisherman", occupation="Fisherman", residency="Gull Rock cabin", personality="Taciturn, wry, superstitious.", goal="Die without telling", belief="The sea keeps accounts"),
    "Agnes Pryor": dict(role="Keeper of records", occupation="Archivist", residency="Archive back room", personality="Exacting, deadpan, secretly romantic.", goal="Protect the records from the developer", strengths="Never forgets a date"),
}
PLACES = {
    "Saltmarrow Lighthouse": dict(locationType="Landmark", description="White tower on the headland, lamp dark since 1987.", atmosphere="Wind-scoured, echoing", significance="Where Tomas vanished"),
    "Saltmarrow Harbour": dict(locationType="Harbour", description="Stone quay, nine boats, one café.", atmosphere="Busy at dawn, hushed at dusk", significance="Where the town gossips"),
    "The Drowned Anchor": dict(locationType="Pub", description="Low beams, brass and fishing charts.", atmosphere="Warm, watchful", significance="Council meets in the back room"),
    "Town Archive": dict(locationType="Archive", description="A converted chapel schoolroom of filing boxes.", atmosphere="Dust and radiator heat", significance="Holds the harbour ledgers"),
    "Brandt Cannery": dict(locationType="Ruin", description="Burnt-out cannery above the harbour.", atmosphere="Chemical rust, gulls", significance="Burned in 1988"),
    "Cliff Path": dict(locationType="Path", description="Two miles of turf above the drop.", atmosphere="Exposed, salt-bitten", significance="Route between town and lighthouse"),
    "Vance Cottage": dict(locationType="Home", description="Slate-roofed cottage with a blue door.", atmosphere="Tidy and tense", significance="Mara's childhood home"),
    "St Brannoc's Chapel": dict(locationType="Chapel", description="Tiny stone chapel, roof patched with tin.", atmosphere="Cold, still", significance="Marigold memorial plaque"),
    "Gull Rock": dict(locationType="Island", description="Tidal rock a mile out, reachable only at low water.", atmosphere="Birdsong and dread", significance="Where the Marigold went down"),
    "Ferry Landing": dict(locationType="Crossing", description="Concrete slip with a rusting ticket hut.", atmosphere="Transitional, damp", significance="Arrival and departure"),
}
for n, d in CHARS.items():
    write(f"Codex/Characters/{n}.md", dict(type="character", name=n, created=D, modified=D, **d))
for n, d in PLACES.items():
    write(f"Codex/Locations/{n}.md", dict(type="location", name=n, created=D, modified=D, **d))

# ---------------------------------------------------------------- lives
write("Codex/Lives/The sailor.md", dict(type="life", name="The sailor", character=link("Tomas Vance"), number=1, lifeName="The sailor", storyDate="1951..1979", howEnded="Gave up the sea after his first wreck", color="#3e63dd", created=D, modified=D), "Deep-sea crewman out of Falmouth, then master of his own boat.")
write("Codex/Lives/The keeper.md", dict(type="life", name="The keeper", character=link("Tomas Vance"), number=2, lifeName="The keeper", storyDate="1979..1987-11-04", howEnded="Vanished the night the Marigold sank", color="#e5484d", created=D, modified=D), "Keeper of Saltmarrow Light, writing every watch into the ledger.")
# four lives in sequence for a few characters: each starts three days after the last one ends
SEQ_LIVES = {
    "Mara Vance": [
        ("Mara the child", "1989-03-01..1989-03-20", "Grows up at Saltmarrow, learns the tides from her grandmother."),
        ("Mara the diver", "1989-03-23..1989-04-14", "Leaves at eighteen and trains as a marine surveyor in Bristol."),
        ("Mara the surveyor", "1989-04-17..1989-05-30", "Works the wrecks of the coast, never quite going home."),
        ("Mara the keeper", "1989-06-02..1989-07-12", "Comes back to the lighthouse and starts reading the ledger."),
    ],
    "Silas Brandt": [
        ("Silas the deckhand", "1962-05-01..1962-05-18", "A boy on the ferries, unseen by everyone but the keeper."),
        ("Silas the clerk", "1962-05-21..1962-06-09", "Keeps the harbour books and learns what is left out of them."),
        ("Silas the inspector", "1962-06-12..1962-07-04", "Sent to look into the Marigold, and finds he already knew."),
        ("Silas the witness", "1962-07-07..1962-08-01", "Gives the account no one asked for."),
    ],
    "Nell Okafor": [
        ("Nell the apprentice", "1975-09-01..1975-09-15", "Learns to read charts at her aunt's chandlery."),
        ("Nell the navigator", "1975-09-18..1975-10-10", "Plots a course she has not been told to plot."),
        ("Nell the stowaway", "1975-10-13..1975-11-02", "Hides aboard to see where the light goes."),
        ("Nell the lamplighter", "1975-11-05..1975-12-01", "Takes the watch when no one else will."),
    ],
}
for who, lives in SEQ_LIVES.items():
    for i, (title, dates, body) in enumerate(lives, 1):
        write(f"Codex/Lives/{title}.md", dict(type="life", name=title, character=link(who), number=i, lifeName=title, storyDate=dates, created=D, modified=D), body)

# ---------------------------------------------------------------- events
EV = [
    ("Wreck of the Marigold", "1987-11-04", "Gull Rock", ["Tomas Vance", "Oren Voss"], "The trawler Marigold breaks up on Gull Rock in a night storm. Four crew lost, bell never recovered.", "#e5484d"),
    ("Cannery fire", "1988-03-12", "Brandt Cannery", ["Silas Brandt"], "Fire destroys the cannery and the insurance records inside it.", "#f76b15"),
    ("Harbour council vote", "2019-09-18", "The Drowned Anchor", ["Silas Brandt", "Eliot Reyes", "Nell Okafor"], "Vote to sell the headland. Postponed by one week after Nell's article.", "#8e4ec6"),
    ("Storm of the century", "2019-10-30", "Saltmarrow Lighthouse", ["Mara Vance", "Silas Brandt"], "The worst storm in thirty years floods the quay and cuts the road.", "#3e63dd"),
]
for name, date, loc, who, text, col in EV:
    write(f"Codex/Events/{name}.md", dict(type="event", name=name, storyDate=date, location=link(loc), characters=[link(w) for w in who], color=col, created=D, modified=D), text)

# ---------------------------------------------------------------- items
write("Codex/Items/Keeper's ledger.md", dict(type="item", name="Keeper's ledger", description="Leather watch-book, every entry initialled TV, last page torn out.", created=D, modified=D), "Found in the lamp room. The missing page names who was aboard the Marigold.")
write("Codex/Items/Brass key.md", dict(type="item", name="Brass key", description="Hand-filed key on a fishing-line cord.", created=D, modified=D), "Opens the archive's locked cabinet.")
write("Codex/Items/Marigold's bell.md", dict(type="item", name="Marigold's bell", description="Ship's bell stamped MARIGOLD 1962.", created=D, modified=D), "Raised by Pip's grandfather's net in Act 3. Proof of where she sank.")

# ---------------------------------------------------------------- scenes
ACT_LABELS = {"1": "The Return", "2": "The Ledger", "3": "The Storm"}
CH_LABELS = {1: "Ferry Landing", 2: "The Blue Door", 3: "Cold Lamp", 4: "The Harbourmaster", 5: "Missing Page", 6: "The Archive", 7: "Gull Rock", 8: "The Vote", 9: "Brandt's Offer", 10: "The Bell", 11: "Storm Night", 12: "Low Water"}

# (act, chapter, title, status, pov, chars, location, tags, storyDate, mode, conflict, emotion, intensity, target, text)
S = [
 (1,1,"Ferry Landing","final","Mara Vance",["Pip Calloway"],"Ferry Landing",["mystery","family"],"2019-09-14","", "Mara arrives for the inheritance and is not welcome", "wary", 3, 800,
  "The last ferry shouldered into Saltmarrow in the rain, and Mara Vance was the only passenger who stayed on deck to watch the town arrive.\n\nA girl in a yellow coat was sitting on the ticket hut. \"You're the keeper's granddaughter,\" she said. \"Everyone knows. You've his walk.\"\n\nMara hadn't said her name aloud in this harbour in eleven years. She picked up her bag and walked toward the blue door that waited at the end of the quay."),
 (1,2,"The Blue Door","final","Mara Vance",["Ines Vance"],"Vance Cottage",["family"],"2019-09-14","", "Ines forbids her to open the lighthouse", "defensive", 4, 800,
  "Her mother had kept the cottage like a museum of the day Tomas disappeared. Tea set out, two cups, a chair angled toward the window.\n\n\"You'll sign the papers and go back to Bristol,\" Ines said. \"The lighthouse is nothing but damp and bad luck.\"\n\n\"It's mine. He left it to me.\"\n\n\"He left you a locked door,\" said Ines, and turned away to the kettle."),
 (1,3,"Cold Lamp","written","Mara Vance",[],"Saltmarrow Lighthouse",["mystery"],"2019-09-15","", "The tower resists her: salt-swollen doors, no light", "uneasy", 5, 900,
  "The Cliff Path took an hour into the wind. At the foot of the tower the door gave on the fourth shoulder-charge, and the smell of cold iron rolled out over her.\n\nIn the lamp room, under a dust sheet, lay a leather watch-book. Every entry initialled TV. The last page had been torn out, cleanly, with a ruler."),
 (1,4,"The Harbourmaster","written","Mara Vance",["Eliot Reyes"],"Saltmarrow Harbour",["romance","mystery"],"2019-09-16","", "Eliot knows more than he says", "curious", 3, 800,
  "Eliot Reyes ran the harbour from a shed with a kettle and a radio. He didn't ask why she was there; he handed her a mug and said, \"The ledger has a twin. Harbour copy. Agnes keeps it.\"\n\n\"How do you know what's in my ledger?\"\n\n\"I don't,\" he said, a little too quickly. \"I know what's in the town's.\""),
 (2,5,"Missing Page","draft","Nell Okafor",["Mara Vance"],"Saltmarrow Harbour",["mystery"],"2019-09-17","", "Nell wants a story; Mara wants silence", "driven", 4, 900,
  "Nell Okafor had been waiting for a Vance to come home for thirteen years. She laid out the cuttings across the café table like a hand of cards.\n\n\"1987. Four dead, no inquiry. The keeper vanishes the same night and the Courier prints one paragraph.\"\n\nMara slid the torn-edged ledger across. \"Then print this one, when I know what it says.\""),
 (2,6,"The Archive","draft","Mara Vance",["Agnes Pryor"],"Town Archive",["mystery"],"2019-09-18","", "A locked cabinet and a protective archivist", "suspicious", 5, 900,
  "Agnes Pryor stamped everything she touched. \"Harbour ledgers are on request, Miss Vance, and requests take a week.\"\n\n\"I have a key.\" Mara had found it taped inside the ledger's spine.\n\nAgnes looked at the brass key a long time. Then, very quietly, she locked the door behind them both."),
 (2,7,"Gull Rock","outlined","Mara Vance",["Oren Voss"],"Gull Rock",["mystery","family"],"1987-11-04","flashback","Oren tells the night as he saw it", "dread", 8, 1000,
  "Oren Voss rowed her out at low water and told it as though it were happening. The Marigold lit up like a street, the bell tolling, a man on the lighthouse gallery signalling with a lamp.\n\n\"Your grandfather wasn't saving them, girl,\" Oren said. \"He was telling them where to go.\""),
 (2,8,"The Vote","draft","Eliot Reyes",["Silas Brandt","Nell Okafor","Dr. Hale"],"The Drowned Anchor",["development-fight"],"2019-09-18","", "The council is bought, almost", "tense", 6, 900,
  "The back room of the Anchor smelled of wet wool. Silas Brandt spoke without notes, the way men do who have already counted the votes.\n\nNell's article had gone out that morning. By the third speaker Eliot could feel the room tilting; by the fifth, Dr. Hale's hand on the show-of-hands was shaking.\n\n\"One week,\" the chair said. \"We reconvene.\""),
 (3,9,"Brandt's Offer","idea","Mara Vance",["Silas Brandt"],"Brandt Cannery",["development-fight","mystery"],"2019-10-22","", "Money, or the truth", "tempted", 6, 900,
  "Brandt met her in the shell of the cannery, which he had insisted on, and he walked her through it like a man showing off a cathedral.\n\n\"Name a price for the tower. A real one.\"\n\n\"The tower isn't for sale.\"\n\n\"Everything is, Miss Vance. People just need to be asked at the right time of year.\""),
 (3,10,"The Bell","idea","Pip Calloway",["Mara Vance","Eliot Reyes"],"Saltmarrow Harbour",["mystery"],"2019-10-27","", "A child finds proof; adults argue over who owns it", "triumphant", 5, 700,
  "Pip's grandfather had dragged something heavy up in his net, and she ran the whole length of the quay with her yellow coat open like wings.\n\nIt lay on the slip, green with weed. Eliot wiped a thumb across the rim and the letters came through: MARIGOLD 1962."),
 (3,11,"Storm Night","idea","Mara Vance",["Silas Brandt","Eliot Reyes"],"Saltmarrow Lighthouse",["mystery","development-fight","romance"],"2019-10-30","", "Brandt tries to take the ledger in the storm", "terror", 10, 1200,
  "The road went first, then the quay lights. Mara reached the tower with the ledger inside her oilskin and Eliot's torch swinging behind her.\n\nBrandt was already in the lamp room. \"You've read the missing page,\" he said calmly. \"Then you know who rang the bell.\"\n\nShe lit the lamp. For the first time in thirty-two years, the tower looked out."),
 (3,12,"Low Water","idea","Mara Vance",["Ines Vance","Nell Okafor"],"Vance Cottage",["family"],"2019-11-03","", "Telling her mother what she found", "release", 4, 700,
  "At low water the Rock stood clear of the sea, bare and ordinary. Mara sat with her mother in the cottage and told her all of it, without the tea.\n\n\"He kept the secret to keep us out of it,\" Ines said finally.\n\n\"He kept it to keep himself out of it,\" said Mara. \"I think we'll both have to live with both.\""),
]

seq_in_act = {}
scenes_meta = []
for (act, ch, title, status, pov, chars, loc, tags, date, mode, conflict, emo, inten, target, text) in S:
    seq_in_act[act] = seq_in_act.get(act, 0) + 1
    seq = seq_in_act[act]
    words = len(text.split())
    f = dict(type="scene", title=title, act=act, chapter=ch, sequence=seq, status=status, pov=link(pov), characters=[link(c) for c in chars], location=[link(loc)], tags=tags, storyDate=date)
    if mode:
        f["timeline_mode"] = mode
    if title == "The Archive":
        f["storyTime"] = "afternoon"
    if title == "Storm Night":
        f["storyTime"] = "night"
        f["lives"] = [link("The keeper")]
    if title == "Gull Rock":
        f["lives"] = [link("The keeper")]
    f.update(conflict=conflict, emotion=emo, intensity=inten, target_wordcount=target, wordcount=words, charcount=len(text), created=D, modified=D)
    rel = f"Scenes/Act {act}/{act:02d}-{seq:02d} {title}.md"
    write(rel, f, text)
    scenes_meta.append((rel, act, ch, title, pov, chars))

# ---------------------------------------------------------------- project note
acts = [1, 2, 3]
write(f"{os.path.basename(PROJ)}.md", dict(type="storyline", title="Sample Novel", created=D, language="en", bookId=str(uuid.uuid4()), acts=acts, chapters=list(range(1, 13)), chapterLabels={str(k): v for k, v in CH_LABELS.items()}, actLabels=ACT_LABELS), "The Lighthouse Keeper's Ledger. A small worked example for trying every Booker view: three acts, twelve chapters, ten characters and ten places.")

# ---------------------------------------------------------------- scene notes, notes, research
write("SceneNotes/Cold Lamp.md", dict(type="scenenote", scene="Cold Lamp", created=D), "Keep the physical detail heavy here. The ledger is the only warm object in the room.\n\nDo not reveal the torn page's content yet.")
write("SceneNotes/Storm Night.md", dict(type="scenenote", scene="Storm Night", created=D), "Pay off: the brass key, the bell, Eliot's past. Brandt must be defeated by the town's own record, not by force.")
write("Notes/Themes.md", dict(type="note", title="Themes", created=D), "- Inheritance: what we are handed, and whether we accept it.\n- Silence as protection versus silence as harm.\n- The sea as ledger-keeper.")
write("Notes/Open questions.md", dict(type="note", title="Open questions", created=D), "- Who rang the bell on the night of the wreck?\n- Does Eliot know his father was aboard the Marigold?\n- What does Dr. Hale owe Brandt?")
write("Research/Lighthouse keeping.md", dict(type="research", title="Lighthouse keeping", created=D, tags=["research"]), "Keepers stood four-hour watches and logged weather, lamp state and passing vessels. Entries were initialled. Torn-out pages in a watch-book were a dismissal offence.\n\nSource: Trinity House keepers' handbook, 1970s edition.")
write("Research/Tides and Gull Rock.md", dict(type="research", title="Tides and Gull Rock", created=D, tags=["research"]), "Spring tides reach roughly 7 m in this part of Cornwall. A rock like Gull Rock would be walkable for about ninety minutes either side of low water.")
write("Research/Maritime inquiries.md", dict(type="research", title="Maritime inquiries", created=D, tags=["research"]), "A wreck with loss of life normally triggered a Department of Transport inquiry. A missing inquiry is itself a clue.")

# ---------------------------------------------------------------- system json
os.makedirs(f"{BASE}/Archive", exist_ok=True)
os.makedirs(f"{BASE}/System", exist_ok=True)


def sysw(name, data):
    with open(f"{BASE}/System/{name}", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


sysw("plotlines.json", dict(
    tagColors={"mystery": "#3e63dd", "family": "#e5484d", "romance": "#d6409f", "development-fight": "#f76b15"},
    tagTypeOverrides={},
    plotlineDescriptions={
        "mystery": "What happened to Tomas Vance, and what is on the missing page.",
        "family": "Mara and Ines, and what the Vances keep from each other.",
        "romance": "Mara and Eliot: trust built on a shared lie of omission.",
        "development-fight": "Brandt's bid for the headland against the town's memory.",
    }))
sysw("board.json", dict(corkboardPositions={}))
sysw("characters.json", dict(characterAliases={"Mara Vance": ["Mara"], "Tomas Vance": ["Tomas", "Tom"], "Silas Brandt": ["Brandt"], "Eliot Reyes": ["Eliot"], "Nell Okafor": ["Nell"]}, ignoredCharacters=[]))
sysw("custom-sections.json", dict(characterCustomSections=[], locationCustomSections=[], codexCategoryCustomSections={}, codexVisualGroups={}, customLocationTypes=[], codexCustomCategories=[], codexEnabledCategories=["items"]))
sysw("timeline.json", {})
sysw("stats.json", dict(writingTrackerData=dict(history={"2026-10-23": 1850, "2026-10-24": 2400, "2026-10-25": 1120}, revisionHistory={}, changeHistory={}, projectDeadlineIncludeWeekends=False, sprintLog=[])))
sysw("timeline-map.json", dict(
    sources=[{"kind": "character", "name": "Mara Vance"}, {"kind": "character", "name": "Silas Brandt"}, {"kind": "life", "name": "The keeper"}, {"kind": "kind", "name": "event", "color": "#8e4ec6"}],
    merge=False,
    colors={"kind:scene": "#3e63dd", "kind:event": "#8e4ec6", "plotline:mystery": "#3e63dd", "plotline:development-fight": "#f76b15"},
    hidden=["act"]))

# plot grid: one row per scene, columns for four characters and two places
rows, cols, cells = [], [], {}
for rel, act, ch, title, pov, chars in scenes_meta:
    rid = f"r-sample-{act}{ch:02d}"
    rows.append(dict(id=rid, label=f"A{act} · Ch{ch} · {title}", height=80, bgColor="", sourceType="auto", sourceId=f"{PROJ}/{rel}"))
    scenes_meta_row = (rid, rel, title, pov, chars)
    cells[rid] = scenes_meta_row
COLS = [("Mara Vance", "characters"), ("Eliot Reyes", "characters"), ("Silas Brandt", "characters"), ("Nell Okafor", "characters")]
for n, kind in COLS:
    cols.append(dict(id=f"c-sample-{n.split()[0].lower()}", label=n, width=160, bgColor="", sourceType="auto", sourceId=n, sourceKind=kind))
NOTES = {
    ("Mara Vance", "Ferry Landing"): "Arrives, braced for hostility.",
    ("Mara Vance", "Cold Lamp"): "Finds the ledger.",
    ("Mara Vance", "The Archive"): "Uses the brass key.",
    ("Mara Vance", "Storm Night"): "Lights the lamp.",
    ("Eliot Reyes", "The Harbourmaster"): "Hints at the harbour copy.",
    ("Eliot Reyes", "The Vote"): "POV: tallies the room.",
    ("Silas Brandt", "The Vote"): "Pitches the sale.",
    ("Silas Brandt", "Brandt's Offer"): "Offers a price.",
    ("Silas Brandt", "Storm Night"): "Confronts Mara; names the bell-ringer.",
    ("Nell Okafor", "Missing Page"): "Pushes for the story.",
    ("Nell Okafor", "The Vote"): "Her article tilts the room.",
}
real_cells = {}
for rid, (r, rel, title, pov, chars) in cells.items():
    for n, kind in COLS:
        cid = f"c-sample-{n.split()[0].lower()}"
        txt = NOTES.get((n, title), "")
        if txt:
            real_cells[f"{rid}-{cid}"] = dict(id=f"{rid}-{cid}", content=txt, bgColor="", textColor="", bold=False, italic=False, align="left", linkedSceneId=f"{PROJ}/{rel}", manualContent=True)
sysw("plotgrid.json", dict(rows=rows, columns=cols, cells=real_cells, zoom=1, stickyHeaders=True, labelColumnWidth=120, collapsedSections={}))
print("done", len(scenes_meta), "scenes")
