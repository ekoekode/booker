import type { Beat, BeatSheet } from "../project/beats";

/** Outlines for each kind of book other than Fiction (those are in project/beats.ts). Applying one names the parts after it and can add a section for each beat. */

const b = (act: number, label: string, description: string): Beat => ({ act, label, description });
const sheet = (id: string, name: string, summary: string, actLabels: Record<number, string>, beats: Beat[]): BeatSheet => ({ id, name, summary, actLabels, beats });

const SERMON: BeatSheet[] = [
  sheet("sermon-expository", "Expository sermon", "Introduction, the text's points, then application.", { 1: "Introduction", 2: "Body", 3: "Conclusion" }, [
    b(1, "Hook", "Open with a question, story or need that makes people want to hear the text."),
    b(1, "Text and context", "Read the passage; say who wrote it, to whom and why."),
    b(1, "Big idea", "State the one sentence the whole sermon serves."),
    b(2, "Point 1", "The first thing the text says, with the verse that says it."),
    b(2, "Point 2", "The second thing the text says, with the verse that says it."),
    b(2, "Point 3", "The third thing the text says, with the verse that says it."),
    b(2, "Illustration", "A story or picture that makes the hardest point clear."),
    b(3, "Application", "What this asks of the hearer this week."),
    b(3, "Gospel connection", "How the text points to Christ and what he has done."),
    b(3, "Closing and prayer", "Return to the hook, call for a response, pray."),
  ]),
  sheet("sermon-topical", "Topical sermon", "A question, what Scripture says about it, and what to do.", { 1: "The question", 2: "What Scripture says", 3: "What to do" }, [
    b(1, "The question", "The real question or struggle people bring to this topic."),
    b(1, "Why it matters", "What is at stake if we get it wrong."),
    b(2, "Scripture 1", "The first passage, read in context."),
    b(2, "Scripture 2", "A second passage that adds or balances the first."),
    b(2, "Objection", "The honest objection and a short answer."),
    b(3, "Application", "Concrete steps for the week."),
    b(3, "Call to respond", "The invitation: believe, repent, pray, act."),
  ]),
  sheet("sermon-narrative", "Narrative sermon (Lowry loop)", "Tension raised, turned and resolved: Oops, Ugh, Aha, Whee, Yeah.", { 1: "Trouble", 2: "Turn", 3: "Resolution" }, [
    b(1, "Oops", "Upset the equilibrium: show the itch, the problem."),
    b(1, "Ugh", "Analyse the discrepancy; why is it so hard to fix?"),
    b(2, "Aha", "The clue to resolution, usually the text's surprise."),
    b(3, "Whee", "Experience the gospel as the answer."),
    b(3, "Yeah", "Anticipate the consequences for the week ahead."),
  ]),
  sheet("sermon-gospel", "Gospel message", "Creation, fall, redemption, response.", { 1: "The story", 2: "The Saviour", 3: "The response" }, [
    b(1, "God and us", "Who God is and what he made us for."),
    b(1, "The problem", "Sin and its consequences."),
    b(2, "Christ", "What Jesus did: life, death, resurrection."),
    b(2, "Grace", "How the gift is received, not earned."),
    b(3, "Response", "Repent and believe; what that looks like."),
    b(3, "Next step", "A clear, small thing to do today."),
  ]),
];

