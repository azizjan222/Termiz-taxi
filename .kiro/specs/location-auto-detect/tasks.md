# Implementation Plan: Location Auto-Detect

## Overview

This plan implements the one-tap "detect my current location" capability for the map-based
address picker (`sarix-go-app/app/map-select.tsx`). Work proceeds bottom-up: first the new,
UI-agnostic `Location_Service` wrapper around `expo-location`, then the pure orchestration
logic and screen state in `map-select.tsx`, then the button UI and map-ref wiring, and finally
the reverse-geocode reuse and confirm path. Each step builds on the previous one and ends with
the pieces wired together so there is no orphaned code.

Language: **TypeScript** (React Native / Expo), matching the existing app. Property-based tests
use **fast-check** (minimum 100 iterations per property); component tests use React Native
Testing Library. Test sub-tasks are marked optional with `*`.

## Tasks

- [x] 1. Create the Location_Service module with the DetectResult type contract
  - Create `sarix-go-app/src/services/location.ts`
  - Define the discriminated union types `DetectSuccess`, `DetectError`, `DetectResult` and the `DetectOptions` interface exactly as in the design (success carries `lat`, `lon`, `accuracy: number | null`; error variants `permission-denied` | `services-disabled` | `timeout` | `error` with optional `message`)
  - Export a `detectLocation(opts?: DetectOptions): Promise<DetectResult>` stub that compiles, with `timeoutMs` defaulting to `15000`
  - _Requirements: 3.1_

- [x] 2. Implement Location_Service permission, services, and acquisition logic
  - [x] 2.1 Implement permission handling
    - Call `getForegroundPermissionsAsync()`; if already denied and not requestable, short-circuit to `{ status: 'permission-denied' }` without re-prompting
    - When undetermined, call `requestForegroundPermissionsAsync()`; if the result is not `granted`, return `{ status: 'permission-denied' }`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.2 Implement services-enabled check
    - After permission is granted, call `hasServicesEnabledAsync()`; if `false`, return `{ status: 'services-disabled' }`
    - _Requirements: 3.5_

  - [x] 2.3 Implement bounded position acquisition
    - Call `getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })` raced via `Promise.race` against a `timeoutMs` (15000) timer
    - On first fix, return `{ status: 'success', lat, lon, accuracy }` (use `coords.accuracy`, may be `null`)
    - When the timer wins, return `{ status: 'timeout' }`; wrap the whole flow in `try/catch` returning `{ status: 'error', message }` on any thrown error so the service never throws
    - _Requirements: 3.1, 3.2, 3.4, 7.2, 7.5_

  - [ ]* 2.4 Write example/edge-case unit tests for Location_Service
    - Mock `expo-location`: undetermined → request issued; granted → acquire without re-prompt; already-denied → no re-prompt; services disabled → `services-disabled`; first fix returned with `Balanced`; timer wins → `timeout`; thrown error → `error`
    - Use fake timers for the 15 s race and the >60 s permission-hang edge case
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 3.2, 3.5, 7.2, 7.5_

- [ ] 3. Checkpoint - Location_Service compiles and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add screen state, constants, and map ref to map-select.tsx
  - Add constants `DETECTION_TIMEOUT_MS = 15000`, `ACCURACY_THRESHOLD_M = 100`, `DETECT_ZOOM = 16` (reuse existing `DEFAULT_LAT`/`DEFAULT_LON`)
  - Add `detecting: boolean` state and `notice: { kind: 'permission' | 'services' | 'timeout' | 'error' | 'low-accuracy' | 'no-address'; text: string } | null` state
  - Add `const mapRef = useRef<YandexMapHandle>(null);` and pass `ref={mapRef}` to the existing `<YandexMap />` element (no change to `YandexMap.tsx`; it is already a `forwardRef`)
  - _Requirements: 1.4, 4.1, 4.3, 6.1_

  - [ ]* 4.1 Write property test for initial center selection
    - **Property 9: Initial center selection from store or default**
    - Generate arbitrary Order_Store states and `mode ∈ {from, to}`; assert initial center equals the stored coordinate when both lat and lon are present, otherwise the Default_Center (37.224, 67.278)
    - **Validates: Requirements 7.4**

