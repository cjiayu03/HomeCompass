# HomeCompass onboarding design

## Context

HomeCompass is an HDB resale research app, not a live-listing service. Its Explore workspace already uses a shared search brief for household size, budget, nearby schools/care, and ranking priorities. Authenticated profiles sync part of that brief through `/api/v1/profile`; search requests already accept flat type and amenity-distance limits. Signup and sign-in currently share a redirect to Explore.

New users should be offered a quick, skippable setup immediately after signup. The setup should feel like the existing HomeCompass interface, help users describe what matters to their household, and configure the same account-backed brief used in Explore. Existing accounts and signed-out visitors should continue directly to Explore.

## Goals

- Route a newly registered account to onboarding; route returning sign-ins to Explore.
- Let a new user finish setup or skip directly to Explore, without blocking either path on optional answers.
- Save choices to the signed-in account profile and use them in Explore and its search requests.
- Let users change the same saved preferences later in Explore.
- Keep the interface grounded in HomeCompass's existing DM Sans typography, evergreen palette, neutral cards, and AuthShell header/theme controls.
- Use clear, ordinary language and polished motion without AI-style copy or claims.

## Non-goals

- Require onboarding, collect names/ages/contact details, ask for an exact home/work address, or request location permission.
- Add Google/Supabase auth, an AI-generated questionnaire, paid data, live property listings, or a new animation dependency.
- Change guest Explore behavior or the meaning/weighting of existing ranking scores.
- Treat the decorative onboarding illustration as real geographic, transport, or property data.

## User journey and questions

Signup succeeds and creates an authenticated account with an incomplete onboarding state. It navigates to `/onboarding`. Sign-in sends completed accounts to `/explore` and resumes onboarding for an account that previously left setup incomplete. Refreshing while setup is incomplete also resumes it; after completion or skip, the onboarding route redirects to Explore. Existing profiles are marked complete by the additive migration, so old accounts bypass setup. Signed-out visitors who open `/onboarding` are sent to Explore.

Present four short steps with a persistent “Step n of 4” indicator, Back, Continue, and a visible “Skip for now” action:

1. **Who are you looking for?** Adults (minimum one), children, and older adults, using accessible increment/decrement controls. Do not ask for names or children's ages.
2. **What budget should we use?** A Singapore-dollar budget input with a slider and editable numeric value, shared with the Explore budget control.
3. **Where and what size?** Optional selection of up to three HDB towns and one flat type, plus “No preference” for each. Town suggestions come from towns present in the available resale dataset; options must not imply current availability. Flat-type options come from supported dataset values rather than invented inventory.
4. **What matters most?** Adjustable 1–3 importance for schools, childcare, elder-care access, and affordability; include simple presets (Balanced, Schools and childcare, Care access, Affordability). Offer optional maximum distances for schools, childcare, and care with a “No limit” choice. Distances affect search/score inputs only where supported by source coverage; do not promise that every home has complete amenity data.

Completing the last step marks onboarding complete and opens Explore. “Skip for now” does the same without asking any more questions; it keeps answers already changed in the shared brief, while untouched fields retain the profile/Explore defaults. The final step includes a plain-language summary of the selected household, budget, towns/type, and priorities. Household defaults are one adult, zero children, and zero older adults. The current Explore budget default may be shown, but must not be described as personalized advice. Town/type and distance fields can remain unset (“No preference” / “No limit”).

## Persistence and search behavior

Extend `family_profile` additively in migration 009 with `preferred_towns` (empty text array by default), nullable `preferred_flat_type`, nullable `max_school_distance_m`, `max_childcare_distance_m`, and `max_care_distance_m`, plus `onboarding_completed` (default `true` for existing rows). New-account registration creates its profile in the same transaction with `onboarding_completed = false`; profile creation must not rely on a later GET to infer whether an account is new. Existing accounts with no profile retain the complete-by-default behavior.

