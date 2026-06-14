# Requirements Document

## Introduction

This feature adds a "detect my current location" capability to the map-based address
picker of the Sarix Go passenger app (`sarix-go-app/app/map-select.tsx`). Today the
passenger must manually pan or tap the map to choose a point, which is then reverse-geocoded
to an address. Many ride-hailing apps offer a one-tap button that centers the map on the
device's actual GPS position and auto-fills the address, making the "from" location faster
and more accurate to set.

This document specifies the requirements for adding a Location Detection Button to the Map
Selection Screen. When pressed, the app requests location permission, acquires the device's
current GPS coordinates, recenters the map on those coordinates, and reverse-geocodes them
into an address that is shown to the passenger and used for the order. The feature must
gracefully handle permission denial, disabled location services, acquisition timeouts, and
reverse-geocoding failures, and must communicate progress and outcomes to the passenger.

The app already declares `expo-location` as a dependency and configures the required iOS and
Android location permissions in `app.json`; this feature is the first to actively use device
geolocation.

## Glossary

- **Map_Selection_Screen**: The screen implemented in `app/map-select.tsx` that lets a passenger choose a "from" or "to" point on a map and reverse-geocodes the chosen coordinate to an address.
- **Location_Detection_Button**: The new on-screen control on the Map_Selection_Screen that the passenger taps to detect the device's current location.
- **Location_Service**: The app module that wraps `expo-location` to request permission, check whether device location services are enabled, and acquire the current device coordinates.
- **Permission_Status**: The location authorization state reported by the operating system, one of "granted", "denied", or "undetermined".
- **Device_Coordinates**: A latitude/longitude pair representing the device's current physical position as reported by the operating system, accompanied by a horizontal accuracy value in meters.
- **Reverse_Geocoder**: The existing `reverseGeocode(lat, lon)` function in `src/services/geocoding.ts` that converts coordinates into a human-readable address string.
- **Order_Store**: The Zustand store (`src/store/order.ts`) holding the order draft, including the fields `fromLat`, `fromLon`, `fromCity`, `fromAddress`, `toLat`, `toLon`, `toCity`, and `toAddress`.
- **Map_Mode**: The screen parameter that indicates whether the passenger is selecting the "from" point or the "to" point, with value `from` or `to`.
- **Detection_Timeout**: The maximum duration, 15 seconds, that the Location_Service waits for Device_Coordinates before reporting a timeout error.
- **Accuracy_Threshold**: The horizontal accuracy bound, 100 meters, used to classify acquired Device_Coordinates as low-accuracy.
- **Default_Center**: The hardcoded fallback map center at latitude 37.224, longitude 67.278 (Termiz, Surxondaryo).

## Requirements

### Requirement 1: Display the Location Detection Button

**User Story:** As a passenger, I want a clearly visible "detect my location" button on the map selection screen, so that I can set my pickup point without manually searching the map.

#### Acceptance Criteria

1. WHEN the Map_Selection_Screen is displayed, THE Map_Selection_Screen SHALL render the Location_Detection_Button overlaid on the map area within 1 second of the screen displaying, with a minimum tappable area of 44x44 dp.
2. THE Location_Detection_Button SHALL display a location icon AND a non-empty text label that names the detect-current-location action.
3. IF the Location_Detection_Button icon fails to load, THEN THE Map_Selection_Screen SHALL render the Location_Detection_Button with the elements that are available, using the label alone when the icon is unavailable, AND SHALL keep the Location_Detection_Button tappable.
4. WHILE a location detection operation is in progress, bounded by the Detection_Timeout of 15 seconds, THE Map_Selection_Screen SHALL keep the Location_Detection_Button enabled, SHALL ignore additional taps on the Location_Detection_Button until the in-progress operation completes, AND SHALL show in-progress feedback on the Location_Detection_Button.
5. THE Location_Detection_Button SHALL be displayed for both the `from` Map_Mode and the `to` Map_Mode.

### Requirement 2: Request Location Permission

**User Story:** As a passenger, I want the app to ask for location permission only when I choose to detect my location, so that I stay in control of my privacy.

#### Acceptance Criteria

