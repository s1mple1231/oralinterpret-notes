# Real-Time Interpreting Notes Spec v1

## 1. Goal

This spec defines the output format for a system that listens to live speech and generates interpreter-style notes in real time.

The output is not meeting minutes, not a full transcript, and not polished summarization.

The primary target style is **mainstream English consecutive-interpreting note-taking for business speeches, presentations, and formal remarks**, with medium compression, explicit logic, stable professional shorthand, and enough retained detail for reliable rereading.

Primary use case:

- help an interpreter retain meaning and reproduce speech
- support short-lag oral reformulation
- reduce memory load during live listening

## 2. Core Design Principles

The system must follow these principles:

- Meaning first: preserve message logic, not wording.
- Compression with readability: drop low-value function words and listed prepositions by default, while keeping enough noun/verb detail for reliable reconstruction.
- Noun/verb first: prefer event skeletons built from nouns and verbs rather than preposition-heavy phrasing.
- Nouns and verbs are primary anchors and should be preserved more reliably than prepositions.
- Anchor preservation: the core noun and core verb of each important idea must remain present, even if expressed as a symbol, abbreviation, or shortened word.
- Quantity integrity: preserve quantity units and classifiers together with the number.
- Recall first: notes should trigger memory, not explain everything.
- Structure first: show relations between ideas explicitly.
- Real-time first: produce useful partial notes before the sentence fully ends.
- Editable first: allow later correction when upstream ASR changes.
- Business-note first: when multiple shorthand styles are possible, prefer the compact business/consecutive style defined below.

## 3. Non-Goals

The system must not default to:

- full-sentence paraphrase
- complete grammar
- polished written Chinese or English
- article-style summary
- speaker attribution on every line unless needed
- filler words such as "well", "you know", "I mean"
- diary-like prose or smooth explanatory text for outsiders

Bad output example:

```text
The speaker said that the European Union hopes to achieve a 55 percent emissions reduction target by 2030, but there are disagreements among member states regarding funding and implementation.
```

Target-style output:

```text
EU
-> 2030 tgt
CO2 -55%

MS differ
funding / impl
```

## 4. Overall Layout Rules

This project should follow the mainstream consecutive-interpreting layout standard:

1. **Vertical note flow**

- write one sense group per line
- do not write full sentences across one long line
- split main clause, support, condition, cause, and contrast into separate lines when possible

2. **Left alignment**

- every note starts from the left
- do not center or right-align note content
- in handwritten practice, the right side is reserved for 补充 / 修正; in product form, keep the rendering visually left-anchored

3. **One semantic unit per line**

- each line should carry one idea, one action, one relation, or one anchor
- a semantic unit should not be awkwardly split across multiple lines

4. **No prose blocks**

- stacked lines are the default visual form
- blank lines are allowed only between clusters, not between every note item

## 5. Output Unit

The core output unit is the note line.

Each note line should represent one of:

- a main claim
- a supporting point
- a contrast
- a condition
- a cause
- a result
- a number/time/name anchor
- an unresolved question

Preferred line length:

- 8 to 24 tokens

Soft upper limit:

- 30 visible tokens

Hard limit:

- 36 visible tokens unless the content is a named entity or technical phrase

## 6. Information Priority

When compression is necessary, preserve information in this order:

1. numbers, dates, percentages, money
2. names, places, institutions
3. predicate and event
4. logic relation
5. stance or modality
6. modifiers
7. rhetorical padding

If latency is high or ASR is unstable, keep only items 1-4.

When readability would otherwise collapse, preserve a little more of items 5-6 instead of over-compressing into cryptic fragments.

When the action target, affected party, or practical outcome is central, preserve that extra layer of detail instead of collapsing the note into a bare headline.

When a claim depends on its reason, method, or consequence, preserve that supporting layer instead of reducing the note to a vague headline.

## 7. Required Semantic Elements

The system should try to preserve the following whenever present:

- who did or wants what
- what changed
- why
- under what condition
- with what consequence
- compared with what baseline
- when
- how much
- whether the speaker is certain, doubtful, supportive, critical, warning, or proposing

## 8. Core Logic Marker System

This project should prefer the following compact marker family as the **default business interpreting note system**:

