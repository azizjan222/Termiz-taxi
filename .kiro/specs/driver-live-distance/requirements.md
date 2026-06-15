# Requirements Document

## Introduction

This feature adds a **live distance readout** to the driver order detail screen of the
Sarix Go driver app (`sarix-go-driver`). After a driver accepts an order, the screen
already shows an in-app map with a pickup marker, a driver marker, and a driver→pickup
route. This feature complements that map by continuously computing and displaying the
straight-line (great-circle) distance between the driver's current GPS location and the
passenger's pickup point, and refreshing that value in near real time as the driver
drives toward the passenger.

The distance is presented in a human-friendly format: kilometers with one decimal when
the distance is one kilometer or greater, and whole meters when it is below one
kilometer. Updates are driven by frequent (meter-level) location changes rather than the
existing ten-second cadence, so the driver sees the number shrink smoothly as they
approach the pickup. The existing backend location broadcast remains on its current
cadence so that adding live updates does not increase backend traffic.

Full turn-by-turn voice navigation is **out of scope**: that capability is already
provided by the existing external "Navigatsiya" button (Yandex Navigator and fallbacks).
This feature's in-app contribution is the live distance readout, plus an optional,
clearly-marked estimated-time-of-arrival hint derived from the distance.

This feature builds directly on the `driver-pickup-map` feature and MUST NOT change or
degrade the existing map, route drawing, external navigation, backend location broadcast,
contact-window countdown, or any other current behavior of the order detail screen.

## Glossary

- **Driver_App**: The Sarix Go driver-facing Expo / React Native application
  (`sarix-go-driver`).
- **Order_Screen**: The driver order detail screen rendered by
  `app/order/[id].tsx`, which displays a single active order.
- **Distance_Module**: The pure, side-effect-free logic responsible for computing and
  formatting the driver-to-pickup distance (intended to live alongside the existing
  `driverMap.helpers.ts`).
- **Location_Watcher**: The component logic that subscribes to continuous device GPS
  updates (via `Location.watchPositionAsync`) to drive live distance refreshes.
- **Driver_Location**: The driver's current GPS coordinates, held in the existing
  `driverCoords` state as a `Coords` value `{ lat, lon }`, or `null` when not yet known.
- **Pickup_Location**: The passenger pickup coordinates derived from the order's
  `from_lat` and `from_lon` fields, or `null` when either field is missing or non-finite.
- **Coords**: A coordinate pair `{ lat: number, lon: number }` as defined in
  `driverMap.helpers.ts`.
- **Haversine_Distance**: The great-circle distance between two `Coords`, computed with
  the haversine formula, expressed in meters.
- **Distance_Label**: The formatted, human-readable distance string shown on the
  Order_Screen (for example "3.2 km" or "450 m").
- **ETA_Hint**: An optional estimated-time-of-arrival value derived from the
  Haversine_Distance and an assumed average speed (nice-to-have, not required).
- **Active_Order**: An order whose status is `accepted` or `in_progress`.
- **Backend_Broadcast**: The existing periodic call to `updateDriverLocation` that sends
  the driver's position to the backend on an approximately ten-second cadence.
- **Location_Permission**: The Android/iOS foreground location permission requested via
  `Location.requestForegroundPermissionsAsync`.

## Requirements

### Requirement 1: Compute driver-to-pickup distance

**User Story:** As a driver, I want the app to know how far I am from the passenger's
pickup point, so that I can gauge how long it will take me to reach the passenger.

#### Acceptance Criteria

1. WHEN both Driver_Location and Pickup_Location are available as finite coordinates, THE Distance_Module SHALL compute the Haversine_Distance between Driver_Location and Pickup_Location in meters.
2. THE Distance_Module SHALL compute the Haversine_Distance as a non-negative value.
3. WHEN Driver_Location and Pickup_Location are equal coordinates, THE Distance_Module SHALL compute a Haversine_Distance of zero meters.
4. IF either Driver_Location or Pickup_Location is null or contains a non-finite value, THEN THE Distance_Module SHALL return no computed distance.
5. THE Distance_Module SHALL compute the Haversine_Distance without modifying the input Driver_Location or Pickup_Location values.

### Requirement 2: Format the distance for display

**User Story:** As a driver, I want the distance shown in clear units, so that I can read it at a glance while preparing to drive.

#### Acceptance Criteria

1. WHERE the Haversine_Distance is greater than or equal to 1000 meters, THE Distance_Module SHALL format the Distance_Label in kilometers with exactly one decimal place followed by the unit "km" (for example "3.2 km").
2. WHERE the Haversine_Distance is less than 1000 meters, THE Distance_Module SHALL format the Distance_Label in whole meters followed by the unit "m" (for example "450 m").
3. WHEN formatting the Distance_Label in meters, THE Distance_Module SHALL round the Haversine_Distance to the nearest whole meter.
4. WHEN formatting the Distance_Label in kilometers, THE Distance_Module SHALL round the Haversine_Distance to one decimal place.
5. THE Distance_Module SHALL produce a Distance_Label as a non-empty string for every non-negative finite Haversine_Distance.