1. WHEN the passenger taps the Location_Detection_Button AND the Permission_Status is "undetermined", THE Location_Service SHALL request location permission from the operating system within 1 second of the tap.
2. WHEN the location permission request returns a "granted" Permission_Status, THE Location_Service SHALL begin acquiring Device_Coordinates within 1 second.
3. IF the location permission request returns a "denied" Permission_Status, THEN THE Map_Selection_Screen SHALL display a message that informs the passenger that location access is required to detect the current location and that manual map selection remains available, AND THE Location_Service SHALL retain the passenger's current Map_Selection_Screen state.
4. WHEN the passenger taps the Location_Detection_Button AND the Permission_Status is already "granted", THE Location_Service SHALL begin acquiring Device_Coordinates within 1 second without issuing a new permission request.
5. IF the passenger taps the Location_Detection_Button AND the Permission_Status is already "denied", THEN THE Map_Selection_Screen SHALL display a message that location access is required to detect the current location and that manual map selection remains available, AND THE Location_Service SHALL NOT issue a new permission request.
6. IF the location permission request returns no response within 60 seconds, THEN THE Map_Selection_Screen SHALL display a message indicating that the permission request could not be completed and that manual map selection remains available, AND THE Location_Service SHALL NOT acquire Device_Coordinates.

### Requirement 3: Acquire Device Coordinates

**User Story:** As a passenger, I want the app to read my current GPS position when I tap the button, so that my pickup point matches where I actually am.

#### Acceptance Criteria

1. WHEN the passenger taps the Location_Detection_Button AND the Permission_Status is "granted" AND device location services are enabled, THE Location_Service SHALL begin acquiring Device_Coordinates.
2. THE Location_Service SHALL return the first Device_Coordinates fix that becomes available within the Detection_Timeout (15 seconds) rather than continuing to wait for a higher-precision fix.
3. WHEN the Location_Service obtains Device_Coordinates within the Detection_Timeout (15 seconds), THE Map_Selection_Screen SHALL recenter the map on the obtained Device_Coordinates.
4. IF the Location_Service does not obtain Device_Coordinates within the Detection_Timeout (15 seconds), THEN THE Map_Selection_Screen SHALL display a timeout message indicating location detection failed AND SHALL keep the existing map center unchanged.
5. IF device location services are disabled, THEN THE Map_Selection_Screen SHALL display a message instructing the passenger to enable location services AND SHALL keep the existing map center unchanged.
6. IF the Permission_Status is not "granted" when acquisition is attempted, THEN THE Map_Selection_Screen SHALL display a message that location access is required AND SHALL keep the existing map center unchanged.

### Requirement 4: Center the Map on the Detected Location

**User Story:** As a passenger, I want the map to move to my detected location, so that I can confirm the pin is at the right spot.

#### Acceptance Criteria

1. WHEN the Location_Service returns Device_Coordinates whose horizontal accuracy is within the Accuracy_Threshold (100 meters), THE Map_Selection_Screen SHALL set the map center to the latitude and longitude of the Device_Coordinates within 1 second of receiving the Device_Coordinates.
2. WHEN the Map_Selection_Screen sets the map center to the Device_Coordinates, THE Map_Selection_Screen SHALL update the center coordinate used for confirmation to the Device_Coordinates.
3. WHEN the Map_Selection_Screen centers the map on the Device_Coordinates, THE Map_Selection_Screen SHALL set the map zoom level to a street-level value of 16.
4. IF the horizontal accuracy of the returned Device_Coordinates exceeds the Accuracy_Threshold (100 meters), THEN THE Map_Selection_Screen SHALL retain the existing map center unchanged.
5. IF the horizontal accuracy of the returned Device_Coordinates exceeds the Accuracy_Threshold (100 meters), THEN THE Map_Selection_Screen SHALL display an indication that the detected location accuracy is insufficient.

### Requirement 5: Auto-Fill the Address from the Detected Location

**User Story:** As a passenger, I want the address field to fill in automatically from my detected location, so that I do not have to type or guess the address.

#### Acceptance Criteria