- addition / and / also: `+`
- action / direction / address / operate / lead to: `->`
- place / affiliation / in / at / based in / worked for: `@`
- contrast / however / although / but: `∥` or `but`
- comparison greater / better / larger: `>`
- comparison smaller / worse / less: `<`
- uncertainty / problem / unresolved point: `?` (rare use only)
- emphasis / key point: `❗`
- equality / equivalent / same as: `=`

Recommended supporting markers:

- cause: `b/c` or `∵`
- result / therefore: `->` or `∴`
- parallel items: `/`
- versus: `vs`
- approximate: `≈`
- more-or-equal: `≥`
- less-or-equal: `≤`
- not equal / mismatch: `≠`

Rules:

- prefer one consistent marker family within one session
- do not mix too many synonymous markers
- use symbols instead of full conjunction words when the relation is obvious
- use `?` only on genuinely unclear tokens or relations that cannot be safely omitted

## 8.1 Extended Symbol Inventory

In addition to the default logic markers, the following symbols are allowed when they clearly improve recall speed:

- `×` = wrong, bad, incorrect, rejected, notorious
- `>` = more than, better than, surpass, increasingly
- `<` = less than, fewer than, worse than, inferior to
- `≥` = more than or equal to
- `≤` = less than or equal to
- `=` = equal, same as, match
- `≠` = not equal, no match
- `≈` = approximately, around
- `∵` = because, due to
- `∴` = therefore, consequently, as a result
- `?` = question, doubt, unresolved issue, but should be used sparingly
- `√` = correct, affirmative, agreed, supported
- `☆` = excellent, best, model, important
- `:` = say, speak, tell, declare, protest, such as, like
- `○` = meeting, conference, seminar, negotiation
- `∪` = agreement, accord, treaty, contract
- `&` = together with, accompany, and
- `~` = exchange, replace, mutual
- `//` = stop, halt, suspend
- `{ }` = include, within, enclosed set
- `☺` = happy, pleased, delighted
- `☹` = sad, regretful
- `><` = confrontation, conflict

Rules:

- do not force symbols where a short word is clearer
- prefer stable reuse of the same symbol family within one session
- symbols should shorten recall time, not create a decoding puzzle

## 9. Compression Rules

The system should compress using the following rules:

- omit articles: `a`, `an`, `the`
- do not record simple low-value function words: `of`, `for`, `to`, and similar fillers
- do not record prepositions such as `of`, `for`, `to`, `in`, `at`, `on`, `by`
- omit tense marking and voice marking
- do not drop units or classifiers attached to numbers
- core noun and verb content must survive compression even when rewritten into symbols, abbreviations, or stable stems
- omit repeated subject if locally recoverable
- collapse long noun phrases into headword + key modifier
- preserve center noun + core adjective only
- avoid rewriting ideas into polished clauses
- if content repeats, record the core only once
- do not over-compress to the point that the note no longer preserves who did what, key stance, or main outcome
- preserve short verbs and compact predicate structure when they are necessary for rereading
- preserve compact object phrases and affected targets when they are necessary for rereading
- preserve short support phrases for reason, method, and consequence when they are necessary for rereading
- prefer noun + verb skeletons over preposition chains whenever possible
- if forced to choose, drop prepositions before dropping the core noun or verb
- symbol shorthand may replace surface wording, but it must still preserve the noun/verb anchor
- treat listed prepositions as removable noise rather than note-bearing content

Examples:

- `It is a great honor for me to address you`
  -> `honor -> speak`

- `the most exciting, most dynamic, most interesting market`
  -> `market: most exciting, dynamic, interesting`

- `because demand in Europe has fallen sharply`
  -> `b/c EU demand down sharp`

## 9.1 Abbreviation Rules

The system should use four main abbreviation strategies, in this priority order:

### 1. Fixed established abbreviations first

- UN, UNICEF, UNESCO, APEC, ASEAN, GDP, GNP, WTO, IMF, ROI, JV
- PG = Procter & Gamble
- CN = China
- US = United States
- GD = Guangdong
- Pres = President

### 2. Time / number shorthand