- [x] 5. Implement the handleDetectLocation orchestrator
  - [x] 5.1 Implement the re-entrancy guard and success/accuracy-gating branch
    - At entry, return early if `detecting` is true; otherwise clear `notice` and set `detecting = true`; reset `detecting` in a `finally` block
    - Call `detectLocation({ timeoutMs: DETECTION_TIMEOUT_MS })`; on `success` with `accuracy == null || accuracy <= ACCURACY_THRESHOLD_M`, update `center` state to `(lat, lon)`, call `mapRef.current?.setCenter(lat, lon, DETECT_ZOOM)`, and invoke existing `resolveAddress(lat, lon)`
    - On `success` with `accuracy > ACCURACY_THRESHOLD_M`, set a `low-accuracy` notice prompting manual pin adjustment and leave `center` unchanged (do not call `setCenter`)
    - _Requirements: 1.4, 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 7.1_

  - [x] 5.2 Implement error-variant handling
    - Map each error variant to its inline notice: `permission-denied` → permission required; `services-disabled` → enable location services; `timeout` → detection timed out; `error` → detection failed — leaving the map center unchanged in all cases
    - _Requirements: 2.3, 2.5, 3.4, 3.5, 3.6, 7.2, 7.5, 7.6_

  - [ ]* 5.3 Write property test for successful recenter at zoom 16
    - **Property 1: Successful detection recenters the map at street-level zoom**
    - Generate success results with accuracy ≤ 100 m or `null`; assert center is set to `(lat, lon)` and the map handle is called with zoom exactly 16
    - **Validates: Requirements 3.3, 4.1, 4.2, 4.3**

  - [ ]* 5.4 Write property test for low-accuracy rejection
    - **Property 2: Low-accuracy fixes are rejected without moving the map**
    - Generate success results with accuracy > 100 m; assert center unchanged, recenter handle not called, and a low-accuracy notice is set
    - **Validates: Requirements 4.4, 4.5, 7.1**

  - [ ]* 5.5 Write property test for error outcomes never mutating center
    - **Property 3: Error outcomes never mutate the map center**
    - Generate all error variants; assert center unchanged, recenter handle not called, and a corresponding notice is set
    - **Validates: Requirements 2.3, 3.4, 3.5, 3.6, 7.2, 7.5, 7.6**

  - [ ]* 5.6 Write property test for return-to-idle invariant
    - **Property 4: Detection always returns to the idle state**
    - Generate any `DetectResult` variant; assert `detecting === false` after `handleDetectLocation` resolves
    - **Validates: Requirements 6.3, 6.4**

  - [ ]* 5.7 Write property test for concurrent-tap idempotence
    - **Property 6: Concurrent taps during detection are idempotent**
    - Generate N additional taps while `detecting === true`; assert at most one `detectLocation` call is started until the in-progress operation completes
    - **Validates: Requirement 1.4**

- [ ] 6. Checkpoint - Orchestrator logic complete and property tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement the Location_Detection_Button UI
  - Add a `TouchableOpacity` overlay on the map area with `minWidth`/`minHeight` 44 dp and `hitSlop` to guarantee a 44x44 dp tappable area, rendered for both `from` and `to` modes
  - Idle content: a location text glyph icon plus a non-empty action label (e.g., "Mening joylashuvim"); when no icon is available, render the label alone and keep the button tappable
  - Loading content: while `detecting` is true, replace the icon with `<ActivityIndicator>` (already imported) and keep the button mounted/enabled; wire `onPress` to `handleDetectLocation`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 6.1_

  - [ ]* 7.1 Write component/rendering tests for the button
    - Using React Native Testing Library: assert ≥ 44x44 dp tappable area (1.1), icon + label present (1.2), appears in both `from` and `to` modes (1.5), icon-unavailable fallback renders label-only and stays tappable (1.3)
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [x] 8. Wire detection progress feedback to the button
  - Ensure the loading indicator becomes visible synchronously when detection starts and is removed when the operation completes (success or error), restoring the idle icon-and-label state
  - Ensure the inline `notice` renders in the existing bottom card and is cleared when a new detection starts or the user manually moves the map
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 8.1 Write example tests for progress feedback
    - Assert the loading indicator is visible on start and hidden on completion; assert specific notice strings for each error/low-accuracy/no-address variant
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 9. Confirm reverse-geocode reuse and the confirm-to-store path
  - Verify `resolveAddress(lat, lon)` is invoked exactly once after the 500 ms debounce on recenter, reusing the existing stale-request guard; ensure empty/`null` geocode results surface the "Manzil topilmadi" fallback while retaining the coordinate as confirmable, and a geocode error/timeout surfaces an unresolved-address notice while retaining the coordinate
  - Verify `handleConfirm` writes `center.lat`/`center.lon`/resolved address/derived city to the `from*` fields in `from` mode and the `to*` fields in `to` mode, with city defaulting to an empty string when no city component is available
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 9.1 Write property test for single debounced reverse-geocode
    - **Property 7: Recentering triggers exactly one debounced reverse-geocode**
    - Generate a sequence of center updates ending in a final coordinate; after the 500 ms window elapses with no further updates, assert `reverseGeocode` is called exactly once with the final coordinate
    - **Validates: Requirement 5.1**

  - [ ]* 9.2 Write property test for confirm persisting to the correct mode fields
    - **Property 5: Confirm persists the detected location to the correct mode fields**
    - Generate arbitrary center coordinates, addresses, and `mode ∈ {from, to}`; assert the Order_Store receives lat/lon/address in the `from*` fields for `from` and `to*` fields for `to`, with city derived or empty
    - **Validates: Requirements 5.5, 5.6**

  - [ ]* 9.3 Write property test for manual selection remaining available after failure
    - **Property 8: Manual selection remains available after any failure**
    - Generate error variants; assert a subsequent manual camera move or map tap still updates the center coordinate (detection state never disables manual panning/tapping)
    - **Validates: Requirement 7.3**

- [ ] 10. Integration tests for the end-to-end happy path
  - [ ]* 10.1 Write integration tests with mocked expo-location and geocoder
    - With a mocked high-accuracy fix: permission granted → coordinates acquired → `setCenter(lat, lon, 16)` called → `reverseGeocode` invoked once after debounce → address shown → confirm writes correct `from*`/`to*` Order_Store fields (1–3 representative examples, not 100 iterations)
    - _Requirements: 2.2, 3.3, 4.1, 4.3, 5.1, 5.2, 5.5, 5.6_

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Each task references specific requirements (and properties, where applicable) for traceability.
- All 9 correctness properties from the design are covered by exactly one property-based test each (Properties 1–9 in tasks 4.1, 5.3–5.7, 9.1–9.3), implemented with fast-check at a minimum of 100 iterations and tagged `Feature: location-auto-detect, Property {number}: {property_text}`.
- No backend changes; `expo-location` is already installed and `app.json` permissions are already configured.