1. WHEN the Map_Selection_Screen centers the map on the Device_Coordinates, THE Reverse_Geocoder SHALL be invoked once with the latitude and longitude of the Device_Coordinates after a 500-millisecond debounce.
2. WHEN the Reverse_Geocoder returns an address string for the Device_Coordinates within 10 seconds, THE Map_Selection_Screen SHALL display the returned address as the resolved address.
3. IF the Reverse_Geocoder returns no address (empty result) for the Device_Coordinates, THEN THE Map_Selection_Screen SHALL display a message that an address was not found AND SHALL retain the Device_Coordinates as the confirmable point.
4. IF the Reverse_Geocoder reports an error or does not respond within 10 seconds, THEN THE Map_Selection_Screen SHALL display a message that the address could not be resolved AND SHALL retain the Device_Coordinates as the confirmable point.
5. WHEN the passenger confirms the detected location in the `from` Map_Mode, THE Order_Store SHALL store the Device_Coordinates latitude in `fromLat`, the longitude in `fromLon`, the resolved address in `fromAddress`, and the derived city (the city component of the resolved address, or an empty string when no city component is available) in `fromCity`.
6. WHEN the passenger confirms the detected location in the `to` Map_Mode, THE Order_Store SHALL store the Device_Coordinates latitude in `toLat`, the longitude in `toLon`, the resolved address in `toAddress`, and the derived city (the city component of the resolved address, or an empty string when no city component is available) in `toCity`.

### Requirement 6: Communicate Detection Progress

**User Story:** As a passenger, I want visible feedback while my location is being detected, so that I know the app is working and not frozen.

#### Acceptance Criteria

1. WHILE a location detection operation is in progress, THE Map_Selection_Screen SHALL display a loading indicator on the Location_Detection_Button that is visually distinct from the Location_Detection_Button's idle state (the icon-and-label state defined in Requirement 1).
2. WHEN a location detection operation starts, THE Map_Selection_Screen SHALL make the loading indicator visible on the Location_Detection_Button within 200 milliseconds of the operation starting.
3. WHEN a location detection operation completes successfully, where success is defined as the Map_Selection_Screen having centered the map on the acquired Device_Coordinates, THE Map_Selection_Screen SHALL remove the loading indicator from the Location_Detection_Button within 200 milliseconds of completion AND SHALL restore the Location_Detection_Button to its idle state.
4. IF a location detection operation ends with an error, including permission denial, disabled location services, acquisition timeout, low-accuracy results beyond the Accuracy_Threshold, or a reverse-geocoding failure, THEN THE Map_Selection_Screen SHALL remove the loading indicator from the Location_Detection_Button within 200 milliseconds of the error AND SHALL restore the Location_Detection_Button to its idle state.

### Requirement 7: Handle Low-Accuracy and Error Conditions

**User Story:** As a passenger, I want the app to behave sensibly when my GPS is weak or fails, so that I can still complete my order.

#### Acceptance Criteria

1. IF the horizontal accuracy of the acquired Device_Coordinates exceeds the Accuracy_Threshold (100 meters), THEN THE Map_Selection_Screen SHALL display a low-accuracy notice within 1 second of acquisition, SHALL keep the existing map center unchanged, AND SHALL prompt the passenger to adjust the pin manually.
2. IF the Location_Service reports an error while acquiring Device_Coordinates, THEN THE Map_Selection_Screen SHALL display a message indicating that location detection failed within 1 second of the error AND SHALL keep the existing map center unchanged.
3. WHEN a location detection operation fails for any reason, THE Map_Selection_Screen SHALL keep manual map panning and tapping available for selecting a point, regardless of network or device state.
4. WHILE no location detection has been attempted, THE Map_Selection_Screen SHALL use the previously stored coordinate for the current Map_Mode, or the Default_Center (latitude 37.224, longitude 67.278) when no stored coordinate exists, as the initial map center.
5. IF the Location_Service does not return Device_Coordinates within 15 seconds, THEN THE Map_Selection_Screen SHALL treat the operation as a failed location detection, SHALL display a timeout message, AND SHALL keep the existing map center unchanged.
6. IF location permission is denied or unavailable when acquisition is attempted, THEN THE Map_Selection_Screen SHALL display a message that location access is required, SHALL keep the existing map center unchanged, AND SHALL keep manual map selection available.
