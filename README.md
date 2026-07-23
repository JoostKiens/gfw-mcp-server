# Global Fishing Watch MCP Server

<!--
[![npm version](https://img.shields.io/npm/v/gfw-mcp-server.svg)](https://www.npmjs.com/package/gfw-mcp-server)
[![license](https://img.shields.io/npm/l/gfw-mcp-server.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/gfw-mcp-server.svg)](package.json) 
-->

WORK IN PROGESS - NOT READY FOR PRODUCTION

An [MCP](https://modelcontextprotocol.io) server for the [Global Fishing Watch](https://globalfishingwatch.org) API. It gives LLMs structured, summarized access to vessel tracking, fishing activity, dark-vessel (SAR) detection, and IUU-risk data — not raw API dumps.

No serious standalone GFW MCP server existed as of mid-2026. Other MCP servers in this space (e.g. [cyanheads](https://github.com/cyanheads)'s work) cover clean REST/JSON APIs well but don't touch datasets that need real processing. This server's whole point is the processing layer: aggregation, summarization, and interpretation happen in code before anything reaches the model.

## Example

> "Is there fishing activity in Palau's EEZ in the last 90 days, and does it look suspicious?"

The model chains three tools automatically: `find_region` resolves "Palau" to GFW's EEZ ID, `get_fishing_activity` returns a summarized breakdown (total hours, top flag states, top gear types) instead of a raw grid of lat/lon cells, and `get_vessel_insights` surfaces GFW's own IUU-risk indicators for any vessels of interest — each response carrying explicit data caveats (AIS-only, near-port overestimation, satellite-pass-dependent coverage) so the model doesn't overstate what the data shows.

## Install

**Claude Desktop / Claude Code** — add to your MCP config:

```json
{
  "mcpServers": {
    "gfw": {
      "command": "npx",
      "args": ["-y", "gfw-mcp-server"],
      "env": {
        "GFW_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

**Manual / other clients:**

```bash
npm install -g gfw-mcp-server
GFW_API_TOKEN=your-token-here gfw-mcp-server
```

Or run over Streamable HTTP instead of STDIO:

```bash
GFW_API_TOKEN=your-token-here gfw-mcp-server --http --port 3000
```

### Getting a GFW API token

1. [Register for a Global Fishing Watch account](https://globalfishingwatch.org/our-apis/tokens/signup)
2. [Create an API access token](https://globalfishingwatch.org/our-apis/tokens)
3. GFW's API is free for non-commercial/research use — see [their terms](https://globalfishingwatch.org/our-apis/documentation#terms-of-use)

## Tools

| Tool | What it does |
|---|---|
| `find_vessels` | Search vessels by name, MMSI, IMO, or callsign. Returns one row per distinct vessel identity, not one per historical AIS record. |
| `find_region` | Resolve a country/EEZ name (e.g. "Palau", "the Russian EEZ") to the region ID other tools need. |
| `get_fishing_activity` | AIS-based apparent fishing effort for a region and date range, summarized by flag/gear type. |
| `get_dark_vessel_detections` | SAR (satellite radar) vessel detections — includes vessels not broadcasting AIS. Matched/unmatched breakdown. |
| `get_vessel_presence` | General AIS vessel traffic for a region — cargo, carrier, and other non-fishing vessel movement. |
| `get_vessel_events` | A vessel's fishing/encounter/loitering/port-visit/AIS-gap history, summarized (event counts, distinct ports, longest AIS-off gap). |
| `get_vessel_insights` | GFW's own IUU-risk indicators for a vessel — no-take MPA fishing, unauthorized-area fishing, AIS-off patterns, RFMO IUU-list membership. |
| `list_reference_data` | Static lookup: supported gear types and vessel types. (EEZ region names are resolved separately, at runtime, by `find_region`.) |

Full architecture and design rationale: [`docs/claude/architecture.md`](docs/claude/architecture.md).

## Data caveats & attribution

This server surfaces Global Fishing Watch data and is required by GFW's terms of use to attribute them in anything built on their API — **this project is built on Global Fishing Watch data ([globalfishingwatch.org](https://globalfishingwatch.org)) and is not affiliated with or endorsed by GFW.**

A few things worth knowing before trusting what comes back:
- **AIS-based datasets** (fishing effort, vessel presence, most events) only see vessels broadcasting AIS. Vessels that go dark won't appear — that's what `get_dark_vessel_detections` (SAR-based) is for.
- **Fishing effort near ports is often overestimated** — GFW's own map interface applies a 3km buffer by default for this reason.
- **SAR coverage is satellite-pass-dependent**, not continuous.
- **`get_vessel_events` is not a continuous track.** GFW's API doesn't expose raw vessel positions — only discrete events (fishing, encounters, port visits, etc.).

Every tool response includes a `dataCaveats` field with the specific caveats relevant to that response — read it before drawing conclusions from the data.

## Why not just call the REST API directly?

You can — GFW's API is well-documented and there are official [Python](https://github.com/GlobalFishingWatch/gfw-api-python-client) and [R](https://github.com/GlobalFishingWatch/gfwr) clients. This server exists for the cases where you want an LLM reasoning over the data conversationally: it handles GFW's quirks (the single-concurrent-report limit, 524 timeouts, the 366-day report window, vessel identity fragmentation across AIS records) so the model doesn't have to, and returns summaries sized for a context window instead of raw grid-cell arrays meant for a map renderer.

## Contributing

See [`.CLAUDE.md`](.CLAUDE.md) and [`docs/claude/`](docs/claude/) for conventions and architecture. In particular: gear-type and vessel-type reference data is sourced from live GFW dataset metadata, not hand-transcribed (see [`docs/claude/architecture.md`](docs/claude/architecture.md#reference-data)); EEZ region lookup is resolved at runtime by `find_region`, not a bundled table — see the same doc's Cache layer section.

## License

[MIT](./LICENSE) for this codebase. Use of the Global Fishing Watch API itself is governed separately by [GFW's terms of use](https://globalfishingwatch.org/our-apis/documentation#terms-of-use) — non-commercial/research use only, with mandatory attribution.
