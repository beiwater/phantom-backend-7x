# GitHub Copilot Repository Instructions

Before inspecting or changing repository code, read and follow `/AGENTS.md`. Then read `/.codex/README.md` and load every `.codex/skills/*/SKILL.md` file applicable to the current task.

For debugging, investigation, bug fixing, or code changes, `/.codex/skills/evidence-first-investigation/SKILL.md` is a mandatory default skill unless a higher-priority instruction explicitly says otherwise.

Do not begin by scanning the entire repository. Use the repository skill router and its evidence-first scope controls before implementation.
