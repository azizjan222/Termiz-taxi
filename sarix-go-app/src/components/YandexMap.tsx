import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState, useMemo } from 'react';
import { StyleSheet, View, ViewStyle, StyleProp, Text, ActivityIndicator } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';

import { mapLang } from '../utils/yandexLocale';

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
  /**
   * Reverse-geocode a coordinate using the in-map Yandex JS API (ymaps.geocode).
   * This reuses the SAME (working) JS API key that renders the map and the map's
   * uz_UZ locale, so it returns Uzbek address names WITHOUT needing a separate
   * HTTP Geocoder key. Resolves to the address string, or null if unavailable.
   */
  reverseGeocode: (lat: number, lon: number) => Promise<string | null>;
}

// JavaScript Maps API key (for the WebView map). This is DIFFERENT from the Geocoder key.
const YANDEX_API_KEY =
  process.env.EXPO_PUBLIC_YANDEX_JS_API_KEY ||
  (Constants.expoConfig?.extra as any)?.yandexJsApiKey ||
  process.env.EXPO_PUBLIC_YANDEX_MAPS_KEY ||
  (Constants.expoConfig?.extra as any)?.yandexMapsApiKey ||
  process.env.EXPO_PUBLIC_YANDEX_SDK_API_KEY ||
  (Constants.expoConfig?.extra as any)?.yandexSdkApiKey ||
  '';

// Default center: Termiz, Surxondaryo
const DEFAULT_LAT = 37.224;
const DEFAULT_LON = 67.278;
const DEFAULT_ZOOM = 11;

