# Action Item Verifier

AI notetakers sometimes write action items that nobody agreed to. Circleback's own guide,
[How Circleback writes meeting notes and how to check them](https://circleback.ai/blog/how-circleback-writes-meeting-notes),
asks users to check each one by hand: confirm the owner is a real person, then find the
matching moment in the transcript. This project does those checks automatically.

Each action item gets one label:

| Label | Meaning |
|---|---|
| **Supported** | The owner clearly agreed. Shows the exact quote and a link to that moment. |
| **Weak** | It was discussed, but nobody committed. |
| **Unsupported** | Nothing in the transcript backs it, or the transcript says the opposite. |
| **Owner not confirmed** | Someone else committed, the owner said no, the owner wasn't on the call, or the speaker is unnamed, such as "Participant 4". |

Built with Circleback's stack: TypeScript, Next.js, React, Tailwind, Prisma, and Postgres or SQLite.

## Quick start

```bash
npm install
cp .env.example .env        # add OPENAI_API_KEY to use the AI judge
npm run dev                 # http://localhost:3000
```

You don't need any keys to try it. The app ships with 3 sample meetings and an offline judge.

```bash
npm test                          # unit tests for the guardrails and labels
npm run eval                      # score the offline judge against hand labels
npm run eval -- --judge openai    # score the AI judge (needs OPENAI_API_KEY)
npm run verify -- m2              # verify one meeting in the terminal
```

## How it works

```
Circleback API ──► Meeting (transcript segments + action items)
                     │
                     ├─ owner.ts     Is the assignee on the invite, a speaker, or "Participant N"?
                     ├─ retrieve.ts  BM25 search over transcript lines, so long meetings stay small
                     ├─ judge        LLM (or offline heuristic) reports facts with exact quotes
                     └─ decide.ts    Code checks every quote and picks the label
```

The key design choice is that **the model never picks the label**. It only reports facts:
was the task discussed, which line holds a commitment, and which line has the owner agreeing,
each with a quote copied from the transcript. Then `decide.ts` applies plain rules:

1. Any quote that isn't found word for word in the segment it cites is dropped.
2. A claimed commitment with no segment cited is downgraded.
3. The owner only "agreed" if the agreeing line was spoken by the owner.
4. With no verified evidence left, the item is Unsupported.

A model that makes up a quote can't produce a Supported label. That's the same problem
this tool checks for in meeting notes, so the verifier holds itself to the same rule.

## Evaluation

`data/ground-truth.json` holds hand labels for the 17 sample action items. The samples include
planted mistakes: invented tasks, a discount the rep refused to promise, a task volunteered
for someone who said "let me check my calendar", an unnamed "Participant 4" owner, and an
owner who wasn't on the call.

Offline heuristic baseline (`npm run eval`):

- Accuracy 15/17 (88%)
- Invented items caught 2/3
- Real items wrongly flagged as Unsupported: 0

The heuristic misses the two cases that need understanding rather than keyword matches:
someone volunteering a colleague ("Lena can run training") and a contradiction
("I can't promise anything on discounts"). Those are what the LLM judge is for.
Run `npm run eval -- --judge openai` and put your real numbers here.

## Connecting real Circleback data

1. Create an API key in Circleback under **Settings → API keys**. Full API access may need a paid plan.
2. In `.env`, set `MEETING_SOURCE="api"` and `CIRCLEBACK_API_KEY=...`.
3. Open `src/lib/circleback/api.ts`. The endpoint paths and field names there are
   **best guesses**, because the field-level API reference wasn't public when this was written.
   Check them against https://circleback.ai/docs/api and fix `ENDPOINTS` and the `map*`
   functions. Nothing else needs to change.

## Saving results

By default, results are saved as JSON in `.data/`. To use Prisma instead:

```bash
npm run db:setup          # prisma generate + db push (SQLite)
# then set STORAGE="prisma" in .env
```

For Postgres, change `provider` in `prisma/schema.prisma` to `"postgresql"` and point
`DATABASE_URL` at your database.

## Project layout

```
src/lib/verify/        owner.ts, retrieve.ts, decide.ts, judges/{openai,heuristic}.ts
src/lib/circleback/    api.ts (Circleback adapter), source.ts (sample vs API)
src/app/               Next.js pages + POST /api/meetings/[id]/verify
data/samples/          3 sample meetings
data/ground-truth.json hand labels for the eval
scripts/               eval.ts, verify.ts
tests/                 node:test unit tests
```

## Ideas for next steps

- Run it automatically with a Circleback webhook when a meeting ends, then post flagged items to Slack.
- Add a "Fix" button that rewrites or reassigns a flagged item through the API.
- Grow the eval set with real, anonymised meetings and track precision for each label.
