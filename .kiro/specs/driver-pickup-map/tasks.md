# Implementation Plan: Driver Pickup Map

## Overview

This plan ports the passenger app's proven WebView Yandex map into the driver app and integrates it
into the accepted-order detail screen (`app/order/[id].tsx`). The work is sequenced bottom-up:

1. Port the `YandexMap` component verbatim (same `YandexMapHandle` API).
2. Add pure helper functions for all map decision logic (testable in isolation).
3. Reuse the existing ~10s location loop to capture `driverCoords` (no second loop).
4. Add the map-update effect and render the map card on the screen.
5. Provision configuration for the Yandex API key.
6. Wire and verify property/example/integration tests.

All work is **frontend-only** in `sarix-go-driver`. There are no backend changes. Implementation
language is **TypeScript** (React Native / Expo), matching the existing codebase.

Property-based tests use `fast-check` (≥100 iterations each), tagged
`Feature: driver-pickup-map, Property {n}: {property_text}`. Tasks marked with `*` are optional
test sub-tasks and can be skipped for a faster MVP.

## Tasks

- [x] 1. Port the YandexMap component into the driver app
  - Create `sarix-go-driver/src/components/YandexMap.tsx` as a near-verbatim copy of
    `sarix-go-app/src/components/YandexMap.tsx`.
  - Preserve the public surface exactly: `MapMarker`, `YandexMapProps`, and the imperative
    `YandexMapHandle` (`setCenter`, `fitBounds`, `drawRoute`).
  - Keep the Map_API_Key resolution order unchanged
    (`EXPO_PUBLIC_YANDEX_JS_API_KEY` → `expoConfig.extra.yandexJsApiKey` → legacy fallbacks → `''`).
  - Keep the embedded HTML (`init`, `setMarkers`, `setCenter`, `fitBounds`, `drawRoute`,
    `waitForYmaps`), the WebView config (`baseUrl`, `originWhitelist`, `mixedContentMode`), and the
    built-in loading/error overlay (`ActivityIndicator` + `__mapApiError`/timeout path) intact.
  - Confirm driver-app deps (`react-native-webview`, `expo-constants`) are present in
    `sarix-go-driver/package.json`.
  - _Requirements: 1.3, 8.1, 8.2, 8.4_

  - [ ]* 1.1 Write property test for API-key resolution precedence
    - Extract/expose the key-resolution logic as a pure function so it can be tested without the
      WebView, then generate random `(env, extra)` pairs (empty/undefined/non-empty).
    - **Property 7: API-key resolution precedence**
    - **Validates: Requirements 1.3, 8.4**

  - [ ]* 1.2 Write integration tests for the map overlay (mocked `react-native-webview`)
    - Assert `apiError`/`onError`/`onHttpError` messages flip the overlay to the error state, and
      the default state shows the loading indicator until `ready`.
    - _Requirements: 8.1, 8.2_

- [x] 2. Implement pure map-derivation helpers
  - [x] 2.1 Create `sarix-go-driver/src/components/driverMap.helpers.ts` with the `Coords` type and
        `isFiniteCoord`, `derivePickup`, `deriveMapVisible`, `derivePickupUnavailable`,
        `deriveInitialCenter`, and `deriveShouldDrawRoute`.
    - Pickup/driver markers use fixed ids (`'pickup'`, `'driver'`) and distinct theme colors
      (pickup = `colors.accent` `#F4C430`, driver = `colors.info` `#3B82F6`).
    - `deriveInitialCenter` precedence: pickup → driver → fixed Termiz default.
    - Write every helper as a total function that never throws on null/NaN/Infinity/missing fields.
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 3.1, 3.2, 4.3, 5.1, 5.4, 5.5, 6.1, 6.2_

  - [x] 2.2 Implement `deriveMarkers(pickup, driver)` producing `MapMarker[]`
    - Returns `[]` | `[pickup]` | `[driver]` | `[pickup, driver]` with distinct ids and colors.
    - _Requirements: 2.1, 2.3, 3.1, 4.3_

  - [ ]* 2.3 Write property test for the map-visibility predicate
    - **Property 1: Map visibility predicate**
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 2.4 Write property test for marker-set derivation and distinctness
    - **Property 2: Marker-set derivation and distinctness**
    - **Validates: Requirements 2.1, 2.3, 3.1, 4.3**

  - [ ]* 2.5 Write property test for mutually-exclusive pickup availability
    - **Property 3: Pickup availability is mutually exclusive**
    - **Validates: Requirements 2.1, 3.1, 3.2**

  - [ ]* 2.6 Write property test for initial-center selection
    - **Property 4: Initial-center selection**
    - **Validates: Requirements 2.2, 5.4**

  - [ ]* 2.7 Write property test for the route-draw predicate (latest driver position)
    - Generate a finite pickup plus a sequence of driver updates; assert route draws for every
      update, the latest `drawRoute` uses the last driver position, and `driver = null` → no route.
    - **Property 5: Route is drawn exactly when both points exist, using the latest driver position**
    - **Validates: Requirements 5.1, 5.5, 6.1, 6.2, 5.4**

  - [ ]* 2.8 Write property test for derivation totality
    - Fuzz with garbage orders/coords (null/NaN/Infinity/missing fields); assert no helper throws.
    - **Property 8: Derivations are total (never throw)**
    - **Validates: Requirements 3.3, 8.4**