export const PROFILE_SHEETS: Record<string, BeatSheet[]> = {
  sermon: SERMON,
  "nonfiction-christian": [
    sheet("christian-doctrine", "Doctrinal treatise", "Thesis, Scripture, history, objections, application.", { 1: "Foundation", 2: "Development", 3: "Practice" }, [
      b(1, "Introduction and thesis", "What is claimed and why it matters now."),
      b(1, "Biblical foundation", "The key passages, read in context."),
      b(2, "Historical development", "How the church has understood it."),
      b(2, "Objections and replies", "The strongest objections, answered fairly."),
      b(3, "Application", "What it changes in belief and life."),
      b(3, "Conclusion", "The thesis restated and a closing charge."),
    ]),
    sheet("christian-living", "Teaching book", "Problem, promise, Scripture, stories, practices.", { 1: "The need", 2: "The teaching", 3: "The practice" }, [
      b(1, "Hook story", "A real moment that shows the need."),
      b(1, "The problem", "Name what is wrong and why we miss it."),
      b(2, "What Scripture says", "The central passage and its meaning."),
      b(2, "Examples", "People, past or present, who lived it."),
      b(3, "Practices", "Habits and exercises that put it to work."),
      b(3, "Call to action", "A clear invitation to begin."),
    ]),
  ],
  "nonfiction-history": [
    sheet("history-narrative", "Narrative history", "Context, origins, crisis, turning point, aftermath.", { 1: "Before", 2: "The events", 3: "After" }, [
      b(1, "Setting the scene", "Place, people and the world they lived in."),
      b(1, "Origins", "How the situation came about."),
      b(2, "Rising tension", "The pressures that build."),
      b(2, "Turning point", "The event that changed the course."),
      b(2, "Crisis", "The height of the conflict."),
      b(3, "Aftermath", "What followed in the short term."),
      b(3, "Legacy", "How it has been remembered and what it left."),
    ]),
    sheet("history-argument", "Thematic argument", "A question, the evidence and the answer.", { 1: "The question", 2: "The evidence", 3: "The answer" }, [
      b(1, "The question", "What the book sets out to explain."),
      b(1, "Earlier scholarship", "What others have said and where they fall short."),
      b(2, "Evidence 1", "The first body of sources and what they show."),
      b(2, "Evidence 2", "The second body of sources."),
      b(2, "Counter-evidence", "What cuts against the argument."),
      b(3, "Argument", "The case drawn together."),
      b(3, "Conclusion", "What changes in our understanding."),
    ]),
  ],
  "nonfiction-educational": [
    sheet("lesson-cycle", "Lesson cycle", "Aim, hook, teach, practise, check.", { 1: "Open", 2: "Teach", 3: "Check" }, [
      b(1, "Objectives", "What the learner will be able to do."),
      b(1, "Hook", "A question or problem that starts curiosity."),
      b(2, "Explain", "The idea in plain words."),
      b(2, "Worked example", "One example done step by step."),
      b(2, "Practice", "Exercises, easy to hard."),
      b(3, "Review", "The key points again, short."),
      b(3, "Assessment", "Questions that show whether it stuck."),
    ]),
  ],
  "self-help": [
    sheet("self-help-arc", "Transformation arc", "Pain, promise, method, obstacles, new life.", { 1: "Why change", 2: "How to change", 3: "Staying changed" }, [
      b(1, "The pain", "Where the reader is stuck, in their own words."),
      b(1, "The promise", "What life looks like on the other side."),
      b(2, "The method", "The simple framework the book teaches."),
      b(2, "Steps", "One chapter per step, each with an exercise."),
      b(2, "Obstacles", "What gets in the way, and what to do."),
      b(3, "Habits", "How to keep it going."),
      b(3, "Vision", "A picture of the changed life and an invitation."),
    ]),
  ],
  "bible-study": [
    sheet("study-rhythm", "Weekly study rhythm", "Read, observe, interpret, apply, pray.", { 1: "Read and observe", 2: "Understand", 3: "Respond" }, [
      b(1, "Read", "The passage for the day."),
      b(1, "Observe", "What does the text say? Who, what, where."),
      b(2, "Interpret", "What did it mean to the first readers?"),
      b(2, "Connect", "Where else does Scripture speak to this?"),
      b(3, "Apply", "What will I do about it today?"),
      b(3, "Pray", "A short prayer prompt in response."),
    ]),
  ],
  reference: [
    sheet("reference-entry", "Entry template", "What every entry carries, in order.", { 1: "Entry" }, [
      b(1, "Headword", "The name or term, with variants."),
      b(1, "Definition", "A clear opening statement of what it is."),
      b(1, "Background", "History and context."),
      b(1, "Cross-references", "Related entries to see."),
      b(1, "Sources", "Where the reader can go further."),
    ]),
  ],
  dictionary: [
    sheet("dictionary-entry", "Entry anatomy", "The parts of one dictionary entry.", { 1: "Entry" }, [
      b(1, "Headword", "The word, spelling and pronunciation."),
      b(1, "Part of speech", "Noun, verb and so on."),
      b(1, "Senses", "Numbered meanings, most common first."),
      b(1, "Examples", "A short sentence for each sense."),
      b(1, "Etymology", "Where the word comes from."),
    ]),
  ],
};
