/**
 * A small built-in list of plain words and richer words (SAT-level and other high-register vocabulary) that can stand in for them.
 * Used by the optional word suggestions. Each line is "plain: richer, richer, …".
 */
const LIST = `
angry: furious, irate, incensed, indignant
anger: wrath, ire, fury, indignation
afraid: apprehensive, fearful, timorous, daunted
ashamed: abashed, chagrined, mortified, contrite
awful: dreadful, abhorrent, atrocious, appalling
bad: deplorable, dire, abysmal, egregious
beautiful: resplendent, exquisite, comely, radiant
begin: commence, embark, initiate, inaugurate
big: immense, colossal, formidable, vast
boring: tedious, monotonous, insipid, prosaic
brave: valiant, intrepid, undaunted, dauntless
bright: luminous, radiant, brilliant, effulgent
careful: meticulous, scrupulous, circumspect, prudent
careless: negligent, cavalier, remiss, heedless
change: alter, transform, metamorphose, modify
clean: immaculate, pristine, spotless, unblemished
clear: lucid, evident, transparent, unambiguous
clever: astute, shrewd, ingenious, perspicacious
cold: frigid, glacial, bleak, wintry
confuse: bewilder, perplex, baffle, befuddle
cruel: callous, ruthless, merciless, savage
dark: gloomy, murky, tenebrous, shadowy
dead: lifeless, deceased, defunct, inanimate
destroy: demolish, obliterate, annihilate, devastate
difficult: arduous, formidable, onerous, strenuous
dirty: filthy, squalid, grimy, sordid
dull: lackluster, drab, monotonous, tedious
easy: effortless, facile, simple, undemanding
empty: vacant, hollow, barren, desolate
end: conclude, culminate, terminate, cease
enough: sufficient, ample, adequate, plentiful
fake: spurious, counterfeit, sham, feigned
fast: swift, expeditious, fleet, rapid
fat: corpulent, portly, stout, obese
fear: dread, trepidation, apprehension, terror
fight: skirmish, altercation, combat, wrangle
fix: remedy, rectify, repair, mend
foolish: imprudent, inane, ill-advised, fatuous
friendly: amiable, cordial, affable, genial
funny: droll, comical, whimsical, humorous
get: obtain, acquire, procure, attain
give: bestow, confer, grant, impart
good: exemplary, commendable, admirable, superb
great: magnificent, eminent, sublime, extraordinary
greedy: avaricious, rapacious, covetous, grasping
happy: elated, jubilant, content, blissful
hard: arduous, rigid, rigorous, demanding
hate: loathe, abhor, detest, despise
help: assist, aid, abet, succor
hide: conceal, secrete, cloak, obscure
honest: candid, forthright, upright, sincere
huge: immense, enormous, gargantuan, colossal
hurry: hasten, expedite, scurry, rush
idea: notion, concept, conception, inkling
important: crucial, paramount, vital, consequential
increase: augment, amplify, escalate, burgeon
jealous: envious, covetous, resentful, grudging
kind: benevolent, compassionate, gracious, magnanimous
lazy: indolent, slothful, lethargic, idle
leave: depart, abandon, forsake, withdraw
lie: fabrication, falsehood, deception, untruth
like: relish, cherish, savor, favor
little: diminutive, minute, meager, modest
look: gaze, behold, regard, scrutinize
loud: boisterous, deafening, clamorous, raucous
lucky: fortunate, auspicious, providential, serendipitous
make: fashion, construct, forge, devise
mean: malicious, spiteful, unkind, ignoble
mix: blend, mingle, amalgamate, intermingle
mistake: blunder, error, lapse, fallacy
new: novel, pioneering, fresh, unprecedented
nice: pleasant, agreeable, amiable, delightful
noisy: clamorous, cacophonous, rowdy, strident
odd: peculiar, eccentric, anomalous, singular
old: ancient, antiquated, archaic, venerable
part: portion, segment, fragment, component
pretty: comely, attractive, elegant, charming
proud: haughty, arrogant, dignified, lofty
quick: swift, prompt, brisk, nimble
quiet: tranquil, hushed, serene, subdued
rich: affluent, opulent, wealthy, prosperous
rude: impertinent, insolent, boorish, discourteous
sad: despondent, melancholy, forlorn, sorrowful
say: declare, assert, proclaim, utter
scared: petrified, terrified, apprehensive, alarmed
see: perceive, observe, discern, behold
show: demonstrate, exhibit, reveal, display
shy: timid, reticent, diffident, bashful
sick: ailing, infirm, unwell, indisposed
silly: frivolous, absurd, ludicrous, inane
slow: sluggish, leisurely, languid, plodding
small: minuscule, diminutive, minute, slight
smart: astute, shrewd, intelligent, discerning
smell: aroma, scent, odor, fragrance
sorry: remorseful, penitent, contrite, apologetic
strange: peculiar, bizarre, uncanny, anomalous
strong: robust, formidable, potent, resilient
stubborn: obstinate, intransigent, tenacious, obdurate
stupid: obtuse, witless, vacuous, inane
sure: certain, unwavering, convinced, assured
take: seize, grasp, procure, appropriate
talk: converse, discourse, confer, orate
tell: recount, narrate, inform, divulge
thin: slender, lean, gaunt, svelte
tired: weary, fatigued, exhausted, drained
trick: ruse, ploy, subterfuge, artifice
try: attempt, endeavor, strive, venture
ugly: unsightly, hideous, grotesque, repugnant
use: employ, utilize, wield, exploit
want: desire, crave, covet, yearn
warm: balmy, genial, cordial, temperate
weak: feeble, frail, enervated, infirm
wise: sagacious, prudent, judicious, sage
wrong: erroneous, mistaken, improper, amiss
`;

const MAP = new Map<string, string[]>();
for (const line of LIST.split("\n")) {
  const i = line.indexOf(":");
  if (i < 0) continue;
  MAP.set(line.slice(0, i).trim(), line.slice(i + 1).split(",").map((x) => x.trim()).filter(Boolean));
}

/** Every richer word on the list, for checking a dictionary's synonyms against. */
export const HIGH_WORDS: Set<string> = new Set([...MAP.values()].flat());

/** Richer words for a plain one, from the built-in list; the typed word's capital letter is kept. Empty when the list has nothing. */
export function vocabFor(word: string, extra: string[] = [], limit = 4): string[] {
  const key = word.toLowerCase();
  const own = MAP.get(key) ?? [];
  // the dictionary's synonyms only count when they are on the richer list too, so ordinary words are never offered
  const more = extra.filter((x) => HIGH_WORDS.has(x) && x !== key);
  const all = [...new Set([...own, ...more])].slice(0, limit);
  return /^[A-Z]/.test(word) ? all.map((x) => x[0].toUpperCase() + x.slice(1)) : all;
}

export const vocabSize = () => MAP.size;

/**
 * Words to try in place of a richer word that is already written: the other richer words listed for the same plain word, then the dictionary's own
 * synonyms of this word. Empty when the word is not on the richer list.
 */
export function richFor(word: string, synonyms: string[] = [], limit = 6): string[] {
  const key = word.toLowerCase();
  if (!HIGH_WORDS.has(key)) return [];
  const sib: string[] = [];
  for (const [, alts] of MAP) if (alts.includes(key)) sib.push(...alts.filter((a) => a !== key));
  const all = [...new Set([...sib, ...synonyms.filter((x) => x !== key && !x.includes(" "))])].slice(0, limit);
  return /^[A-Z]/.test(word) ? all.map((x) => x[0].toUpperCase() + x.slice(1)) : all;
}