- `y` = year
- `m` = month
- `d` = day
- `yr` / `yrs` = year / years
- `LY` = last year
- `NY` = next year
- `5YP` = Five-Year Plan
- `bln` = billion
- `mln` = million
- keep `RMB` unchanged
- keep all numbers in Arabic numerals

### 3. Constructed English shorthand

Use stable business-style clipping:

- `innov` = innovation
- `cat` = category
- `prod` = product
- `biz` = business
- `oper` = operate
- `run` = run / operate
- `resp` = responsibility
- `info` = information

Allowed methods:

- retain first few letters
- retain first and last letters when still recoverable
- preserve first syllable or stable stem when safer than over-compression

### 4. Constructed Chinese shorthand

Chinese compression is allowed when stable and decodable on reread:

- `社保`
- `野区`
- `国标`
- `粤府`
- `物精`
- `改开`
- `4M`

Rules:

- only shorten when the result is still easy to recover
- preserve one stable abbreviation per repeated concept in a session
- names, money, percentages, and dates must stay more exact than ordinary nouns

## 9.2 Time and Sequence Shortcuts

Compact time marks are encouraged:

- `LY` or `y-1` = last year
- `NY` or `y+1` = next year
- `m+1` = next month
- `d-1` = previous day

For fixed dates, preserve direct compact form:

- `Aug 8,1988`
- `2025-27`

## 10. Language Style

The primary style for this project is:

- business/conference consecutive note style
- English-heavy shorthand for English speeches
- mixed shorthand allowed when it improves recall

Default mode:

- `mixed`, but biased toward the user-provided business-note system above

That means:

- use Chinese keywords if shorter and safer
- use English abbreviations when they are standard or efficient
- do not force fully Chinese or fully English output
- keep named entities stable

## 11. Entity Handling

Entities must be treated as anchors.

Rules:

- do not over-compress personal names
- preserve numbers exactly when confidence is high
- preserve currency unit, time unit, and percentage sign
- preserve count classifiers and quantity units such as `次`, `年`, `个`, `家`, `项`, `倍`
- keep one stable short form per entity within a session
- if ASR confidence is low, mark uncertain entity with `?` only when that uncertainty is important to preserve

Examples:

- `International Monetary Fund` -> `IMF`
- `World Trade Organization` -> `WTO`
- `3.8 billion RMB` -> `3.8 bln RMB`
- uncertain name -> `Miller?`

## 12. Number Policy

Numbers are high priority and should be visually salient.

Rules:

- preserve exact number if available
- use normalized short forms when safe
- keep sign and unit
- do not rewrite relative comparisons into vague words

Examples:

- `35 percent` -> `35%`
- `between 2025 and 2027` -> `2025-27`
- `an increase of 2.4 million` -> `+2.4 mln`
- `less than 10 days` -> `<10d`
- `thirty four billion RMB` -> `34 bln RMB`

## 13. Hierarchy Rules

Hierarchy should reflect discourse structure.

Allowed structures:

- top line for main point
- indented line for support
- sibling lines for enumeration
- isolated line for warning or question

Example:

```text
PG run 30yrs
  @ GD
  est Aug 8,1988

CN
2nd largest biz ex US
Last yr turnover: 34 bln RMB
```

Hierarchy constraints:

- maximum indentation depth: 2
- avoid deeply nested tree structures
- when structure is unclear, prefer flat lines over false hierarchy

## 14. Update Behavior for Streaming

The system should produce notes in passes.

Pass 1: provisional fragment

- low latency
- may be incomplete
- focus on anchor words and relation

Pass 2: stabilization

- fill in missing predicate or relation
- normalize shorthand
- merge duplicates

Pass 3: correction

- revise prior line if ASR changed materially
- avoid unnecessary churn

Update rules:

- do not rewrite stable lines unless needed
- prefer append or patch, not full re-render
- if a line is revised, preserve visual continuity when possible

## 15. Anti-Summary Rules

The system must avoid drifting into generic summarization.

Reject these tendencies:

- explanatory full sentences
- discourse-polished transitions
- abstract labels with no anchors
- omitting numbers in favor of vague summaries
- replacing speaker stance with neutral wording
- complete sentence copying from the source
- keyword dumping with too little relation or predicate information to reconstruct meaning
- excessive shortening that removes the policy target, business object, or result anchor
- over-pruning of support detail that makes adjacent points hard to distinguish

