# Implementation Plan: Driver Live Distance

## Overview

This plan implements the live driver-to-pickup distance readout in the Sarix Go driver
app, building incrementally bottom-up: first the pure distance/format helpers in
`driverMap.helpers.ts`, then the replacement of the polling location loop with a single
`watchPositionAsync` subscription (with a throttled backend broadcast) in
`app/order/[id].tsx`, then the derived distance display, then the optional ETA hint, and
finally the property-based and mocked integration tests.

Each task builds on prior tasks and ends by wiring the new logic into the order screen so
no code is left orphaned. Test-related sub-tasks are marked optional with `*` and validate
the correctness properties (via `fast-check`, min 100 iterations) and non-regression
behavior defined in the design.

All code is TypeScript. Pure helpers follow the existing `driverMap.helpers.ts` convention:
exported total functions, defensive against `null`/`NaN`/`Infinity`, no React imports.

## Tasks

- [x] 1. Add the pure haversine distance helper to `driverMap.helpers.ts`
  - In `src/components/driverMap.helpers.ts`, implement `haversineMeters(a: Coords, b: Coords): number` using the great-circle haversine formula with Earth mean radius R = 6,371,000 m
  - Return a finite, non-negative meter value when both points are finite
  - Return the `NaN` "no distance" sentinel when either point is `null` or contains a non-finite `lat`/`lon` (guard with `Number.isFinite`); never throw
  - Read inputs without mutating `a` or `b`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 1.1 Write property tests for `haversineMeters`
    - **Property 1: Haversine distance is non-negative and symmetric** — for any two finite `Coords`, result is finite and non-negative and `haversineMeters(a,b) === haversineMeters(b,a)` within tolerance; non-finite/null input yields `NaN` sentinel without throwing
    - **Property 2: Identical coordinates have zero distance** — for any finite `Coords` `a`, `haversineMeters(a, a)` equals `0` within tolerance
    - **Property 6: Distance computation does not mutate its inputs** — `a` and `b` `lat`/`lon` are unchanged after the call
    - Use `fast-check` with finite `Coords` generators (lat ∈ [-90, 90], lon ∈ [-180, 180]) plus edge generators injecting `NaN`/`Infinity`/`null`; min 100 iterations
    - Tag: **Feature: driver-live-distance, Property 1/2/6**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

- [x] 2. Add the pure `formatDistance` helper to `driverMap.helpers.ts`
  - Implement `formatDistance(meters: number): string`
  - `meters >= 1000` → `` `${(meters / 1000).toFixed(1)} km` `` (e.g. "3.2 km")
  - `0 <= meters < 1000` → `` `${Math.round(meters)} m` `` (e.g. "450 m")
  - `NaN` / negative / non-finite → non-empty safe fallback `"—"` rather than throwing
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 2.1 Write property tests for `formatDistance`
    - **Property 3: Kilometer formatting at and above 1000 meters** — for any `m >= 1000`, output equals `` `${(m/1000).toFixed(1)} km` ``
    - **Property 4: Meter formatting below 1000 meters** — for any `0 <= m < 1000`, output equals `` `${Math.round(m)} m` ``
    - **Property 5: Formatting totality** — for any finite non-negative `m`, output is a non-empty string; for `NaN`/negative/non-finite, output is a non-empty safe fallback without throwing
    - Use `fast-check` distance generators spanning `[0, 1000)` and `[1000, ∞)` including the 1000 m boundary, plus invalid-input generators; min 100 iterations
    - Tag: **Feature: driver-live-distance, Property 3/4/5**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

  - [ ]* 2.2 Write unit tests for `formatDistance` boundaries
    - Cover exact boundaries: 999.5 m, 999 m, exactly 1000 m, 0 m
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Add the optional `formatEta` helper to `driverMap.helpers.ts`
  - Implement `formatEta(meters: number, avgSpeedKmh: number): string`
  - Derive a coarse non-negative ETA from distance and assumed average speed (default `ETA_AVG_SPEED_KMH = 30`)
  - Zero distance → zero duration; invalid input (`NaN`/negative/non-finite/non-positive speed) → non-empty safe fallback
  - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 3.1 Write property test for `formatEta`
    - **Property 10 (optional): ETA hint is non-negative and zero at zero distance** — for any non-negative `m` and positive `avgSpeedKmh`, derived duration is non-negative, and `m === 0` yields zero duration
    - Use `fast-check`; min 100 iterations; tag **Feature: driver-live-distance, Property 10**
    - **Validates: Requirements 6.1, 6.2, 6.3**

- [ ] 4. Checkpoint - pure helpers
  - Ensure all helper tests pass, ask the user if questions arise.

