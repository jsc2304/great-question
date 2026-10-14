# Changelog

Versions follow semantic versioning. Newest release first.

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
