# First message to paste into Claude Code

Run `claude` in this folder (~/code/fm1-doom), then paste:

---

Read CLAUDE.md carefully. It's the brief for this whole project. Start Phase 0 and nothing else. Detect my OS and architecture, set up the JieLi toolchain and AC79 SDK the way Felucca's BUILDING.md describes, clone and build stock Felucca, and run its tests. Then investigate the hardware questions listed in Phase 0 and write the answers to NOTES.md, marking each as VERIFIED or ASSUMED. Also summarize FM-1 Transporter's recovery procedure. Finish with a go/no-go assessment of Doom's memory needs against what's available. Don't connect to, flash, or write to my FM-1 at any point in this phase. If any install or download fails, tell me and stop instead of looking for workarounds.

---

Before starting:
- Install Docker Desktop (needed for the JieLi toolchain on macOS).
- Back up your FM-1 presets/patterns in Baud Girl's Device Manager.
- Order a Seeed XIAO RP2040 so the recovery tool is on hand before Phase 1.