### Requirement 3: Display the distance on the order screen

**User Story:** As a driver, I want to see the distance to the passenger on the order screen, so that I have the information without leaving the app.

#### Acceptance Criteria

1. WHILE an Active_Order is displayed AND a Distance_Label is available, THE Order_Screen SHALL display the Distance_Label.
2. WHERE Pickup_Location is null, THE Order_Screen SHALL display a placeholder indicating the passenger location is unavailable instead of a Distance_Label.
3. WHILE Driver_Location is not yet available AND Pickup_Location is available, THE Order_Screen SHALL display a loading placeholder instead of a Distance_Label.
4. WHEN the Haversine_Distance changes such that the formatted Distance_Label changes, THE Order_Screen SHALL display the updated Distance_Label.
5. THE Order_Screen SHALL display the Distance_Label without removing or altering the existing map, pickup marker, driver marker, driver-to-pickup route, passenger card, route card, or navigation button.

### Requirement 4: Update the distance in real time

**User Story:** As a driver, I want the distance to update continuously as I drive, so that I can watch it count down meter by meter as I approach the passenger.

#### Acceptance Criteria

1. WHILE an Active_Order is displayed AND Location_Permission is granted, THE Location_Watcher SHALL subscribe to continuous device location updates with a meter-level distance interval.
2. WHEN the Location_Watcher reports a new Driver_Location, THE Order_Screen SHALL recompute the Haversine_Distance from the new Driver_Location.
3. THE Location_Watcher SHALL update Driver_Location for distance display more frequently than the ten-second Backend_Broadcast cadence.
4. THE Location_Watcher SHALL NOT change the approximately ten-second cadence of the Backend_Broadcast.
5. WHEN the Location_Watcher reports a new Driver_Location, THE Order_Screen SHALL refresh the driver marker and driver-to-pickup route consistently with the displayed Distance_Label.

### Requirement 5: Handle missing data, permissions, and lifecycle

**User Story:** As a driver, I want the app to behave gracefully when location data or permission is unavailable, so that the screen stays stable and external navigation still works.

#### Acceptance Criteria

1. IF Pickup_Location is null, THEN THE Order_Screen SHALL omit the Distance_Label and SHALL keep the external navigation button operational.
2. IF Location_Permission is denied, THEN THE Location_Watcher SHALL NOT start live distance updates AND THE Order_Screen SHALL keep the external navigation button operational.
3. WHEN the Order_Screen is unmounted, THE Location_Watcher SHALL stop the continuous location subscription and release its resources.
4. WHEN the displayed order is no longer an Active_Order, THE Location_Watcher SHALL stop the continuous location subscription.
5. IF a location update attempt fails, THEN THE Order_Screen SHALL retain the most recent Distance_Label rather than crashing or clearing the display.
6. THE Location_Watcher SHALL maintain at most one active continuous location subscription for the Order_Screen at any time.

### Requirement 6: Optional estimated-time-of-arrival hint

**User Story:** As a driver, I want an optional rough estimate of how long it will take to reach the passenger, so that I can communicate an arrival time.

#### Acceptance Criteria

1. WHERE the ETA_Hint feature is enabled AND a Haversine_Distance is available, THE Distance_Module SHALL derive an ETA_Hint from the Haversine_Distance and an assumed average speed.
2. WHERE the ETA_Hint feature is enabled, THE Distance_Module SHALL derive the ETA_Hint as a non-negative duration.
3. WHERE the ETA_Hint feature is enabled AND the Haversine_Distance is zero, THE Distance_Module SHALL derive an ETA_Hint of zero duration.
4. WHERE the ETA_Hint feature is disabled, THE Order_Screen SHALL display the Distance_Label without an ETA_Hint.

### Requirement 7: Preserve existing screen behavior

**User Story:** As a driver, I want all the features I already rely on to keep working, so that adding live distance does not disrupt my workflow.

#### Acceptance Criteria

1. THE Driver_App SHALL preserve the existing in-app map, pickup marker, driver marker, and driver-to-pickup route behavior.
2. THE Driver_App SHALL preserve the existing external navigation candidate ordering and behavior triggered by the navigation button.
3. THE Driver_App SHALL preserve the existing Backend_Broadcast behavior that sends Driver_Location to the backend for passenger tracking.
4. THE Driver_App SHALL preserve the existing contact-window countdown, passenger card, route card, and order-completion behavior on the Order_Screen.
