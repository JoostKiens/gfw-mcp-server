# tools

MCP tool implementations. One file per tool: Zod input schema, pure
summarization/validation functions, a thin handler (validate → resolve → fetch →
summarize → attach caveats → return), and registration — see
`docs/claude/mcp-tools.md` for the full pattern.

- `find-vessels.ts` — `find_vessels`. Searches GFW's `/v3/vessels/search` and
  caches raw responses per query for the life of the process (vessel identity
  doesn't change within a process run). The vessel-identity-collapse logic itself
  lives in `../vessel-identity.ts`, not here — it's shared with any future tool
  that needs to resolve or display vessel identity (e.g. `get_vessel_events`,
  `get_vessel_insights`), not reimplemented per-tool.
