# HomeCompass decision tools

Run the private local app with `npm run local` after configuring `.env` and installing dependencies as described in `ops/README.md`. The native launcher uses this checkout's isolated `.local/postgres` database, serves the frontend at `http://localhost:3000`, and serves the API at `http://localhost:8000/docs`.

## Explore

- Open Filters for area, storey range, estimated lease, transaction date and price per square metre. Must-haves are enforced by the database; preferences retain alternatives. Storey requirements use the entire reported storey range. Estimated lease uses the commencement year and an assumed 99-year term, not the original transaction's remaining-lease text.
- Open Trade-offs & scenarios to preview how budget, space and location priorities reorder the currently loaded records. This is a transparent preference preview, separate from the source-evidence score. It does not rank records that have not been fetched. Apply search to retrieve matching records from the database.
- Save up to ten named scenarios and reload or delete them here. Loading a scenario fills the controls; apply the search to retrieve its records.
- Expand Why this home? on a card to see matches, compromises and missing evidence. Hover or keyboard-focus a card to highlight its map marker; select a marker to inspect the nearest loaded resource points.
- Select saved personal places and distance limits in Filters, then turn on Family reach on the map. Overlapping rings and the count show which loaded records meet every straight-line limit. No journey times or school admission eligibility are inferred.
- Open Explore neighbourhood prices for monthly medians, transaction counts and the middle 50% of prices. Filter by town, flat type and time window; hover/focus chart points or open the accessible data table. Periods are anchored to the latest imported transaction. Data describes historical transactions, not listings, valuations or forecasts.
- If a search has no matches, check the actual database count after relaxing a town, area or amenity condition, then apply the chosen change. Map/service failures are shown without turning them into an empty success. The 3D map falls back to 2D if its service or WebGL is unavailable.

## Shortlist and Compare

- Switch Shortlist to Decision board. Move a record between Researching, Plan a visit, Considering and Ruled out.
- Add pros, trade-offs, notes, named household ratings, a visit date/time and viewing checklist entries. Visit times are recorded in the browser's local timezone; this does not make an appointment with a seller.
- Upload JPG, PNG or WebP viewing photos, up to 5 MB each. Images are resized to at most 1200 pixels, re-encoded without original metadata, and stored in browser IndexedDB. Each browser account can retain six photos per record and forty in total. Photos are not uploaded or included in exports.
- Compare up to three saved records. Numeric rows highlight differences in recorded price, floor area and estimated lease when evidence exists. Prepare decision summary to print/save as PDF using the browser, or download a standalone HTML document containing preferences, notes and source dates. User text is escaped in HTML exports.

## Saving and recovery

Scenario and decision text automatically save to local Postgres for signed-in accounts. Guest plans remain in browser storage. Each account has its own cache; a delayed response from a previous account cannot replace another account's plan. Browser-local photos do not sync across devices.

Edits are retained in the browser if account sync is unavailable. Retry sync after reconnecting. Simultaneous edits use a revision check: a stale save cannot overwrite the account version. Load account version explicitly replaces unsynced browser edits after confirmation. Browser storage limits and rejected saves are surfaced in the UI.

All new features use the existing React/Next.js, FastAPI, PostgreSQL/PostGIS, Leaflet, MapLibre and Motion dependencies. No paid API or model calls are required. The map still needs an internet connection to fetch its free basemap tiles.
