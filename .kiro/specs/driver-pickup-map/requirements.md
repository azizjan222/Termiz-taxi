# Requirements Document

## Introduction

This feature adds an in-app map to the **driver** mobile application (Expo / React Native app located at `sarix-go-driver`) for the "Termiz-taxi" / "Sarix Go" platform. Today, after a driver accepts an order, the order detail screen (`app/order/[id].tsx`) displays the passenger's name, phone, and the `from_city → to_city` route as **text only**. There is no visual map, so a driver cannot see exactly where the passenger is waiting without leaving the app for an external navigation application.

The goal is to give the driver three complementary capabilities on the accepted-order detail screen:

1. **In-app pickup visualization** — show the passenger's exact pickup location as a pin on an embedded map inside the driver app.
2. **In-app route preview** — draw the driving route from the driver's own current GPS location to the passenger's pickup location, automatically framing both points.
3. **Preserved external navigation** — keep the existing external navigation option (Yandex Navigator / Yandex Maps / Apple Maps / Google Maps) working exactly as it does today, as a secondary turn-by-turn option.

To minimize risk and effort, the in-app map reuses the design and behavior of the existing passenger-app map component (`sarix-go-app/src/components/YandexMap.tsx`), a WebView-based Yandex Maps component that already exposes `setCenter`, `fitBounds`, and `drawRoute`, supports markers, fires `onMapReady`, and includes a built-in load/error overlay. The driver app already includes the required dependencies (`react-native-webview`, `expo-constants`, `expo-location`), already declares location permissions in `app.json`, and already acquires the driver's GPS every ~10 seconds while an order is `accepted` or `in_progress`.

This feature is **frontend-only** for the driver app. No backend changes are expected. The order payload already carries the passenger pickup coordinates (`from_lat`, `from_lon`) and the supporting API functions (`listMyActive`, `updateDriverLocation`) already exist.

## Glossary

- **Driver_App**: The Expo / React Native driver mobile application located at `sarix-go-driver`.
- **Order_Detail_Screen**: The driver screen at `sarix-go-driver/app/order/[id].tsx` that displays an accepted order's details.
- **Driver_Map**: The new in-app, WebView-based Yandex map component added to the Driver_App, modeled on the passenger app's `YandexMap` component.
- **Map_Handle**: The imperative interface exposed by the Driver_Map (modeled on `YandexMapHandle`), providing `setCenter`, `fitBounds`, and `drawRoute` operations.
- **Pickup_Location**: The passenger's exact waiting/pickup coordinates, taken from the order's `from_lat` and `from_lon` fields.
- **Pickup_Marker**: A map pin rendered by the Driver_Map at the Pickup_Location.
- **Driver_Location**: The driver device's current GPS position (latitude, longitude) obtained via `expo-location`.
- **Driver_Marker**: A map pin rendered by the Driver_Map at the Driver_Location.
- **Route_Line**: The visual driving route drawn on the Driver_Map between the Driver_Location and the Pickup_Location.
- **External_Navigation**: The existing `openNavigation()` behavior that opens an external maps application (Yandex Navigator, Yandex Maps, Apple Maps, or Google Maps) routed to the Pickup_Location.
- **Navigation_Button**: The existing on-screen "🧭 Navigatsiya" button that triggers External_Navigation.
- **Location_Permission**: The device foreground location permission requested via `expo-location`'s `requestForegroundPermissionsAsync`.
- **Location_Polling**: The existing mechanism that reads the Driver_Location and calls `updateDriverLocation` approximately every 10 seconds while the order status is `accepted` or `in_progress`.
- **Active_Order**: An order whose status is `accepted` or `in_progress`.
- **Map_API_Key**: The Yandex JavaScript Maps API key read from `EXPO_PUBLIC_YANDEX_JS_API_KEY` or `expoConfig.extra.yandexJsApiKey`.
- **Map_Error_Overlay**: The built-in overlay shown by the map component when the map fails to load (network failure, missing/invalid API key, or API timeout).

## Requirements

### Requirement 1: Render the in-app map on the accepted-order screen

**User Story:** As a driver, I want an embedded map on the accepted-order screen, so that I can see the pickup situation without leaving the app.

#### Acceptance Criteria

1. WHEN the Order_Detail_Screen displays an Active_Order, THE Driver_App SHALL render the Driver_Map within the Order_Detail_Screen.
2. WHERE the order data has not yet loaded, THE Order_Detail_Screen SHALL display the existing loading indicator and SHALL NOT render the Driver_Map.
5. IF the loading indicator cannot be displayed, THEN THE Order_Detail_Screen SHALL display a fallback textual cue indicating the order is loading.
3. THE Driver_Map SHALL reuse the WebView-based Yandex map design and behavior of the passenger app's map component, including the Map_API_Key resolution order (`EXPO_PUBLIC_YANDEX_JS_API_KEY` then `expoConfig.extra.yandexJsApiKey`).
4. THE Driver_App SHALL preserve all existing Order_Detail_Screen elements (passenger card, route text, departure time, person count, price, note, contact countdown, call button, and Complete button) when the Driver_Map is rendered.

### Requirement 2: Display the passenger pickup pin

**User Story:** As a driver, I want to see the passenger's exact pickup location as a pin on the map, so that I know precisely where to go.

#### Acceptance Criteria

1. WHERE the Active_Order has a non-null `from_lat` and a non-null `from_lon`, THE Driver_Map SHALL render a Pickup_Marker at the Pickup_Location.
2. WHEN only the Pickup_Location is available and the Driver_Location is not yet available, THE Driver_Map SHALL center on the Pickup_Location.
3. THE Pickup_Marker SHALL be visually distinguishable from the Driver_Marker.

### Requirement 3: Handle missing or invalid pickup coordinates

