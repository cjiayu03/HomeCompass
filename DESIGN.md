---
version: alpha
name: "HomeCompass"
description: "A quiet, evidence-led Singapore place search for families balancing children, older adults and everyday travel."
colors:
  ink: "#0A0A0A"
  paper: "#F5F8FB"
  surface: "#FFFFFF"
  primary: "#286746"
  primary-deep: "#19472F"
  selected: "#78927E"
  line: "#D3DCE6"
  muted: "#5E6B79"
  warning: "#64748B"
  danger: "#A74B43"
  friendly-sun: "#F7DF9B"
  friendly-sky: "#DCEFF5"
  friendly-leaf: "#DCEFE0"
typography:
  display:
    fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3.25rem)"
    lineHeight: "1.05"
  sans:
    fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    lineHeight: "1.5"
rounded:
  DEFAULT: "0.75rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
spacing:
  page-max: "100rem"
  gutter: "clamp(1rem, 3vw, 2.5rem)"
  section-gap: "1.25rem"
components:
  button: { radius: "0.75rem", minHeight: "2.5rem", material: "clear solid or neutral fill with one visible border" }
  card: { radius: "0.75rem", border: "1px solid hsl(var(--border))" }
  dialog: { radius: "0.75rem", backdrop: "rgba(0,0,0,0.60)" }
  input: { radius: "0.5rem", minHeight: "2.75rem" }
  badge: { radius: "0.375rem" }
---

# HomeCompass Design System

## Overview

### Creative North Star

The product is a quiet map desk for a shared family decision: a near-black/cool-paper interface where a movable Singapore map sits beside a compact evidence list. The public route `/` introduces the search and shows the movable map; `/explore` is the working map-and-results view. `/login` and `/signup` have a separate auth shell, while `/account` stays focused on workspace settings.

### Product context and register

- Audience: Singapore families planning around children, older adults, budget and daily travel.
- Register: plain civic utility with a restrained editorial edge; clarity and accessibility outrank decoration.
- Anti-references: promotional property portals, noisy dashboard card grids, purple-gradient SaaS templates and maps used as decoration.
- Locale: English (`en-SG`) initially; Chinese, Malay and Tamil remain disabled until human translation review.
- Data boundary: government records are source-dated comparison evidence, never live listing availability.
- Runtime ownership: CSS variables in `frontend/app/globals.css` feed Tailwind and the source-owned `frontend/components/ui/` primitives. OpenStreetMap/Leaflet owns map pan, zoom and attribution behavior.

## Colors

Near-black (`#0A0A0A`) makes the dark theme actually dark; cool paper (`#F5F8FB`) keeps the light theme clear. Evergreen marks action and selection, with soft sage in dark mode. Explore adds flat sunshine, sky and leaf accents to its neighbourhood illustration, home icons and results header; these are decorative, not status colours. CSS variables `--friendly-sun`, `--friendly-sky` and `--friendly-leaf` in `frontend/app/globals.css` own these accents, with subdued dark-theme equivalents. Explore has a solid page background: no gradients, animated contours or container-edge colour effects. Neutral slate and red are reserved for caution and destructive actions. Every meaning has text or an icon in addition to color. Dark mode changes surfaces and contrast, not semantic hierarchy.

## Typography

DM Sans carries titles, controls and evidence explanations so the interface feels quiet and legible rather than promotional. System fallbacks preserve legibility if a font is unavailable. Sentence case is used throughout; units are explicit (`m`, `km`, `SGD`).

## Layout

The public landing page, auth pages and workspace use separate headers so the product introduction, sign-in form and search tools each have a clear role. The workspace has a single top navbar with route links and a theme toggle; there is no sidebar. Explore keeps a compact title/search row above a desktop split: the real map and a complete first result share the first viewport. Budget, town and flat type remain visible in one summary line; saved searches, scenarios and detailed data notes open on demand in Search tools. Filters open in a titled Radix dialog with a scrollable form region and fixed actions. At phone width, Homes is the default view with natural document scrolling; a labelled Homes/Map toggle switches views without putting the map above the first result. The map retains a reserved height.

## Elevation & Depth