- [x] 5. Replace the polling location loop with a single `watchPositionAsync` subscription
  - In `app/order/[id].tsx`, add tuning constants: `WATCH_DISTANCE_INTERVAL_M = 10`, `WATCH_TIME_INTERVAL_MS = 2000`, `BACKEND_MIN_INTERVAL_MS = 10000`
  - Add `subscriptionRef` (`LocationSubscription | null`) and `lastSentAtRef` (epoch ms) refs
  - Remove the existing `setInterval`/`getCurrentPositionAsync` loop and start exactly one `Location.watchPositionAsync({ accuracy, timeInterval: WATCH_TIME_INTERVAL_MS, distanceInterval: WATCH_DISTANCE_INTERVAL_M })` subscription when foreground permission is granted AND the order is an Active_Order (`accepted`/`in_progress`)
  - On each callback: call `setDriverCoords(...)` every time; call `updateDriverLocation(...)` only when `now - lastSentAtRef >= BACKEND_MIN_INTERVAL_MS`, then update `lastSentAtRef`
  - Wrap callback/permission work in try/catch matching the existing defensive pattern so a failed update leaves `driverCoords` unchanged
  - Cleanup: call `subscriptionRef.current?.remove()` and clear the ref on unmount, when the order is no longer active, or when permission is not granted; enforce at most one active subscription
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.2, 5.3, 5.4, 5.5, 5.6, 7.3_

  - [ ]* 5.1 Write property tests for the throttle gate and retain-on-failure logic
    - Extract the throttle decision and last-coords retention into testable pure logic over event streams
    - **Property 8: Backend broadcast throttle invariant** — for any stream of timestamped events, display updates on every event while broadcasts occur only when `>= BACKEND_MIN_INTERVAL_MS` since the previous broadcast; broadcast count never exceeds event count and consecutive broadcasts are spaced `>= ~10s`
    - **Property 9: Last known label is retained on update failure** — for any sequence with some failing updates, the label equals `formatDistance(haversineMeters(lastSuccessfulCoords, pickup))` and no failure throws or clears the label
    - Use `fast-check` with timestamped event-array generators; min 100 iterations; tag **Feature: driver-live-distance, Property 8/9**
    - **Validates: Requirements 4.3, 4.4, 5.5**

  - [ ]* 5.2 Write mocked integration tests for the watcher lifecycle
    - Mock `expo-location`: watcher starts exactly one subscription when order active AND permission granted, with a meter-level `distanceInterval` (4.1, 5.6)
    - Permission denied → no subscription started; navigation candidates still build (5.2)
    - Unmount and status→inactive both call `subscription.remove()` (5.3, 5.4)
    - `updateDriverLocation` still invoked (gated) with finite coords (7.3)
    - _Requirements: 4.1, 5.2, 5.3, 5.4, 5.6, 7.3_

- [x] 6. Derive and render the distance display on the order screen
  - In `app/order/[id].tsx`, derive per render: `pickup = derivePickup(order)` and `distanceMeters = (driverCoords && pickup) ? haversineMeters(driverCoords, pickup) : NaN`
  - Implement the `DistanceDisplay` precedence: not Active_Order → `HIDDEN`; `pickup === null` → `PICKUP_MISSING`; `driverCoords === null` → `LOADING`; otherwise → `LABEL` with `formatDistance(haversineMeters(driverCoords, pickup))`
  - Render the chosen state as a distance badge overlaid on the existing `mapCard` (or a row in the route card): show the `Distance_Label`, a "passenger location unavailable" placeholder for `PICKUP_MISSING`, a loading placeholder for `LOADING`, and nothing for `HIDDEN`
  - Ensure the label is computed (not stored) so it always reflects the latest `driverCoords`, consistent with the existing driver marker and driver→pickup route
  - Do NOT remove or alter the existing map, pickup marker, driver marker, route, passenger card, route card, navigation button, countdown, or completion flow
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.2, 4.5, 5.1, 7.1, 7.2, 7.4_

  - [ ]* 6.1 Write property test for latest-coords consistency
    - **Property 7: Display, marker, and route use the latest single coordinate source** — for any sequence of updates ending in `latestCoords`, when pickup is available the label equals `formatDistance(haversineMeters(latestCoords, pickup))` and the marker/route coordinates equal `latestCoords`
    - Use `fast-check` with coordinate-sequence generators; min 100 iterations; tag **Feature: driver-live-distance, Property 7**
    - **Validates: Requirements 3.4, 4.2, 4.5**

  - [ ]* 6.2 Write unit tests for the `DistanceDisplay` precedence branches
    - Cover LABEL, PICKUP_MISSING, LOADING, and HIDDEN branches with concrete inputs
    - _Requirements: 3.1, 3.2, 3.3, 5.1_

- [x] 7. Wire the optional ETA hint into the display (optional, feature-flagged)
  - When the ETA hint is enabled and a finite distance is available, render `formatEta(distanceMeters, ETA_AVG_SPEED_KMH)` alongside the `Distance_Label`
  - When disabled, render the `Distance_Label` without an ETA hint
  - _Requirements: 6.1, 6.4_

- [ ] 8. Non-regression smoke test
  - [ ]* 8.1 Write a mocked smoke render test for the order screen
    - Confirm map, pickup marker, driver marker, driver→pickup route, passenger card, route card, contact-window countdown, navigation button, and complete button all still render alongside the distance readout
    - _Requirements: 3.5, 7.1, 7.2, 7.4_

- [ ] 9. Final checkpoint - Ensure all tests pass
  - Ensure all property, unit, and integration tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks (1, 2, 3, 5, 6, 7) are mandatory.
- Each task references specific requirement sub-clauses for traceability.
- Property tests use `fast-check` (min 100 iterations each), one test per correctness property, tagged **Feature: driver-live-distance, Property {number}: {property_text}**.
- The side-effecting watcher lifecycle is validated via mocked `expo-location` integration tests, not property tests.
- Checkpoints ensure incremental validation at natural breaks.
