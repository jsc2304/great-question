# Great Question

A side panel for Claude Code that shows the questions most likely to come up before a pitch, a customer meeting or the daily stand-up, with prepared answers ranked by risk. During a meeting it can listen along and keep suggesting the next questions.

**Works best with Wispr Flow.** Listening along during a meeting, with the question just asked and the next likely questions and their answers, needs [Wispr Flow](https://wisprflow.ai). Without Wispr Flow, Great Question prepares meetings but does not listen.

Every answer carries its risk as a mark, a word and a colour, safest first:

| Mark | Meaning |
|---|---|
| ● **SAY IT** · sourced | well founded, with a source |
| ○ **WEAK** · vague | true and binds us to nothing, but shallow |
| ▲ **ONLY IF COVERED** · commitment | binds us (date, price, scope); say it only when the documents back it |
| ✖ **DON'T SAY** · risky | unsupported, attackable or contradicting the documents |

## What it looks like

A pitch prepared: questions grouped by how surely they can be answered, each with its risk marks. An opened question says who is likely to ask, why, who answers on our side, and offers answers by risk, with their sources:

![The Great Question panel: questions grouped by answer confidence, one opened with a sourced answer and a warning what not to say](docs/overview.png)

Where the documents give no firm answer, the panel says what you may promise only if it is covered, what is harmless but shallow, and what to leave out:

![An unsure question with three kinds of answer: only if covered, weak, don't say](docs/answer-risks.png)

Listening along: the question just asked moves to **ASKED NOW** with answers by risk, and the next likely questions appear below, each with its best answer in one line:

![Listening: the question asked now with its answers and five likely next questions](docs/live.png)

While a question is open, new ones wait behind a button instead of moving the list:

![A held live list: the question asked now and a button to take four new questions](docs/live-hold.png)

*Screenshots show a fictional pitch for a fictional company; no real meeting was recorded.*

## Requirements

- **Claude Code** in the terminal or the desktop app, tested with version 2.1.296.
- **Wispr Flow for the full feature set.** Without Wispr Flow, Great Question prepares questions from the repository, tickets and other connected sources. With Wispr Flow you also get:
  - **Listening along:** while a recording runs, it reads the live transcript of the Wispr Flow app (Meeting Recorder, macOS) and suggests questions from the last two minutes.
  - **Meetings and transcripts during preparation:** through the Wispr Flow connector in Claude Code, `/great-question-prep` finds the upcoming meeting with its attendees and earlier conversations with the other side.

## Installation

In a Claude Code session in the terminal, enter:

```
/plugin install great-question --marketplace jsc2304/great-question
```

Confirm the marketplace question with `y` and choose the scope **User** (Enter). The mod then applies to all projects, including sessions in the desktop app.

Without a running session, use the shell:

```bash
claude plugin marketplace add jsc2304/great-question
```

```bash
claude plugin install great-question@great-question --scope user
```

Sessions that were running before the installation only see the mod after a restart.

## Updating

```bash
claude plugin update great-question@great-question
```

Then restart the session. The loaded version is shown top right in the panel (for example `v0.9.0`).

## Usage

| Command | Effect |
|---|---|
| `/great-question` | opens the panel without generating anything |
| `/great-question-prep [occasion]` | finds likely questions with answers in the background, for example `/great-question-prep steering committee Thursday` |

The desktop app does not list these commands in its suggestions. Type them in full and press Enter.

With nothing prepared yet, the panel asks where to start: **Likely questions about <folder>**, **Prepare my next meeting** (the background agent finds it in your calendar) or **Prepare today's daily**. Or just **Listen live**: questions then come from the live transcript only, answers from the repository.

Sources and the sources of answers are links where they point somewhere: a URL, a GitHub issue or pull request (`owner/repo#12`, `#12`), or a repository file, which opens on GitHub at its line (`docs/ops.md:12`). A file path counts from the session's folder; it becomes a link only when the file exists there and its repository's default branch on GitHub has it, otherwise it stays plain text.

Buttons in the panel:

- **Listen live**: reads the running Wispr Flow recording every 20 seconds and shows **ASKED NOW**, **SAFE TO SAY · MY RECENT WORK**, **LIKELY NEXT** and **ASKED IN THE MEETING, NOT PREPARED**. Switching it off only pauses.
- **Find likely questions**: like `/great-question-prep` without an occasion. A background agent reads the repository and connected sources while your session stays free; the panel shows a turning ◐ with the time taken, and the questions appear when it is done.
- **Open all** and **Close all**: open or close every visible question. **Close all** shows as soon as one question is open and closes them all at once.
- **View**: shows the less frequent settings:
  - **Language: Auto / DE / EN** of questions and answers. *Auto* uses the language the meeting is held in (from the invitation, slides and earlier transcripts when generating, from the conversation when listening). Applies to everything generated from then on, live included; nothing already shown is translated. Notes and reasons are in English.
  - **Sort**: by answer confidence (*safest to answer*) or by likelihood (*most likely asked*).
  - **Meeting / Practice**: *Meeting* shows the strongest first, *Practice* turns the order round and puts the weakest questions on top.
  - **Export**: writes the panel as Markdown to `question-sets/YYYY-MM-DD-HHMM-<title>.md` in the project folder.
  - **Clear** (only while paused): deletes the live results.

While listening, the panel follows the questions you have to answer:

- **ASKED NOW**, **LIKELY NEXT** and **ASKED IN THE MEETING, NOT PREPARED** hold questions asked of you or of everyone, or about something you work on. Questions to someone else about their own work stay out. In a video call your voice is the microphone; your git user name helps the model spot questions addressed to you by name.
- **SAFE TO SAY · MY RECENT WORK** lists what you worked on last, true whatever is asked: from the preparation (commits, pull requests, tickets or meetings, each with its source), or, when the preparation has none, your last five commits in the folder (author = your git email, merges left out).
- Live answers come safest first. A closed question shows the one that binds you to nothing before a promise; a commitment is offered only when the question asks for a date, an owner or a scope, and never with a date or name nobody gave.

While listening, answers come from the repository too:

- For every new question from the call, the mod searches the session's repository for its key words (`git grep`, exports left out) and lets the model answer from the lines found. A **SAY IT** answer then names its file and line, for example `docs/offer.md:42`.
- For the question under **ASKED NOW**, unless the prepared answers already rest on sources, a read-only subagent looks it up in more depth. While it runs, the box says *checking the repository …*; its answers then replace the quick ones, marked *from the repository*.
- Only the repository is searched live. Slides in Drive, Jira and other connected sources come in through the preparation only.

While listening, the list only grows, it is never rebuilt:

- New questions arrive closed at the end of their section and show their best answer in one line. A question keeps its wording even when the model rephrases it slightly.
- An asked question stays in place, marked ✓. Only when paused does it move to **ALREADY ASKED**.
- While a question is open, the live sections stand still. New ones collect behind **↻ take N new** and arrive by themselves once all questions are closed. **ASKED NOW** always stays live.

What gets prepared depends on the project: with slides, a pitch preparation or a meeting at hand it prepares the meeting; otherwise the daily stand-up from commits, pull requests and open tickets.

## Data and confidentiality

- **Record only with consent.** Wispr Flow records through this computer's microphone and system audio; no bot appears in the video call, so the others cannot see that it is being transcribed. Get the consent of everyone in the meeting before recording. In Germany, recording the privately spoken word without consent is a criminal offence (§ 201 StGB).
- **Transcription by Wispr Flow.** Recording happens locally, transcription happens in Wispr Flow's cloud ([Wispr: on-device recording](https://wisprflow.ai/notetaker/what-is-on-device-recording), as of 14.10.2026). Great Question reads the finished transcript from the Wispr Flow app's local file.
- **Prepared questions** are stored locally per project folder. They stay on the computer.
- **Listening along** sends the last two minutes of the transcript, the prepared questions, the repository lines found for new questions, your git user name and your last five commit subjects to a small Claude model (Haiku), through the same access as the session. A lookup for the question asked now runs as a read-only subagent (Haiku) in the session's folder. Speaker names from Wispr Flow are not sent; names mentioned in the conversation are in the text.
- **Exports** with live results contain questions from the conversation, names included. In projects with confidential content, add `question-sets/` to `.gitignore` or review it before committing.

## Development

Check:

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

A change reaches running sessions only with a new version: raise `version` in `.claude-plugin/plugin.json`, run `claude plugin update great-question@great-question`, restart the session. The desktop app loads the mod from the plugin cache, not from the working folder.

| File | Contents |
|---|---|
| `hooks/register.tsx` | commands, the question-set tool, panel, export |
| `hooks/live.ts` | listening along: read the transcript, fold in the model's reply |
| `types/index.d.ts` | data types and the panel's state |
| `tests/` | tests for panel, export and listening along |

## License

MIT, see [LICENSE](LICENSE).