- [x] 3. Extract the external-navigation candidate builder
  - [x] 3.1 Add `buildNavCandidates(lat, lon, os)` to `driverMap.helpers.ts`
    - Move the candidate-URL list out of `openNavigation()` into this pure function WITHOUT changing
      behavior: order is Yandex Navigator → Yandex Maps → platform geo/Apple Maps → Yandex web →
      Google Maps web; every candidate string embeds the given `lat`/`lon`.
    - Update `openNavigation()` to call `buildNavCandidates(...)` so the existing flow is preserved.
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 3.2 Write property test for nav-candidate construction
    - **Property 9: External-navigation candidate construction is unchanged**
    - **Validates: Requirements 7.2, 7.3**

  - [ ]* 3.3 Write integration test for navigation fall-through (mocked `Linking`)
    - First openable candidate opens; falls through to the Google web link; null coords show the
      existing alert and open no URL.
    - _Requirements: 3.4, 7.2, 7.3_

- [ ] 4. Checkpoint - Ensure all helper and component tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Capture driver coordinates inside the existing location loop
  - In `app/order/[id].tsx`, add `mapRef = useRef<YandexMapHandle>(null)`,
    `driverCoords` state (`Coords | null`), and `mapReady` state (`boolean`).
  - Augment the EXISTING `sendOnce` in the ~10s loop to also call
    `setDriverCoords({ lat, lon })` alongside the existing `updateDriverLocation(lat, lon)`.
  - Do NOT add a second polling loop; reuse the existing `cancelled` guard to prevent post-unmount
    state writes.
  - _Requirements: 4.1, 4.2, 4.5, 6.1, 6.3_

  - [ ]* 5.1 Write integration test for the single location loop (mocked `expo-location`)
    - Assert mounting an active order calls `requestForegroundPermissionsAsync` and exactly one
      ~10s interval feeds both `updateDriverLocation` and `driverCoords` (no second loop).
    - _Requirements: 4.1, 4.2, 4.5_

  - [ ]* 5.2 Write integration test for post-unmount safety
    - A position promise resolving after unmount performs no state update and no handle call.
    - _Requirements: 6.3_

- [x] 6. Add the map-update effect
  - In `app/order/[id].tsx`, add a `useEffect` keyed on
    `[mapReady, driverCoords, order?.from_lat, order?.from_lon]` that: bails when `!mapReady`;
    when `deriveShouldDrawRoute(driver, pickup)` calls `mapRef.current.drawRoute([driver],[pickup])`
    then `fitBounds(deriveMarkers(pickup, driver))`; else when pickup exists calls
    `setCenter(pickup)`.
  - _Requirements: 5.1, 5.2, 5.5, 6.1, 6.2_

  - [ ]* 6.1 Write property test for fit-bounds enclosure
    - Assert the marker set passed to `fitBounds` is exactly `{pickup, driver}` and the bounds
      enclose both coordinates.
    - **Property 6: Fit-bounds encloses both points**
    - **Validates: Requirements 5.2**

  - [ ]* 6.2 Write integration test for route-build failure resilience
    - Force a `ymaps.route` rejection; assert markers remain and no error is thrown.
    - _Requirements: 5.3_

- [x] 7. Render the map card and pickup-unavailable message on the screen
  - In `app/order/[id].tsx`, render a fixed-height map card near the top of the `ScrollView`
    (below the banner, above the passenger card), gated on `deriveMapVisible(order)`.
  - Pass derived `markers`, `initialLat/initialLon` from `deriveInitialCenter`, and
    `ref={mapRef}` / `onMapReady={() => setMapReady(true)}` to `<YandexMap>`.
  - When `derivePickupUnavailable(order)` is true, show the inline "pickup location unavailable"
    message inside the map card instead of a pickup marker.
  - Preserve the loading view (with the existing `t('common.loading')` fallback cue) when
    `order === null`, and leave the footer (Navigatsiya + Complete) and all existing cards
    unchanged.
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.1, 2.2, 3.1, 3.2, 3.3, 4.4, 7.1, 8.3_

  - [ ]* 7.1 Write example/render tests for the screen
    - Order-loaded render shows the map card alongside passenger card, route rows, Navigatsiya, and
      Complete; `order === null` renders the loading view and does not mount the WebView;
      driver-pending indicator shows when permission granted but no coords yet; error overlay shown
      while Navigatsiya still triggers `openNavigation`.
    - _Requirements: 1.2, 1.4, 1.5, 4.4, 7.1, 8.3_

- [x] 8. Provision the Yandex API key configuration
  - Add `"yandexJsApiKey"` to the `extra` block of `sarix-go-driver/app.json` (alongside
    `apiBaseUrl`), and/or document `EXPO_PUBLIC_YANDEX_JS_API_KEY` in the driver app's
    `.env.example`.
  - Verify that with an empty/absent key the screen still renders and the component surfaces the
    error overlay rather than crashing.
  - _Requirements: 8.4_

  - [ ]* 8.1 Write example test for the empty-key path
    - Empty API key → screen renders without crash; overlay surfaces error state.
    - _Requirements: 8.4_

- [ ] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements (and properties) for traceability.
- Property tests use `fast-check` at ≥100 iterations and are tagged
  `Feature: driver-pickup-map, Property {n}: {property_text}`.
- The 9 design properties map to test sub-tasks 1.1, 2.3–2.8, 3.2, and 6.1.
- No backend changes are involved; all work is in `sarix-go-driver`.
