// Common English typos and missing apostrophes. Keys are lowercase.
const FIXES: Record<string, string> = {
  abotu: "about",
  abouta: "about a",
  acheive: "achieve",
  accomodate: "accommodate",
  acount: "account",
  adn: "and",
  agian: "again",
  alot: "a lot",
  alright: "all right",
  amke: "make",
  aparent: "apparent",
  apparant: "apparent",
  aren: "aren't",
  arent: "aren't",
  becasue: "because",
  becuase: "because",
  beacuse: "because",
  beleive: "believe",
  belive: "believe",
  beggining: "beginning",
  calender: "calendar",
  cant: "can't",
  cieling: "ceiling",
  comming: "coming",
  commitee: "committee",
  completly: "completely",
  couldnt: "couldn't",
  definately: "definitely",
  definitly: "definitely",
  didnt: "didn't",
  diffrent: "different",
  doesnt: "doesn't",
  dont: "don't",
  embarass: "embarrass",
  enviroment: "environment",
  existance: "existence",
  familar: "familiar",
  finaly: "finally",
  freind: "friend",
  frmo: "from",
  goign: "going",
  govenment: "government",
  hadnt: "hadn't",
  hasnt: "hasn't",
  havent: "haven't",
  hte: "the",
  htis: "this",
  i: "I",
  "i'd": "I'd",
  "i'll": "I'll",
  "i'm": "I'm",
  "i've": "I've",
  id: "I'd",
  im: "I'm",
  ive: "I've",
  immediatly: "immediately",
  independant: "independent",
  isnt: "isn't",
  jsut: "just",
  knwo: "know",
  konw: "know",
  libary: "library",
  lenght: "length",
  maintainance: "maintenance",
  mispell: "misspell",
  neccessary: "necessary",
  necesary: "necessary",
  noticable: "noticeable",
  occassion: "occasion",
  occured: "occurred",
  occurence: "occurrence",
  ocurred: "occurred",
  peice: "piece",
  posession: "possession",
  prefered: "preferred",
  probaly: "probably",
  probelm: "problem",
  publically: "publicly",
  realy: "really",
  recieve: "receive",
  recieved: "received",
  recomend: "recommend",
  refered: "referred",
  remeber: "remember",
  seperate: "separate",
  shouldnt: "shouldn't",
  somthing: "something",
  succesful: "successful",
  sucess: "success",
  suprise: "surprise",
  taht: "that",
  teh: "the",
  thats: "that's",
  theres: "there's",
  thier: "their",
  thsi: "this",
  tihs: "this",
  tommorow: "tomorrow",
  tomorow: "tomorrow",
  tounge: "tongue",
  truely: "truly",
  untill: "until",
  wasnt: "wasn't",
  weird: "weird",
  wierd: "weird",
  whcih: "which",
  wich: "which",
  wiht: "with",
  whould: "would",
  wouldnt: "wouldn't",
  youre: "you're",
  yuo: "you",
};

delete FIXES.aren;
delete FIXES.alright;
delete FIXES.weird;
delete FIXES.id;

const DELIMITER = /[\s.,!?;:)\]}"]/;
const WORD = /[A-Za-z']+$/;

export type Correction = { start: number; end: number; replacement: string };

function matchCase(original: string, fix: string): string {
  if (original === original.toUpperCase() && original.length > 1) return fix.toUpperCase();
  if (original[0] && original[0] === original[0].toUpperCase()) return fix[0]!.toUpperCase() + fix.slice(1);
  return fix;
}

/**
 * Looks at the text just before the caret. If the user has finished a word with a
 * delimiter and the word is a known typo, returns the range of that word and its fix.
 */
export function correctionAt(text: string, caret: number): Correction | null {
  if (caret < 2) return null;
  const delim = text[caret - 1]!;
  if (!DELIMITER.test(delim)) return null;
  const before = text.slice(Math.max(0, caret - 41), caret - 1);
  const m = WORD.exec(before);
  if (!m) return null;
  const word = m[0].replace(/^'+/, "");
  if (!word) return null;
  const start = caret - 1 - word.length;
  const lead = start > 0 ? text[start - 1]! : " ";
  if (!/[\s("[{]/.test(lead)) return null;
  const fix = FIXES[word.toLowerCase()];
  if (!fix) return null;
  const replacement = word.toLowerCase() === "i" || word.toLowerCase().startsWith("i'") ? fix : matchCase(word, fix);
  if (replacement === word) return null;
  // Include the delimiter so undoing the fix restores "teh " (not "teh") and
  // leaves the caret after the space — typing "x" then yields "teh x".
  return { start, end: caret, replacement: replacement + delim };
}
