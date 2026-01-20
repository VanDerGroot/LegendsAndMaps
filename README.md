# LegendsAndMaps

A Blazor WebAssembly app for building **map “sets” (groups)** and assigning countries to them by clicking an interactive SVG world map.

This was **vibe coded** — it works, but it’s also likely to have plenty of room for improvement (edge cases, polish, refactors, tests, accessibility, etc.). If there is any interest in this project I might go back and actually write good code, but I suspect it has too few potential users to be worth it. This was just a fun little thing to throw together.

## Features

- Create/edit/delete sets (groups)
- Assign countries to sets by clicking on the map
- Per-set color editing
- Default non-deletable **“No data”** set
- Hover tooltip shows the country’s current set
- Zoom/pan (wheel + drag) and zoom controls
- Import/export map data as YAML
- Export the map as PNG (optionally including a legend overlay)
- “Map name” used for exports/legend title

## Tech

- .NET 10
- Blazor WebAssembly (client-side)
- Inline SVG world map in `LegendsAndMaps/wwwroot/data/world.svg`
- YAML import via YamlDotNet
- JS interop for SVG injection/sanitization, hit-testing, zoom/pan, and PNG export

## Run locally

From the repo root:

```bash
cd LegendsAndMaps
dotnet run
```

Then open the URL printed in the console (typically `http://localhost:5155`).

## Build

```bash
cd LegendsAndMaps
dotnet build
```

## YAML format (overview)

Imports accept either `sets` or `groups`. Each set has a name and optional color, plus a list of countries.

Country values are typically 2-letter IDs used by the SVG (e.g. `US`, `GB`, `NZ`, `PS`). Some common name variants are also accepted.

## Notes / Caveats

- State is currently in-memory only (refreshing the page clears changes).
- Country IDs are validated against what exists in the SVG; if an ID isn’t present in the map, it won’t import.
- To remove the Ko-fi link, delete the `Ko-fi` `<a>` in `LegendsAndMaps/Components/Layout/MainLayout.razor`.
- Because this is vibe coded, expect:
  - inconsistent naming and some rough edges
  - missing tests
  - occasional odd SVG/country edge cases
- This has not been security-reviewed; I wouldn’t expose it publicly without doing your own security pass first.

## Contributing

PRs/issues welcome — especially around UX polish, accessibility, improved country-name handling, and persistence.

## License

MIT — see `LICENSE`.

If you end up using this in a project, I’d be interested to hear about it — but no attribution or notification is required.
