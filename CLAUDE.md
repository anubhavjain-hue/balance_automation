# Agent Instructions

You're working inside the **WAT framework** (Workflows, Agents, Tools). This architecture separates concerns so that probabilistic AI handles reasoning while deterministic code handles execution.

## How It Works

- **Playwright MCP** (`@playwright/mcp`) provides browser automation tools (navigate, click, fill, screenshot)
- **Partner skills** in `.claude/skills/<partner>/` give you dashboard-specific knowledge (login, selectors, navigation)
- **Selectors** in `selectors/` get auto-updated when vision fallback discovers working selectors
- **Credentials** and API keys are stored in `.env` — never store secrets anywhere else

### Hybrid Fast-Path / Vision-Fallback
- **Fast path**: Use known CSS selectors from `selectors/<partner>.json` (cheap, 4-8K tokens)
- **Vision fallback**: When a selector fails, take a screenshot, identify the element, try a new selector. If it works, save it to the selectors file for next time (25-45K tokens)
- **Self-healing**: Discovered selectors persist, so costs drop over time

## Using Skills

Each partner dashboard is a skill. Invoke with `/partner-name` followed by your instruction:

```
/total-processing check the current balances
/total-processing download transaction report for last 14 days
/dlocal check the current balances
/dlocal export transaction report for last 7 days
```

After invoking, continue the conversation with follow-up requests — the browser session stays active.

### Adding a New Partner
1. Create `partners/<id>.yaml` — dashboard URL, credential env vars, tasks, webhook config
2. Create `selectors/<id>.json` — can start empty (vision mode discovers selectors)
3. Create `.claude/skills/<id>/SKILL.md` — skill with login procedure, nav map, selectors, quirks
4. Add credentials and webhook URLs to `.env`

## Programmatic Mode

For scripted or one-off automation without the chat interface:

```bash
npx tsx src/agent.ts -p total-processing -t balances          # Predefined task
npx tsx src/agent.ts -p total-processing -t report --days 14  # With options
npx tsx src/agent.ts -p total-processing --prompt "..."       # Freeform
npx tsx src/agent.ts --list-partners                           # List partners
```

## File Structure

```
.claude/skills/              # Partner skills (Claude Code slash commands)
  total-processing/SKILL.md  # /total-processing skill
  dlocal/SKILL.md            # /dlocal skill
src/                         # TypeScript agent (Claude Agent SDK)
  agent.ts                   # CLI entry point — task mode, freeform mode
  config.ts                  # Partner config + selector loading
  prompt.ts                  # System prompt construction
partners/                    # Partner YAML configs
  total-processing.yaml      # Total Processing (Nomupay) config
  dlocal.yaml                # dLocal config
selectors/                   # Known CSS selectors (JSON, auto-updated)
  total-processing.json      # TP selectors (manual + AI-discovered)
  dlocal.json                # dLocal selectors (AI-discovered)
.mcp.json                    # Playwright MCP server config
.env                         # Credentials + webhook URLs
.tmp/                        # Temporary files (disposable)
package.json                 # Node.js dependencies
tsconfig.json                # TypeScript config
```

## Git — Where to Push

**All balance scripts, CI workflows, and partner automation code must be committed and pushed to the org repo:**

```
opsautomation remote → https://github.com/opsautomation-tazapay/browser_automation.git
```

- Always push to `opsautomation` (`git push opsautomation main`), **not** `origin`
- The `origin` remote (`paramjaniani-ux/treasury-automations`) is the wrong repo — do not push there
- GitHub Actions and secrets are configured on the org repo; pushing to `origin` will break CI

## Principles

- Try known selectors before screenshots (fast path first)
- When something fails, take a screenshot and reason about what you see
- Save every newly discovered selector to `selectors/<partner>.json` so future runs are faster
- Read `.env` for credentials — never hardcode them
- Wait 3 seconds after navigation on SPAs (Vuetify and MUI never reach networkidle)
- Ask before running anything that costs money or sends data externally
