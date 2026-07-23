# reference-data

Static, build-time lookup data used to validate tool inputs before calling GFW.

- `gear-types.ts` — `geartype` filter enum accepted by `4wings/report`, sourced from
  the live dataset metadata (`GET /v3/datasets/public-global-fishing-effort:latest`,
  `filters.fourwings[].id === "geartype"`).
- `vessel-types.ts` — vessel type classification, sourced from the vessel-identity
  dataset's live filter metadata (`GET /v3/datasets/public-global-vessel-identity:latest`,
  `filters.vessels[].id === "combinedSourcesInfo.shiptypes.name"`).
