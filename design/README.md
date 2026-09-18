# Design source

Mockups for the SEG-branded redesign of the workbench. These are design files, not
application code — nothing here is imported by `src/` or `server/`.

Published canvas: https://claude.ai/artifact/7a2q1e75dQ1yN4ihLeWKXn

| File | Screen |
| --- | --- |
| `Main.dc.html` | Dashboard |
| `Suppliers.dc.html` | Suppliers |
| `Sourcing.dc.html` | Sourcing Workbench — comparison tab |
| `Scorecard.dc.html` | Supplier scorecard |
| `States.dc.html` | Component states: blocked action, rejected request, voided record |
| `canvas.json` | Artboard positions and the two canvas pages |
| `seg-logo-white.svg` | Brand mark for dark backgrounds, from segsolar.com |
| `seg-logo-dark.svg` | Brand mark for light backgrounds, from segsolar.com |

The canvas has two pages: **Screens** (the four app screens) and **States**
(the component sheet).

Each `.dc.html` is one artboard: a standalone HTML page with inline styles.
Open one directly in a browser to view it.

## Brand values

Taken from the segsolar.com stylesheets, not from a screenshot:

| Token | Value |
| --- | --- |
| Primary red | `#E00700` |
| Dark red | `#B51B16` |
| Blue | `#1C5CB0` |
| Ink | `#1E1E1E` |
| Page background | `#EFF2F7` |
| Heading font | Kanit |
| Body font | Helvetica Neue / Arial |
| Corner radius | 0 — the site is square outside circular elements |

Chart colors (validated for color-vision deficiency): `#E00700`, `#1C5CB0`,
`#B8860B`, `#00876C`, `#6A4C93`, assigned in that fixed order.

The figures in the mockups come from `data/store.json` and the backend scorecard,
so they drift as the data changes.
