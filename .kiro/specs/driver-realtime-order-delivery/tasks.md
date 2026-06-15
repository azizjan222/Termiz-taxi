# Implementation Plan

- [ ] 1. Set up realtime test harness (fake WebSocket + controllable AppState)
  - Add a fake `WebSocket` test double that records constructed URLs, lets tests drive
    `onopen`/`onmessage`/`onclose`/`onerror`, and tracks `readyState` and sent frames (so `ping`
    keep-alive and dead-socket detection are observable)
  - Add a controllable `AppState` mock that lets tests dispatch `active`/`background` transitions
  - Provide a fake timer setup so backoff/ping intervals are deterministic
  - This harness backs every test below; no production behavior is changed here
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 2. Write bug condition exploration test (BEFORE implementing the fix)
  - **Property 1: Bug Condition** - Persistent Global Real-Time Delivery
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists (screen-scoped socket + no reconnect)
  - **Scoped PBT Approach**: Scope the property to the concrete bug-condition cases from the design's
    `isBugCondition` (authenticated driver with a usable `telegram_id` and no globally-owned OPEN socket)
  - Encode the design's Exploratory test cases against the UNFIXED `app/(main)/orders.tsx` flow using
    the fake WebSocket:
    - Off-screen delivery: authenticated, Orders screen unmounted, server emits `new_order` → expect
      order delivered + alert fired (Bug 1.1)
    - Detail-screen delivery: same with a detail screen active (Bug 1.1)
    - Reconnect after drop: Orders screen mounted, socket `onclose`/`onerror`, then `new_order`
      arrives → expect reconnect + delivery (Bug 1.2)
    - Foreground recovery: app backgrounded (socket closed) then foregrounded, `new_order` arrives →
      expect reconnect + delivery (Bug 1.2, 1.3)
  - The test assertions match Property 1 (connection reaches OPEN, de-duplicated list update, loud
    alert fires on any screen, `order_cancelled` removes the order)
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found (no `new_order`/alert when Orders tab not mounted; socket stays
    CLOSED after a drop) to confirm the root-cause analysis
  - Mark task complete when the test is written, run, and the failure is documented
  - _Bug_Condition: isBugCondition(X) from design (authenticated, no globally-owned OPEN socket)_
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 3. Write preservation property tests (BEFORE implementing the fix)
  - **Property 2: Preservation** - Unchanged Orders / Polling / Accept / Gating Behavior
  - **IMPORTANT**: Follow observation-first methodology - observe behavior on UNFIXED code, then
    write property-based tests that assert those observed outputs across the non-buggy domain
  - Capture the design's Preservation test cases against the UNFIXED code:
    - Orders-tab delivery: tab mounted + socket OPEN, a `new_order` updates the list + fires the
      alert exactly once (3.1)
    - Polling: `load()` runs every 15s and refreshes the list regardless of socket state (3.2)
    - Accept flow: trial/commission/balance checks, `acceptOrder`, haptic success, navigation to
      `/order/[id]` behave identically (3.3)
    - Online toggle: `toggleOnline` updates the driver store + calls `apiSetOnline` as before (3.3)
    - canReceive gating: when `can_receive === false`, incoming `new_order` events are ignored and
      the top-up banner shows (3.4)
    - Single-connection invariant: navigating to/from the Orders tab never opens a second socket;
      repeated `connect` calls are idempotent (3.5)
    - Dedup: repeated `new_order` with an existing id does not create duplicate entries (2.3/3.1)
  - **Property-based** generators: random sequences of `new_order`/`order_cancelled` events, random
    online-toggle sequences, and poll-arriving-alongside-realtime-event interleavings
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Preservation: Preservation Requirements from design_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. Checkpoint - exploration fails, preservation passes on UNFIXED code
  - Confirm task 2 (exploration) FAILS and task 3 (preservation) PASSES on the unfixed code
  - This is the green-light to begin implementing the fix; if exploration unexpectedly passes,
    re-hypothesize the root cause before proceeding
  - Ask the user if questions arise

