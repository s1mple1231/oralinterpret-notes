# Real-Time Interpreting Notes Spec v1

## 1. Goal

This spec defines the output format for a system that listens to live speech and generates interpreter-style notes in real time.

The output is not meeting minutes, not a full transcript, and not polished summarization.

The output must resemble human consecutive/simultaneous interpreting notes:

- compressed
- structural
- symbol-heavy
- recall-oriented
- easy to scan in 1-2 seconds

Primary use case:

- help an interpreter retain meaning and reproduce speech
- support short-lag oral reformulation
- reduce memory load during live listening

## 2. Design Principles

The system must follow these principles:

- Meaning first: preserve message logic, not wording.
- Compression first: omit low-value function words whenever possible.
- Recall first: notes should trigger memory, not explain everything.
- Structure first: show relations between ideas explicitly.
- Real-time first: produce useful partial notes before the sentence fully ends.
- Editable first: allow later correction when upstream ASR changes.

## 3. Non-Goals

The system must not default to:

- full-sentence paraphrase
- complete grammar
- polished written Chinese or English
- article-style summary
- speaker attribution on every line unless needed
- filler words such as "well", "you know", "I mean"

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
funding / impl.
```

## 4. Output Unit

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

- 4 to 18 visible tokens

Hard limit:

- 30 visible tokens unless the content is a named entity or technical phrase

## 5. Canonical Visual Form

The default visual form should be short stacked lines, not paragraphs.

Example:

```text
govt plan
-> next 3y

focus:
infra / jobs / AI

if budget no pass
-> delay risk
```

Formatting rules:

- one idea per line
- blank lines allowed between clusters
- indentation allowed for subordination
- no bullet punctuation required
- no ending period
- keep casing lightweight and consistent

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

## 8. Logic Markers

The system should normalize logical relations into compact markers.

Preferred markers:

- cause: `b/c`
- result: `->`
- contrast: `but`
- concession: `although`
- condition: `if`
- purpose: `for`
- addition: `+`
- parallel items: `/`
- uncertainty: `?`
- increase: `up`
- decrease: `down`
- improvement: `+`
- deterioration: `-`
- equals / definition: `=`
- versus: `vs`
- leads to / therefore: `->`

Rules:

- prefer one marker family consistently
- avoid mixing too many synonymous markers
- use arrows for directional relations
- use `?` for doubt, unresolved issue, missing detail, or challenge

## 8.1 Extended Symbol Inventory

In addition to the default logic markers, the system may use the following compact symbols when they improve recall speed and do not create ambiguity:

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
- `?` = question, doubt, unresolved issue
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
- if a symbol is rare or domain-specific, anchor it once with nearby text
- symbols should shorten recall time, not create a decoding puzzle

## 9. Compression Rules

The system should compress aggressively using the following rules:

- omit articles unless contrastive
- omit copulas unless needed for clarity
- omit repeated subject if locally recoverable
- collapse long noun phrases into headword + key modifier
- prefer stems over inflected forms
- prefer domain abbreviations when common
- merge repeated frames across adjacent lines

Examples:

- "the company is planning to expand production in Southeast Asia next year"
  -> `co plan expand SEA / next yr`

- "because demand in Europe has fallen sharply"
  -> `b/c EU demand down sharp`

- "this may create serious pressure on small exporters"
  -> `may -> small exporters pressure`

## 9.1 Abbreviation Rules

The system may use four abbreviation strategies:

1. Existing standard abbreviations

- UN, UNICEF, UNESCO, APEC, ASEAN, GDP, GNP, WTO, IMF, ROI, JV

2. Single-letter or compact time/entity codes

- `y` = year
- `m` = month
- `d` = day
- `K` = Korea when locally established
- `5YP` = Five-Year Plan

3. Constructed English shorthand

- retain first few letters: `resp` = responsibility, `info` = information
- retain first and last letters when still recoverable
- remove vowels if the result stays readable: `bcs` = because, `blv` = believe, `rgrds` = regards
- preserve first syllable or stable stem where safer than over-compression

4. Constructed Chinese shorthand

- one Chinese character may stand for a repeated institutional phrase or concept
- acceptable style examples:
  - 社保 = 社会保障体系
  - 野区 = 野生动物保护区
  - 国标 = 国民经济发展指标 / 国家标准 depending on session context
  - 粤府 = 广东省人民政府
  - 物精 = 物质文明与精神文明
  - 改开 = 改革开放
  - 4M = 四个现代化

Rules:

- only shorten when the result is still easy to recover on reread
- preserve one stable abbreviation per repeated concept in a session
- if multiple possible meanings exist, prefer the safer or fuller form
- keep names, money, percentages, and dates more exact than ordinary nouns

## 9.2 Time and Sequence Shortcuts

Compact time marks are encouraged when obvious:

- `LY` or `y-1` = last year
- `NY` or `y+1` = next year
- `m+1` = next month
- `d-1` = previous day

The time marker may appear before or after the anchor term as long as scan speed is preserved.

## 10. Language Style

The default language style is mixed shorthand, not pure prose.

Recommended defaults:

- output may mix Chinese keywords, English stems, numbers, and symbols
- technical terms may remain in source-language form if shorter or safer
- named entities should remain stable across updates
- use Chinese for general connectors only if the whole style is Chinese-leaning

Recommended v1 modes:

- `mixed`: Chinese keywords + English abbreviations + symbols
- `en_short`: English-heavy shorthand
- `zh_short`: Chinese-heavy shorthand

Default mode for v1:

- `mixed`

Example in mixed mode:

```text
US
-> tariff maybe up

