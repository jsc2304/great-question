# Changelog

Versions follow semantic versioning. Newest release first.

## 0.16.0 — 2026-10-21

**Update the mod and run `/reload-plugins`; nothing else to do.**

### Changed

- A new session starts on the start screen instead of reopening the previous one. The panel shows nothing from the last session, neither the stored questions nor the rows heard live, and asks where to start: **show the questions from the previous session** (only where one is stored for the folder, with its title, count and date), **prepare new questions** (this repository, my next meeting, today's daily) or **listen live**. The stored questions stay on the computer and one click brings them back.
- A listener that is running when the mod loads again, for example after `/reload-plugins` during a meeting, keeps listening and keeps its rows.

## 0.15.0 — 2026-10-21

**Update the mod and run `/reload-plugins`; nothing else to do.**

### Changed

- Finding likely questions in the background now also reads the session's conversation: the newest 12,000 characters of what you and Claude wrote, without tool output. Estimates, decisions and open points worked out in the session become context for the questions and answers, cited as "this session's conversation". The panel's hint names the conversation as a source.

## 0.14.0 — 2026-10-20

**Update the mod and run `/reload-plugins`; nothing else to do.** A project without a Second Brain hub listens as before.

### Added

- While listening, the briefing starts with the project's Second Brain hub, `~/projects/second-brain/projects/<repo>/<repo>.md`: its sections "Status", "Offene Fäden" and "Tickets", at most 8,000 characters. Where the hub and the other sources disagree on a ticket's state, the answers follow the hub. A worktree reads the hub of its main checkout.

### Changed

- The briefing may be 24,000 characters instead of 16,000, so the hub does not push the memory file, the daily logs and the commits out.

## 0.13.0 — 2026-10-19

**Update the mod and run `/reload-plugins`; nothing else to do.**

### Added

- A focus card for the question asked now: **ASKED OF YOU**, **ASKED · EVERYONE** or **ASKED NOW**, who asked and how long ago, the question in large type, the best answer with its source, one "✖ Don't say:" line, and the other answers behind "▸ N more answers".
- Every live question says who it is for (me, everyone or someone else) and who asked, by role or first name as heard. A question for someone else never takes the focus card.
- While listening, the model also reads a short briefing from the folder when it exists: the start of `memory/MEMORY.md`, the two newest files in `memory/daily-logs/` and the last 15 commit subjects, at most 16,000 characters, re-read at most once a minute.

### Changed

- Listening reacts faster. The transcript is checked every 3 seconds instead of every 20. A question mark, your name, a question word at the start or a tag such as "oder?" or "right?" starts a step at once; other lines wait at most 12 seconds. An unchanged transcript is not read again.
- A step now has two parts. A quick one finds which questions were asked, which one is on the table, who it is for and what comes next, and shows them at once, the new rows marked "answering …". A second one then writes 2–3 answers per question, safest first, from the repository lines found, the prepared questions, your recent work and the briefing. The next question can already be detected meanwhile. A failed call waits 6 seconds before the same lines are tried again.
- Relevance now reads: 5 = addressed to you by name or about your ticket or work, 4 = your topic, 3 = asked of everyone, 2 = someone else's topic you could add to, 1 = clearly someone else's.
- The pane has a two-line header: title, number of prepared questions, language and version; then the buttons, with the listening status on the **Listening** button (for example "◉ Listening · 212 utterances · 12 s ago"). The legend moved under **More**.
- **UP NEXT · FOR YOU** shows at most 3 predicted questions: yours first (marked "· you"), then by likelihood, then newest, each with its best answer in one line. "↻ take N new" sits in its title row.
- Below it, **SAFE TO SAY · MY RECENT WORK**, **ASKED EARLIER** (questions from the call that were not prepared, newest first), **PREPARED** and **SOURCES** are folded to one line each while listening; a press on a section title unfolds it. Paused, **PREPARED** and **SAFE TO SAY** stand open.
- In the desktop app the focus card uses larger text sizes; the terminal keeps one size.
- *Fast (Haiku)* now asks for low thinking effort: the current Haiku thinks at medium effort by default and would otherwise answer several seconds later, with its thinking counted against the reply's token cap.
- Stored state from earlier versions loads as before, prepared questions keep working, and the export format is unchanged.

## 0.12.1 — 2026-10-15

**Update the mod and run `/reload-plugins`; nothing else to do.**

### Changed

- The **View** button is now called **More**: besides Language, Model, Sort and Meeting/Practice, its row holds the actions Export and Clear.

## 0.12.0 — 2026-10-15

**Update the mod and run `/reload-plugins`; nothing else to do. The default stays Fast (Haiku).**

### Added

- **Model** under **View**: *Fast (Haiku)*, *Balanced (Sonnet, low effort)* or *Thorough (Sonnet, high effort)* for listening along, switchable mid-meeting. It sets the model and effort of the live step and of the answers from the repository, and the model of the lookup for the question asked now. Slower levels answer later; their time limit grows to 45 and 90 seconds.

## 0.11.2 — 2026-10-15

**Update the mod and run `/reload-plugins`; nothing else to do.**

### Fixed

- **ASKED NOW** follows the meeting. When the model named no current question, the first one stayed on show for good; now the question asked last in the new lines takes its place.
- A model reply that was cut short or was no JSON changed nothing, and its lines counted as read, so their questions never came. The reply may now be twice as long, and a failed one is tried again on the next step; the status says so.
- Questions to "you", to your team or to a role such as the project lead count as yours, so they show as new questions and predictions. Before, they were often left out as meant for someone else.
- A transcript line without a speaker no longer counts as your own microphone.
- Only answers marked as a commitment may promise anything; a safe answer such as SAY IT no longer offers to send something after the meeting.

### Changed

- The status reads "last utterance … ago" instead of "last new … ago": it counts from the last line of the transcript, not from the last new question.

## 0.11.1 — 2026-10-15

**Update the mod and run `/reload-plugins`; nothing else to do.**

### Fixed

- **Close all** is its own button and shows as soon as one question is open. Before, the single button read **Open all** while only some questions were open, so closing them meant opening every question first; in a long meeting that opened dozens of questions at once.

## 0.11.0 — 2026-10-15

**Update the mod and run `/reload-plugins`. Questions prepared before 0.11.0 carry no recent work: prepare again to get it; while listening, your last commits stand in.**

### Added

- **SAFE TO SAY · MY RECENT WORK** under **ASKED NOW**: what you worked on last, each with its source, true whatever the meeting asks. The preparation now finds 3 to 6 such points from commits, pull requests, tickets and meetings; without them, listening shows your last five commits in the folder. The export lists them too.

### Changed

- Answers are shown safest first: **WEAK** (true, binds you to nothing) now comes before **ONLY IF COVERED**. A closed question's one-line answer is no longer a promise while a safer answer exists.
- Live answers, repository answers and the lookup for the question asked now always offer an answer that binds you to nothing; a commitment only when the question asks for a date, an owner or a scope, never with a date or name nobody gave.
- While listening, **ASKED NOW**, **LIKELY NEXT** and **ASKED IN THE MEETING, NOT PREPARED** follow the questions you have to answer: asked of you or of everyone, or about your work. Questions to someone else about their own work stay out. Your git user name and last commits go to the model with the transcript.

## 0.10.3 — 2026-10-15

**Update the mod and run `/reload-plugins`; nothing else to do. A pane that went blank while listening draws again after the reload.**

### Fixed

- In live mode, the pane no longer stops responding and then goes blank ("Nothing to show yet — great-question has not drawn in this pane"). When the model returned an answer whose note or source was not plain text, the app refused to draw the pane from then on, and opening it again with `/great-question` did not help. Such a note or source is now left out; answers already kept from earlier are cleaned the same way when the mod loads.
- Listening no longer stops for good when the model does not answer: each call now gives up after 30 seconds and the next step tries again.

## 0.10.2 — 2026-10-15

**Update the mod and run `/reload-plugins`; nothing else to do.**

### Fixed

- In live mode, a question asked in the meeting no longer shows an answer that belongs to another question. When the repository had nothing on one of several new questions, the answers found for the others moved up one row; each answer now stays with its own question.

## 0.10.1 — 2026-10-15

**Update the mod and run `/reload-plugins`; nothing else to do.**

### Fixed

- The one-line best answer under a closed live question no longer breaks its mark (● SAY IT) over several lines in the desktop app when the answer is long.

### Changed

- Questions are bold in full text colour whether open or closed, and the lines under an open question (who asks, why, who answers, likelihood) step back further, so the question stands out; ▸ and ▾ still show which are open. Questions have a line of space between them.
- The README shows the panel: the overview by answer confidence and two opened questions with all four risk classes.

## 0.10.0 — 2026-10-15

**Update the mod and restart the session; nothing else to do.**

### Changed

- Finding likely questions runs in a background agent: your session no longer receives the long preparation prompt and stays free while it runs. Without a background agent, the session prepares them as before.
- The button is called **Find likely questions**; while it runs, the panel shows a turning ◐ with the time taken, and a message says how many questions are ready.

### Added

- With nothing prepared, the panel offers where to start: likely questions about the repository, your next meeting, or today's daily.
- Sources and answer sources are links: URLs, GitHub issues and pull requests, and repository files at their line on GitHub.

## 0.9.0 — 2026-10-14

**Update the mod and run `/reload-plugins`. If your `.gitignore` lists `fragensets/`, add `question-sets/`: exports now go there.** Questions you prepared earlier keep loading.

### Added

- While listening, new questions are looked up in the session's repository and answered from the lines found; a **SAY IT** answer names its file and line.
- For the question asked now, a read-only subagent checks the repository in more depth and replaces the quick answers with its own.

### Changed

- "Set" is gone from the panel: questions are *prepared*, the button is **Prepare**, and questions from the call that were not prepared appear under **ASKED IN THE MEETING, NOT PREPARED**.
- The panel, commands, messages and exports are in English: **Listen live**, **Prepare**, **View**, risk classes **SAY IT**, **ONLY IF COVERED**, **WEAK**, **DON'T SAY**.
- Notes, reasons and roles in prepared questions are written in English; questions and answers follow the **Language** setting as before.
- Risk classes are stored as `sourced`, `commitment`, `vague`, `risky`; questions stored with the earlier German names are read in the new names.

### Breaking: export folder

Exports are written to `question-sets/` instead of `fragensets/`. Existing exports stay where they are. In projects with confidential content, add `question-sets/` to `.gitignore`.

## 0.8.0 — 2026-10-14

**Update the mod and run `/reload-plugins`; nothing else to do.** Which questions were open in 0.7 is not carried over; every question starts closed.

### Changed

- While listening, the list only grows: new questions arrive closed at the end, a question keeps its wording, asked questions stay in place marked ✓.
- Nothing opens by itself any more; live questions show their best answer in one line.
- While a question is open, the live sections stand still; new ones wait behind a button to take them in.
- Language, sorting, meeting/practice view, export and clear moved behind a view button; the status shows how long ago the last new utterance came in.

### Fixed

- New live questions opened by themselves and the focus jumped to another question.

## 0.7.1 — 2026-10-14

**Nothing to do.**

### Fixed

- The button row wraps in a narrow panel instead of pushing buttons out of view.

## 0.7.0 — 2026-10-14

**Nothing to do.**

### Added

- Language of questions and answers can be switched: Auto, DE, EN.