Bad:

```text
The speaker discussed the challenges and opportunities involved in the reform process.
```

Good:

```text
reform
+ opp
- challenge

key:
funding / timing / local buy-in
```

## 16. Confidence Marking

The system may expose uncertainty compactly, but should avoid doing so unless necessary.

Preferred markers:

- uncertain token: `?` (rare)
- low-confidence relation: `-> ?` (rare)
- unresolved number: `20?` (rare)
- possible name: `Zhang?` (rare)

Rules:

- mark uncertainty only where absolutely needed
- do not flood the note with confidence labels
- uncertain marks should be easy to remove on later updates
- ordinary risk, pressure, difficulty, or pending discussion should usually be written directly without `?`

## 17. Domain Adaptation Hooks

The system should support session-level customization:

- glossary
- user abbreviation table
- preferred note language mode
- forbidden expansions
- preferred symbol set
- speaker/topic profile

Examples of custom mappings:

- `artificial intelligence` -> `AI`
- `carbon border adjustment mechanism` -> `CBAM`
- `supply chain resilience` -> `SC resil`

## 18. Output Schema

Recommended internal schema for each rendered line:

```json
{
  "id": "line_102",
  "text": "if rates up -> housing pressure",
  "status": "stable",
  "indent": 0,
  "speaker": "spk1",
  "source_span_ms": [182000, 188400],
  "confidence": 0.83,
  "revision_of": null,
  "semantic_type": "condition_result"
}
```

Allowed `status` values:

- `draft`
- `stable`
- `revised`

Suggested `semantic_type` values:

- `claim`
- `support`
- `contrast`
- `condition`
- `cause`
- `result`
- `number_anchor`
- `question`
- `stance`

## 19. Prompting Guidance for Generation

The note generator prompt should explicitly instruct:

- write interpreter-style notes, not summary prose
- use one idea per line
- preserve numbers and names
- show logic with symbols
- compress, but keep enough actor/action/outcome information for rereading
- preserve object/target/result information when omission would make the note vague
- preserve reason/method/consequence information when omission would make the point incomplete
- prefer memory cues over grammatical completeness
- output partial notes early and refine later
- prefer the business-note shorthand system in sections 4-9

## 20. Evaluation Criteria

The output should be evaluated on:

- recall usefulness
- logical clarity
- compression quality
- readability on delayed reread
- object/action clarity
- support-detail clarity
- number retention
- entity retention
- low-latency usefulness
- stability under streaming revision
- similarity to interpreter note habits

Suggested scoring questions:

- Can a trained interpreter reconstruct the message from the notes?
- Are key numbers and names preserved?
- Is the relation between ideas explicit?
- Are lines short enough to scan instantly?
- Does the output avoid summary prose?

## 21. V1 Product Scope Recommendation

For a practical v1, the system should support:

- single active speaker priority
- 1-3 second update cadence
- mixed shorthand mode with business-note bias
- glossary injection
- line revision for ASR corrections
- optional side-by-side transcript and notes

The system should not require in v1:

- handwriting simulation
- personalized symbol learning from scratch
- perfect diarization
- fully automatic bilingual reformulation

## 22. Example Gold Outputs

### Example A

Source:

`Procter & Gamble has been operating for thirty years. And we started here in Guangdong, August eight, nineteen eighty eight.`

Target notes:

```text
PG run 30yrs
@ GD
est Aug 8,1988
```

### Example B

Source:

`China is our second largest business outside the US. Last year we turned over thirty four billion RMB.`

Target notes:

```text
CN:
2nd largest biz ex US
Last yr turnover: 34 bln RMB
```

### Example C

Source:

`It is my great honor to operate here in China.`

Target notes:

```text
honor -> oper @ CN
```

### Example D

Source:

`If we fail to reach an agreement this month, the project could be delayed by at least six months, and that would increase costs significantly.`

Target notes:

```text
if no deal / this mo
-> proj delay >=6m
-> cost up sig
```

## 23. Acceptance Rule

If output can be read as a normal written note for outsiders, it is probably not compressed enough.

If output helps a listener reconstruct meaning quickly with minimal reading, it is closer to the target.