Extend the profile GET/PUT contract and `FamilyProfileUpdate` with these fields. Keep `onboarding_completed` optional on update so ordinary profile autosaves cannot accidentally finish setup; onboarding sends it as `true` only on explicit completion or skip. Store the household, budget, priorities, optional distances, and housing preferences in the account profile. Do not create an onboarding-only browser store as a second source of truth. Preserve guest Explore access and current guest-to-account behavior.

Keep existing `SearchRequest.town` behavior for compatibility and add a bounded `towns` list (maximum three) for profile preferences. A selected town list filters results to any selected town; flat type is a single exact supported type. The frontend sends saved town/type/distance preferences with Explore searches by default. Explicit criteria from the user's current search query may override those defaults for that request, but do not silently rewrite the saved profile. Changing the town/type/distance controls in Explore updates the same shared brief and profile. Priorities continue through the existing `priority_weights` path. Profile responses use the existing camelCase frontend convention; request payloads follow the API's snake_case convention.

The onboarding flow and profile hydration must use the same `WorkspaceProvider` brief. It needs a `childcareDistance` field in addition to current school/care distances, and its profile load/save and search payload must include the new fields. Existing profiles without the new optional values hydrate as no preference. Keep optional values nullable rather than converting “No limit” into a zero-distance constraint.

## Visual and interaction design

Use the AuthShell header, theme switch, and Explore link, with a wider responsive content variant for onboarding. Retain HomeCompass's existing background, card, border, focus, and color tokens. The setup should read as part of the app, not as a separate marketing funnel: concise labels, short helper text, no exaggerated claims, mascots, emojis, or AI-branded copy.

On desktop, pair the question card with a compact “Your search so far” summary; stack it below the form on narrow screens. Use the existing Motion package for brief step transitions, selected-chip feedback, counter changes, and progress updates. Add a subdued animated topographic-line background with a dashed route that draws forward as the user progresses and small pins that respond to selected towns. This illustration is decorative and must not be labeled as a real map. Keep animation low-contrast behind content, avoid parallax/confetti/continuous floating ornaments, and honor `prefers-reduced-motion` by making transitions immediate and the background static. Motion must not move keyboard focus or prevent controls from working while transitions run.

## Errors, accessibility, and privacy

- Keep all onboarding state associated with the authenticated account; never expose profile values across account switches.
- On profile-load/save failure, show a direct, dismissible explanation and retry option. Do not trap the user: allow continuing or skipping, keep current choices in the active workspace, and make clear when they have not synced.
- Validate household counts, nonnegative budget/distances, no more than three unique towns, supported flat type, and the existing priority-weight range at the API boundary.
- Use labeled controls, keyboard-operable town selection and counters, visible focus, announced step changes/errors, and sufficient contrast in light/dark themes.
- Do not request precise location, store contact/family details, or imply that selected preferences guarantee suitable homes. Explore must retain its historical-resale-data disclaimer.

## Acceptance criteria

- Successful signup opens onboarding; sign-in for a completed account opens Explore.
- A new account can refresh and resume incomplete onboarding; finishing or skipping marks it complete and sends it to Explore.
- Existing accounts and signed-out visitors do not get forced through onboarding.
- Saved choices survive sign-out/sign-in, hydrate into Explore, and affect the backend search request. Updating the same preferences in Explore persists them to the same profile.
- Up to three towns are combined as an OR filter, flat type remains a single selection, and “No preference/No limit” adds no constraint. A one-off explicit search criterion does not overwrite the saved preference.
- Layout and interactions work at mobile and desktop widths, in light and dark themes, with reduced motion enabled and with a failed profile API.
- No live-listing, exact-location, or unsupported amenity-coverage claim is introduced.

## Scope boundary

Expected implementation areas: auth signup redirect; a new onboarding route/component using AuthShell; shared profile/brief hydration and persistence; Explore controls/search payload; additive database migration 009; profile and search request schemas/handlers; API documentation. Keep existing local-auth and 3D-map work intact. Automated tests are not part of this approved workflow per the user's earlier instruction; perform focused build/import checks only if later requested or required for implementation handoff.