Most surfaces are separated by one-pixel borders and subtle background shifts. Evidence cards use a cool, translucent surface with one defined edge and restrained depth so they separate clearly from the results pane without neon or heavy shine. The map, dialogs and temporary notices can float higher. No shadow is used to imply an evidence claim. Focus rings remain visible in light, dark and forced-colour modes.

## Shapes

Cards and dialogs use 12px radii. Controls use 8px radii for a clear, tappable geometry. Badges are compact rectangles, not pills. Tables keep a square-ish reading rhythm inside a rounded outer surface. Destructive controls are visually separated from primary actions.

## Components

### Foundational states

Shared shadcn-style buttons use clear, solid or neutral fills with one visible border; selected actions use a soft evergreen tint rather than a second outline. Primary actions keep strong contrast and quiet actions remain quiet until hovered. Inputs, selects, tabs and switches have visible focus, disabled and busy states. Search has an explicit clear control when non-empty. Empty, no-result, stale and unavailable states preserve the user's current filters and offer a concrete recovery action.

### Navigation and map

The `AppShell` is the canonical owner for the navbar, theme switching, notices and route links. `MapPanel` is the canonical owner for the OSM workspace; its attribution remains visible, its markers have popups, and it can be operated with mouse, touch or keyboard map controls. A selected marker uses muted sage; candidates use a darker evergreen; context layers never rely on color alone.

### Data display

`HomeCard` is the canonical evidence card across Explore and Shortlist. Explore uses its `browse` variant: address, recorded price, key facts, source/date and explicit Details, Save and Compare actions. Full evidence, score explanations and household access live in the Details dialog rather than expanding every search result. The default variant remains available to other workflows. Source name and source date stay adjacent to the observation. Compare uses one semantic table with sticky row labels and a maximum of three user-selected homes.

### Forms and overlays

Popups use opaque popover surfaces with a dimmed, unblurred backdrop so text and controls remain crisp. Explore keeps its background solid and places decorative accents inside components, avoiding clipped gradients at its container borders. Hovering or keyboard-focusing a result highlights its map marker and address, panning only enough to reveal it without changing zoom or the selected home. Browse-card actions use at least 44px-high targets, 14px labels and explicit Save, Details and Compare text; home facts use 14px text, source notes at least 12px, and addresses remain prominent. Decorative effects never replace labels, reduce contrast or require hover to use an action.

Forms use labelled native inputs/selects where platform geometry is acceptable and source-owned Radix primitives for switches/dialogs. Product forms use application-owned feedback and avoid browser alerts. Deletion uses a cancel-first alert dialog and names the local/server consequence.

### Iconography and motion

Shared route templates use one short arrival transition; buttons and dialogs give restrained press/open feedback across the public, auth and workspace routes. Loading uses the shared `LoadingScene` animated SVG compass (counter-rotating arcs, scanning needle and moving route), with explicit status text and no fabricated percentages or minimum waiting time. Reduced motion disables these animations. Next route loading boundaries and real data requests own when loaders appear. Maps, price history, decision boards, comparison summaries and onboarding load their code on demand. Map inspection is separate from comparison: selecting a marker highlights and reveals its result card; selecting a card address locates the same home on the map. MapLibre popup surfaces and text both use the active popover tokens, including popup tips and close controls, to preserve dark/light contrast.

Lucide line icons are paired with labels unless the control has an accessible name. Magic UI `MagicCard`, `BlurFade` and `NumberTicker` provide cursor-responsive glass borders, staged entrances and score/count feedback. Motion uses a short entrance and a more visible lift on cards; reduced-motion settings disable decorative movement. The cool slate palette avoids gradients that look neon or decorative AI-style effects. System high-contrast preferences strengthen text and borders without a separate contrast control.

## Do's and Don'ts

- Do keep the current filters visible on Explore and editable without pushing the map below the fold; the underlying course/domain concept remains the family brief.
- Do make the map genuinely movable, attributed and useful for selecting a candidate.
- Do pair every score, risk flag and source freshness statement with readable text.
- Do let dark mode, operating-system contrast preferences and browser zoom support the same information hierarchy.
- Don't imply a government transaction is a current property listing.
- Don't use the map or a colour as the sole basis for a high-impact housing decision.
- Don't add a new screen-local button/card/dialog variant when the shared `components/ui` primitive can express the behavior.