const YandexMap = forwardRef<YandexMapHandle, YandexMapProps>((props, ref) => {
  const { t } = useTranslation();
  const webViewRef = useRef<WebView>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Build the map HTML exactly ONCE, capturing the props as they are at mount.
  // The map label language and the in-page diagnostics are therefore fixed for the life of
  // this instance; switching language re-labels the map the next time a map screen opens,
  // which is the right trade-off against reloading (and resetting) a live map.
  // Regenerating it on every render would change the WebView `source`, forcing a full
  // page reload that throws away the user's current zoom/pan — that is the "map jumps
  // back to its previous state when zooming in" bug. All later updates (center, zoom,
  // markers, route) are applied imperatively via sendCommand instead of re-rendering.
  const htmlRef = useRef<string | null>(null);
  if (htmlRef.current === null) {
    htmlRef.current = generateMapHtml({
      apiKey: YANDEX_API_KEY,
      initialLat: props.initialLat ?? DEFAULT_LAT,
      initialLon: props.initialLon ?? DEFAULT_LON,
      initialZoom: props.initialZoom ?? DEFAULT_ZOOM,
      markers: props.markers ?? [],
      // Diagnostics rendered inside the WebView, localized here because the page has no
      // access to i18n.
      msgApiFailed: t('map.apiLoadFailed'),
      msgInitFailed: t('map.initFailed'),
      msgApiTimeout: t('map.apiTimeout'),
    });
  }
  const html = htmlRef.current;

  // Keep the WebView `source` object identity stable so the map is never reloaded
  // after the initial mount.
  const source = useMemo(() => ({ html, baseUrl: 'https://yandex.com/' }), [html]);

  const sendCommand = (cmd: object) => {
    const js = `(function(){window.handleCommand && window.handleCommand(${JSON.stringify(cmd)});})();true;`;
    webViewRef.current?.injectJavaScript(js);
  };

  // Pending in-map reverse-geocode requests, keyed by an incrementing id.
  const geocodeReqId = useRef(0);
  const pendingGeocodes = useRef<
    Map<number, { resolve: (v: string | null) => void; timer: ReturnType<typeof setTimeout> }>
  >(new Map());

  // Resolve and clear anything still pending when the map goes away. Without this every
  // in-flight geocode left a live 8s timer whose promise later resolved into a consumer
  // that had already unmounted — order-entry's `finally` then ran setResolving(false) on a
  // dead screen, which happens on almost every exit since the address resolves on each
  // camera move.
  useEffect(
    () => () => {
      pendingGeocodes.current.forEach(({ resolve, timer }) => {
        clearTimeout(timer);
        resolve(null);
      });
      pendingGeocodes.current.clear();
    },
    []
  );

  useImperativeHandle(ref, () => ({
    setCenter: (lat, lon, zoom) => sendCommand({ type: 'setCenter', lat, lon, zoom }),
    fitBounds: (markers) => sendCommand({ type: 'fitBounds', markers }),
    drawRoute: (from, to) => sendCommand({ type: 'drawRoute', from, to }),
    reverseGeocode: (lat, lon) =>
      new Promise<string | null>((resolve) => {
        const reqId = ++geocodeReqId.current;
        const timer = setTimeout(() => {
          pendingGeocodes.current.delete(reqId);
          resolve(null);
        }, 8000);
        pendingGeocodes.current.set(reqId, { resolve, timer });
        sendCommand({ type: 'geocode', reqId, lat, lon });
      }),
  }));

  // Update markers when they actually CHANGE.
  //
  // The dep used to be the array identity, and callers build a fresh literal on every
  // render — so during live driver tracking every WebSocket position frame (and every
  // unrelated re-render) re-injected setMarkers, which removes and rebuilds every
  // placemark in the page. The pins visibly blinked while the passenger watched the car
  // move. Comparing the serialized content makes this fire only on a real change.
  const markersKey = props.markers ? JSON.stringify(props.markers) : '';
  useEffect(() => {
    if (!markersKey) return;
    sendCommand({ type: 'setMarkers', markers: JSON.parse(markersKey) });
  }, [markersKey]);

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      switch (data.type) {
        case 'ready':
          setStatus('ready');
          props.onMapReady?.();
          break;
        case 'apiError':
          setStatus('error');
          setErrorMsg(data.message || t('map.loadFailed'));
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
        case 'geocodeResult': {
          const p = pendingGeocodes.current.get(data.reqId);
          if (p) {
            clearTimeout(p.timer);
            pendingGeocodes.current.delete(data.reqId);
            p.resolve(data.address ? String(data.address) : null);
          }
          break;
        }
      }
    } catch {}
  };

  return (
    <View style={[styles.container, props.style]}>
      <WebView
        ref={webViewRef}
        // A real https baseUrl gives the page a proper origin/referrer. Without it the
        // page origin is about:blank and the Yandex Maps script (and referrer-restricted
        // API keys) can silently fail to load -> blank map.
        source={source}
        style={styles.webview}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        mixedContentMode="always"
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        scalesPageToFit
        scrollEnabled={false}
        bounces={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onError={(e) => {
          setStatus('error');
          setErrorMsg(e.nativeEvent?.description || t('map.webviewError'));
        }}
        onHttpError={(e) => {
          // Don't override a successful map load; only surface a hard failure.
          if (status !== 'ready') {
            setStatus('error');
            setErrorMsg(t('map.networkError', { code: e.nativeEvent?.statusCode ?? '?' }));
          }
        }}
      />

      {status !== 'ready' && (
        <View style={styles.overlay} pointerEvents={status === 'error' ? 'auto' : 'none'}>
          {status === 'loading' ? (
            <ActivityIndicator size="large" color="#0E1B3D" />
          ) : (
            <View style={styles.errorBox}>
              <Text style={styles.errorTitle}>{t('map.errorTitle')}</Text>
              <Text style={styles.errorText}>{errorMsg}</Text>
              <Text style={styles.errorHint}>{t('map.errorHint')}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
});

YandexMap.displayName = 'YandexMap';

export default YandexMap;

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F7FA',
  },
  errorBox: { paddingHorizontal: 24, alignItems: 'center' },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#0E1B3D', marginBottom: 6 },
  errorText: { fontSize: 13, color: '#B00020', textAlign: 'center', marginBottom: 8 },
  errorHint: { fontSize: 12, color: '#5A6B8C', textAlign: 'center' },
});

interface MapHtmlOptions {
  apiKey: string;
  initialLat: number;
  initialLon: number;
  initialZoom: number;
  markers: MapMarker[];
  msgApiFailed: string;
  msgInitFailed: string;
  msgApiTimeout: string;
}

function generateMapHtml(opts: MapHtmlOptions): string {
  const {
    apiKey, initialLat, initialLon, initialZoom, markers,
    msgApiFailed, msgInitFailed, msgApiTimeout,
  } = opts;
  // Embedded in a JS string literal inside the page -> escape quotes.
  const js = (v: string) => JSON.stringify(v);
  const apiUrl = apiKey
    ? `https://api-maps.yandex.ru/2.1/?apikey=${apiKey}&lang=${mapLang()}`
    : `https://api-maps.yandex.ru/2.1/?lang=${mapLang()}`;

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
<script>
  window.__MSG = {
    apiFailed: ${js(msgApiFailed)},
    initFailed: ${js(msgInitFailed)},
    apiTimeout: ${js(msgApiTimeout)}
  };
</script>
<script src="${apiUrl}" type="text/javascript" onerror="window.__mapApiError &amp;&amp; window.__mapApiError(window.__MSG.apiFailed)"></script>
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

  window.__mapApiError = function(msg) {
    send({ type: 'apiError', message: msg });
  };

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

  // Reverse-geocode using the in-map JS API (same working key + uz_UZ locale).
  function reverseGeocode(reqId, lat, lon) {
    try {
      ymaps.geocode([lat, lon], { results: 1 }).then(function(res) {
        var obj = res.geoObjects.get(0);
        var text = '';
        if (obj) {
          try { text = obj.getAddressLine(); } catch (e) {}
          if (!text) { try { text = obj.properties.get('text'); } catch (e) {} }
          if (!text) { try { text = obj.properties.get('name'); } catch (e) {} }
        }
        send({ type: 'geocodeResult', reqId: reqId, address: text || '' });
      }, function(err) {
        send({ type: 'geocodeResult', reqId: reqId, address: '', error: String(err) });
      });
    } catch (e) {
      send({ type: 'geocodeResult', reqId: reqId, address: '', error: String(e) });
    }
  }

  window.handleCommand = function(cmd) {
    switch (cmd.type) {
      case 'setCenter': setCenter(cmd.lat, cmd.lon, cmd.zoom); break;
      case 'setMarkers': setMarkers(cmd.markers || []); break;
      case 'fitBounds': fitBounds(cmd.markers || []); break;
      case 'drawRoute': drawRoute(cmd.from, cmd.to); break;
      case 'geocode': reverseGeocode(cmd.reqId, cmd.lat, cmd.lon); break;
    }
  };

  // Wait for the Yandex API; if it never loads, report an error instead of a blank map.
  (function waitForYmaps(tries) {
    if (typeof ymaps !== 'undefined' && ymaps.ready) {
      try {
        ymaps.ready(init);
      } catch (e) {
        window.__mapApiError(window.__MSG.initFailed + ': ' + e.message);
      }
      return;
    }
    if (tries <= 0) {
      window.__mapApiError(window.__MSG.apiTimeout);
      return;
    }
    setTimeout(function() { waitForYmaps(tries - 1); }, 300);
  })(40); // ~12s
</script>
</body>
</html>`;
}