b/c dom. pressure
election factor +

CN concern:
supply chain / cost / timing
```

The mixed mode may also include compact Sino-English shorthand such as:

```text
UK-CN rel >
but trust <

社保 reform
粤府 support √
国标 still ?
```

## 11. Entity Handling

Entities must be treated as anchors.

Rules:

- do not over-compress personal names
- preserve numbers exactly when confidence is high
- preserve currency unit, time unit, and percentage sign
- keep one stable short form per entity within a session
- if ASR confidence is low, mark uncertain entity with `?`

Examples:

- `International Monetary Fund` -> `IMF`
- `World Trade Organization` -> `WTO`
- `3.8 billion dollars` -> `$3.8bn`
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
- `an increase of 2.4 million` -> `+2.4m`
- `less than 10 days` -> `<10d`

## 13. Hierarchy Rules

Hierarchy should reflect discourse structure.

Allowed structures:

- top line for main point
- indented line for support
- sibling lines for enumeration
- isolated line for warning or question

Example:

```text
energy reform
  -> price lib.
  -> subsidy cut

risk:
  public backlash
  inflation up
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
- normalize wording
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

Bad:

```text
The speaker discussed the challenges and opportunities involved in the reform process.
```

Good:

```text
reform
+ opp.
- challenge

key:
funding / timing / local buy-in
```

## 16. Confidence Marking

The system may expose uncertainty compactly.

Preferred markers:

- uncertain token: `?`
- low-confidence relation: `-> ?`
- unresolved number: `20?`
- possible name: `Zhang?`

Rules:

- mark uncertainty only where needed
- do not flood the note with confidence labels
- uncertain marks should be easy to remove on later updates

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
- `supply chain resilience` -> `SC resil.`

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
- compress aggressively
- prefer memory cues over grammatical completeness
- output partial notes early and refine later

The prompt should also include a small style table, a few positive examples, and a few negative examples.

## 20. Evaluation Criteria

The output should be evaluated on:

- recall usefulness
- logical clarity
- compression quality
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
- mixed shorthand mode
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

"If we fail to reach an agreement this month, the project could be delayed by at least six months, and that would increase costs significantly."

Target notes:

```text
if no deal / this mo
-> proj delay >=6m
-> cost up sig.
```

### Example B

Source:

"The minister acknowledged the risks, but insisted that the reform remains necessary for long-term competitiveness."

Target notes:

```text
minister:
risk yes
but reform still nec.

for LT competitiveness
```

### Example C

Source:

"Last year exports fell by 12 percent, mainly because demand in Europe weakened and shipping costs rose."

Target notes:

```text
LY exports -12%

b/c
EU demand down
shipping cost up
```

## 23. Acceptance Rule

If output can be read as a normal written note for outsiders, it is probably not compressed enough.

If output helps a listener reconstruct meaning quickly with minimal reading, it is closer to the target.