**User Story:** As a driver, I want the screen to stay usable when the pickup coordinates are missing, so that a data gap does not break my workflow.

#### Acceptance Criteria

1. IF the Active_Order has a null or missing `from_lat` or `from_lon`, THEN THE Driver_Map SHALL NOT render a Pickup_Marker.
2. IF the Active_Order has a null or missing `from_lat` or `from_lon`, THEN THE Order_Detail_Screen SHALL display a message indicating the pickup location is unavailable.
3. IF the Active_Order has a null or missing `from_lat` or `from_lon`, THEN THE Driver_App SHALL keep the remainder of the Order_Detail_Screen functional without a runtime error.
4. IF the Active_Order has a null or missing `from_lat` or `from_lon` AND the driver activates the Navigation_Button, THEN THE Driver_App SHALL display the existing alert stating the passenger location is unavailable.

### Requirement 4: Acquire the driver's current location

**User Story:** As a driver, I want the app to use my current GPS position, so that the map can show where I am relative to the passenger.

#### Acceptance Criteria

1. WHEN the Order_Detail_Screen displays an Active_Order, THE Driver_App SHALL request Location_Permission using the existing foreground permission flow.
2. WHERE Location_Permission is granted, THE Driver_App SHALL obtain the Driver_Location using the existing Location_Polling mechanism.
3. WHERE Location_Permission is granted AND the Driver_Location is available, THE Driver_Map SHALL render a Driver_Marker at the Driver_Location.
4. WHERE Location_Permission is granted AND the Driver_Location is not yet available, THE Driver_Map SHALL display an indicator (a loading state or, where it exists, the last known Driver_Location) rather than no driver feedback.
5. THE Driver_App SHALL reuse the existing Location_Permission request and the existing Location_Polling, which runs on an approximately-10-second interval (acceptable variance of 8 to 12 seconds), without introducing a second independent polling loop.

### Requirement 5: Draw and frame the driver-to-pickup route

**User Story:** As a driver, I want to see the route from my location to the passenger, so that I can understand the path before I start driving.

#### Acceptance Criteria

1. WHERE both the Driver_Location and the Pickup_Location are available, THE Driver_Map SHALL draw a Route_Line from the Driver_Location to the Pickup_Location.
2. WHEN both the Driver_Marker and the Pickup_Marker are present, THE Driver_Map SHALL auto-fit the map view so that both points are visible.
3. IF building the Route_Line fails, THEN THE Driver_Map SHALL continue to display the Pickup_Marker and (where available) the Driver_Marker without a runtime error.
4. IF Location_Permission is denied, THEN THE Driver_Map SHALL display the Pickup_Marker centered on the Pickup_Location and SHALL NOT draw a Route_Line.
5. WHILE the Driver_Location is not yet available, THE Driver_Map SHALL display the available markers and SHALL NOT draw a Route_Line.

### Requirement 6: Update the driver position and route as the driver moves

**User Story:** As a driver, I want the map to keep up with my movement, so that the displayed position and route stay accurate while I drive to the passenger.

#### Acceptance Criteria

1. WHEN the Location_Polling reports an updated Driver_Location, THE Driver_Map SHALL update the Driver_Marker to the updated Driver_Location.
2. WHEN the Location_Polling reports an updated Driver_Location AND the Pickup_Location is available, THE Driver_Map SHALL redraw the Route_Line from the updated Driver_Location to the Pickup_Location.
3. WHEN the Order_Detail_Screen is unmounted, THE Driver_App SHALL stop pushing Driver_Map updates to the unmounted Driver_Map, WHILE the underlying Location_Polling lifecycle remains governed by the order status (active for `accepted` or `in_progress`).

### Requirement 7: Preserve external navigation as a secondary option

**User Story:** As a driver, I want to still open external turn-by-turn navigation, so that I keep my preferred navigation app for the actual drive.

#### Acceptance Criteria

1. THE Order_Detail_Screen SHALL continue to display the Navigation_Button.
2. WHEN the driver activates the Navigation_Button AND the Pickup_Location is available, THE Driver_App SHALL open External_Navigation routed to the Pickup_Location using the existing candidate-URL order (Yandex Navigator, then Yandex Maps, then the platform geo/Apple Maps fallback, then the Yandex web link, then the Google Maps web link).
3. THE Driver_App SHALL keep the External_Navigation behavior unchanged from its current implementation.

### Requirement 8: Map load and offline error handling

**User Story:** As a driver, I want clear feedback when the map cannot load, so that I am not stuck looking at a blank area and can still use external navigation.

#### Acceptance Criteria

1. IF the Driver_Map fails to load due to a network failure, a missing or invalid Map_API_Key, or an API load timeout, THEN THE Driver_Map SHALL display the Map_Error_Overlay describing the failure.
2. WHILE the Driver_Map is loading, THE Driver_Map SHALL display a loading indicator.
3. IF the Driver_Map displays the Map_Error_Overlay, THEN THE Order_Detail_Screen SHALL keep the Navigation_Button and all other existing screen elements functional.
4. WHERE the Map_API_Key is absent from the Driver_App configuration, THE Driver_App SHALL still render the Order_Detail_Screen and surface the Map_Error_Overlay rather than crashing.

## Configuration Note

The driver app's `app.json` `extra` block currently contains only `apiBaseUrl` and does **not** define `yandexJsApiKey`. The Driver_Map relies on the Map_API_Key (`EXPO_PUBLIC_YANDEX_JS_API_KEY` or `expoConfig.extra.yandexJsApiKey`). Provisioning this key is a deployment/configuration consideration captured by Requirement 8.1 and 8.4: without the key, the map will surface the Map_Error_Overlay rather than crash, and external navigation will continue to function. The actual key provisioning is an environment/configuration action outside the code scope of this feature.