- [x] 5. Fix for off-screen / dropped real-time order delivery

  - [x] 5.1 Build the singleton realtime WebSocket manager
    - Create `src/services/realtime.ts` owning exactly one module-level `WebSocket | null`
    - Idempotent `connect(telegramId)`: no-op if a socket is already CONNECTING/OPEN for the same id;
      close and reopen if the id changed (guarantees no duplicate sockets)
    - Open `new WebSocket(\`${WS_URL}?role=driver&id=${telegramId}\`)` reusing `WS_URL` from
      `src/api/client.ts` (same URL/format as the current code)
    - Exponential-backoff reconnect on `onclose`/`onerror` (1s → 2s → 5s → 10s, capped), reset to the
      first step on a successful `onopen`; skip reconnect if intentionally disconnected
    - ~25s keep-alive ping ({"type":"ping"}) on `onopen` with last-activity tracking + dead-socket
      detection (force-close + reconnect on no traffic); clear timers on close
    - `disconnect()`: set intentional-close flag, clear timers, close the socket (no reconnect)
    - _Bug_Condition: isBugCondition(X) from design_
    - _Expected_Behavior: expectedBehavior(result) - single OPEN connection that auto-reconnects_
    - _Preservation: single-connection-per-driver invariant_
    - _Requirements: 2.1, 2.2, 3.5_

  - [x] 5.2 Build the realtime Zustand store
    - Create `src/store/realtime.ts` with `status`, `lastEvent`
      ({ kind: 'new_order' | 'order_cancelled', order?, orderId?, seq }), and an `incomingOrders` buffer
    - Actions `pushNewOrder(order)`, `pushCancelled(orderId)`, `setStatus(status)` used by the manager
    - Monotonically increasing `seq` so screens consume each event exactly once (no re-processing on
      re-render)
    - _Expected_Behavior: events published to shared state for any screen to consume_
    - _Requirements: 2.3_

  - [x] 5.3 Wire the global message handler into the manager
    - In `onmessage`, parse JSON; on `new_order` fire `playNewOrderAlert(...)` +
      `Haptics.notificationAsync(Success)` + `addNotification(...)` (moved here from the screen) and
      call `pushNewOrder(order)`; on `order_cancelled` call `pushCancelled(order_id)`; ignore `pong`
    - Push `status` updates (connecting | open | closed | reconnecting) into the store
    - _Expected_Behavior: alert fires globally + events published on new_order/order_cancelled_
    - _Requirements: 2.1, 2.3_

  - [x] 5.4 Mount the connection lifecycle in `app/_layout.tsx`
    - Add an effect keyed on `isAuthenticated` + `driver?.telegram_id`: connect on auth with an id,
      `disconnect()` on logout / id loss
    - Add an `AppState` listener: on transition to `active` while authenticated and socket not OPEN,
      trigger reconnect (manager guards against duplicates)
    - Remove the `AppState` subscription on unmount (cleanup)
    - _Bug_Condition: isBugCondition(X) - reconnect on foreground when socket not OPEN_
    - _Expected_Behavior: persistent connection whenever authenticated, survives screen changes_
    - _Requirements: 2.1, 2.2_

  - [x] 5.5 Refactor `app/(main)/orders.tsx` to consume the global store
    - Delete the per-screen WebSocket `useEffect` (`new WebSocket(...)`, `wsRef`, `onmessage`,
      `onerror`, and the `ws.close()` cleanup)
    - Remove the now-global alert side effects (`playNewOrderAlert`, `Haptics`, `addNotification`) so
      the loud alert is not duplicated
    - Subscribe to the realtime store `lastEvent`/`seq`; on each unconsumed event: if `new_order` and
      `canReceiveRef.current`, merge de-duplicated into `orders` (same `prev.find((o) => o.id === ...)`
      guard); if `order_cancelled`, filter it out; keep ignoring events when `!canReceive`
    - KEEP untouched: `load()`, the `setInterval(load, 15000)` polling, `toggleOnline`, `handleAccept`,
      `canReceive`/`receiveMsg` state, the top-up banner, and all rendering
    - _Bug_Condition: isBugCondition(X) from design_
    - _Expected_Behavior: de-duplicated list update on new_order, removal on order_cancelled_
    - _Preservation: Orders display, polling, accept, online toggle, canReceive gating unchanged_
    - _Requirements: 2.1, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 5.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Persistent Global Real-Time Delivery
    - **IMPORTANT**: Re-run the SAME test from task 2 - do NOT write a new test
    - The test from task 2 encodes the expected behavior; when it passes it confirms the fix
    - Run the exploration test from step 2
    - **EXPECTED OUTCOME**: Test PASSES (confirms the bug is fixed - delivery + alert work off-screen
      and after reconnect)
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 5.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Unchanged Orders / Polling / Accept / Gating Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 3 - do NOT write new tests
    - Run the preservation property tests from step 3
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions to Orders display, polling, accept,
      online toggle, canReceive gating, and the single-connection invariant)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 6. Add focused unit and property-based tests for the new modules
  - [ ]* 6.1 Realtime manager unit tests
    - Idempotent `connect`, single-socket guarantee, backoff schedule + reset on open, ping interval
      send, dead-socket detection, clean `disconnect` (no reconnect after intentional close)
    - _Requirements: 2.2, 3.5_
  - [ ]* 6.2 Global message handler unit tests
    - `new_order` → alert + store publish; `order_cancelled` → store removal; `pong`/unknown ignored
    - _Requirements: 2.1, 2.3_
  - [ ]* 6.3 Order-list integrity property test
    - For all sequences of `new_order`/`order_cancelled`, the list equals the de-duplicated set of
      added-minus-cancelled orders
    - _Requirements: 2.3, 3.1_
  - [ ]* 6.4 Reconnect single-socket invariant property test
    - For all random close/error timings, at most one socket is ever open and backoff never exceeds
      the cap
    - _Requirements: 2.2, 3.5_

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure the exploration test (task 2) now passes, all preservation tests (task 3) still pass, and
    any unit/property-based tests run; ask the user if questions arise
