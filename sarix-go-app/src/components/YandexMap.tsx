import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, View, ViewStyle, StyleProp } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import Constants from 'expo-constants';

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  label?: string;
  color?: string;
}

export interface YandexMapProps {
  initialLat?: number;
  initialLon?: number;
  initialZoom?: number;
  markers?: MapMarker[];
  showUserLocation?: boolean;
  onMapReady?: () => void;
  onMarkerPress?: (id: string) => void;
  onMapPress?: (lat: number, lon: number) => void;
  onCameraMove?: (lat: number, lon: number, zoom: number) => void;
  style?: StyleProp<ViewStyle>;
}

export interface YandexMapHandle {
  setCenter: (lat: number, lon: number, zoom?: number) => void;
  fitBounds: (markers: MapMarker[]) => void;
  drawRoute: (from: [number, number], to: [number, number]) => void;
}

const YANDEX_API_KEY =
  process.env.EXPO_PUBLIC_YANDEX_MAPS_KEY ||
  (Constants.expoConfig?.extra as any)?.yandexMapsApiKey ||
  '';

// Default center: Termiz, Surxondaryo
const DEFAULT_LAT = 37.224;
const DEFAULT_LON = 67.278;
const DEFAULT_ZOOM = 11;

const YandexMap = forwardRef<YandexMapHandle, YandexMapProps>((props, ref) => {
  const webViewRef = useRef<WebView>(null);

  const html = generateMapHtml({
    apiKey: YANDEX_API_KEY,
    initialLat: props.initialLat ?? DEFAULT_LAT,
    initialLon: props.initialLon ?? DEFAULT_LON,
    initialZoom: props.initialZoom ?? DEFAULT_ZOOM,
    markers: props.markers ?? [],
  });

  const sendCommand = (cmd: object) => {
    const js = `(function(){window.handleCommand && window.handleCommand(${JSON.stringify(cmd)});})();true;`;
    webViewRef.current?.injectJavaScript(js);
  };

  useImperativeHandle(ref, () => ({
    setCenter: (lat, lon, zoom) => sendCommand({ type: 'setCenter', lat, lon, zoom }),
    fitBounds: (markers) => sendCommand({ type: 'fitBounds', markers }),
    drawRoute: (from, to) => sendCommand({ type: 'drawRoute', from, to }),
  }));

  // Update markers when props change
  useEffect(() => {
    if (props.markers) {
      sendCommand({ type: 'setMarkers', markers: props.markers });
    }
  }, [props.markers]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      switch (data.type) {
        case 'ready':
          props.onMapReady?.();
          break;
        case 'markerPress':
          props.onMarkerPress?.(data.id);
          break;
        case 'mapPress':
          props.onMapPress?.(data.lat, data.lon);
          break;
        case 'cameraMove':
          props.onCameraMove?.(data.lat, data.lon, data.zoom);
          break;
      }
    } catch {}
  };

  return (
    <View style={[styles.container, props.style]}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={styles.webview}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        scalesPageToFit
        scrollEnabled={false}
        bounces={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
});

YandexMap.displayName = 'YandexMap';

export default YandexMap;

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: 'transparent' },
});

interface MapHtmlOptions {
  apiKey: string;
  initialLat: number;
  initialLon: number;
  initialZoom: number;
  markers: MapMarker[];
}

function generateMapHtml(opts: MapHtmlOptions): string {
  const { apiKey, initialLat, initialLon, initialZoom, markers } = opts;
  const apiUrl = apiKey
    ? `https://api-maps.yandex.ru/2.1/?apikey=${apiKey}&lang=uz_UZ`
    : `https://api-maps.yandex.ru/2.1/?lang=uz_UZ`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Sarix Go Map</title>
<style>
  html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
  body { background: #F5F7FA; font-family: -apple-system, sans-serif; }
  .marker {
    background: #F4C430;
    border: 3px solid #0E1B3D;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  }
</style>
<script src="${apiUrl}" type="text/javascript"></script>
</head>
<body>
<div id="map"></div>
<script>
  var map;
  var markerObjects = {};
  var routeLine = null;

  function send(data) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(data));
    }
  }

  function init() {
    map = new ymaps.Map('map', {
      center: [${initialLat}, ${initialLon}],
      zoom: ${initialZoom},
      controls: ['zoomControl']
    }, {
      suppressMapOpenBlock: true
    });

    map.events.add('click', function(e) {
      var coords = e.get('coords');
      send({ type: 'mapPress', lat: coords[0], lon: coords[1] });
    });

    map.events.add('boundschange', function() {
      var center = map.getCenter();
      send({
        type: 'cameraMove',
        lat: center[0],
        lon: center[1],
        zoom: map.getZoom()
      });
    });

    setMarkers(${JSON.stringify(markers)});
    send({ type: 'ready' });
  }

  function setMarkers(markers) {
    // Clear old
    for (var key in markerObjects) {
      map.geoObjects.remove(markerObjects[key]);
    }
    markerObjects = {};

    markers.forEach(function(m) {
      var placemark = new ymaps.Placemark(
        [m.lat, m.lon],
        { iconCaption: m.label || '' },
        {
          preset: 'islands#yellowDotIcon',
          iconColor: m.color || '#F4C430'
        }
      );
      placemark.events.add('click', function() {
        send({ type: 'markerPress', id: m.id });
      });
      map.geoObjects.add(placemark);
      markerObjects[m.id] = placemark;
    });
  }

  function setCenter(lat, lon, zoom) {
    map.setCenter([lat, lon], zoom || map.getZoom(), { duration: 500 });
  }

  function fitBounds(markers) {
    if (!markers || markers.length === 0) return;
    var bounds = markers.map(function(m) { return [m.lat, m.lon]; });
    map.setBounds(
      [
        [Math.min.apply(null, bounds.map(function(b){return b[0];})),
         Math.min.apply(null, bounds.map(function(b){return b[1];}))],
        [Math.max.apply(null, bounds.map(function(b){return b[0];})),
         Math.max.apply(null, bounds.map(function(b){return b[1];}))]
      ],
      { checkZoomRange: true, zoomMargin: 50 }
    );
  }

  function drawRoute(from, to) {
    if (routeLine) {
      map.geoObjects.remove(routeLine);
    }
    ymaps.route([from, to], { mapStateAutoApply: true }).then(function(route) {
      routeLine = route;
      map.geoObjects.add(route);
    }, function(err) {
      console.error('Route error:', err);
    });
  }

  window.handleCommand = function(cmd) {
    switch (cmd.type) {
      case 'setCenter': setCenter(cmd.lat, cmd.lon, cmd.zoom); break;
      case 'setMarkers': setMarkers(cmd.markers || []); break;
      case 'fitBounds': fitBounds(cmd.markers || []); break;
      case 'drawRoute': drawRoute(cmd.from, cmd.to); break;
    }
  };

  ymaps.ready(init);
</script>
</body>
</html>`;
}
