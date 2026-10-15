# Changelog

Versions follow semantic versioning. Newest release first.

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
