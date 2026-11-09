import React, { useRef, useEffect, useImperativeHandle, forwardRef, useState, useMemo } from 'react';
import { StyleSheet, View, ViewStyle, StyleProp, Text, ActivityIndicator } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';

import { mapLang } from '../utils/yandexLocale';
import { useThemeStore } from '../store/theme';

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
  /**
   * Fallback geolocation using WebView HTML5 navigator.geolocation / ymaps.geolocation.
   */
  geolocate: () => Promise<{ lat: number; lon: number } | null>;
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
  const isDark = useThemeStore((s) => s.isDark);
  const colors = useThemeStore((s) => s.colors);
  const webViewRef = useRef<WebView>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Build the map HTML exactly ONCE, capturing the props as they are at mount.
  const htmlRef = useRef<string | null>(null);
  if (htmlRef.current === null) {
    htmlRef.current = generateMapHtml({
      apiKey: YANDEX_API_KEY,
      initialLat: props.initialLat ?? DEFAULT_LAT,
      initialLon: props.initialLon ?? DEFAULT_LON,
      initialZoom: props.initialZoom ?? DEFAULT_ZOOM,
      markers: props.markers ?? [],
      isDark,
      msgApiFailed: t('map.apiLoadFailed'),
      msgInitFailed: t('map.initFailed'),
      msgApiTimeout: t('map.apiTimeout'),
    });
  }
  const html = htmlRef.current;

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

  // Pending in-map geolocate requests.
  const geolocateReqId = useRef(0);
  const pendingGeolocates = useRef<
    Map<
      number,
      {
        resolve: (v: { lat: number; lon: number } | null) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >
  >(new Map());

  useEffect(
    () => () => {
      pendingGeocodes.current.forEach(({ resolve, timer }) => {
        clearTimeout(timer);
        resolve(null);
      });
      pendingGeocodes.current.clear();

      pendingGeolocates.current.forEach(({ resolve, timer }) => {
        clearTimeout(timer);
        resolve(null);
      });
      pendingGeolocates.current.clear();
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
    geolocate: () =>
      new Promise<{ lat: number; lon: number } | null>((resolve) => {
        const reqId = ++geolocateReqId.current;
        const timer = setTimeout(() => {
          pendingGeolocates.current.delete(reqId);
          resolve(null);
        }, 6000);
        pendingGeolocates.current.set(reqId, { resolve, timer });
        sendCommand({ type: 'geolocate', reqId });
      }),
  }));

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
        case 'geolocateResult': {
          const p = pendingGeolocates.current.get(data.reqId);
          if (p) {
            clearTimeout(p.timer);
            pendingGeolocates.current.delete(data.reqId);
            if (Number.isFinite(data.lat) && Number.isFinite(data.lon)) {
              p.resolve({ lat: Number(data.lat), lon: Number(data.lon) });
            } else {
              p.resolve(null);
            }
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
        source={source}
        style={styles.webview}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled
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
          if (status !== 'ready') {
            setStatus('error');
            setErrorMsg(t('map.networkError', { code: e.nativeEvent?.statusCode ?? '?' }));
          }
        }}
      />

      {status !== 'ready' && (
        <View
          style={[styles.overlay, { backgroundColor: colors.surface }]}
          pointerEvents={status === 'error' ? 'auto' : 'none'}
        >
          {status === 'loading' ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : (
            <View style={styles.errorBox}>
              <Text style={[styles.errorTitle, { color: colors.text }]}>{t('map.errorTitle')}</Text>
              <Text style={[styles.errorText, { color: colors.error }]}>{errorMsg}</Text>
              <Text style={[styles.errorHint, { color: colors.textSecondary }]}>{t('map.errorHint')}</Text>
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
  isDark?: boolean;
  msgApiFailed: string;
  msgInitFailed: string;
  msgApiTimeout: string;
}

function generateMapHtml(opts: MapHtmlOptions): string {
  const {
    apiKey, initialLat, initialLon, initialZoom, markers, isDark,
    msgApiFailed, msgInitFailed, msgApiTimeout,
  } = opts;
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
  body { background: ${isDark ? '#0F1729' : '#F5F7FA'}; font-family: -apple-system, sans-serif; }
  ${isDark ? '[class*="ground-pane"] { filter: invert(90%) hue-rotate(185deg) brightness(92%) contrast(90%); }' : ''}
  .marker {
    background: #2563EB;
    border: 3px solid #FFFFFF;
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
  var pendingCenter = null;
  var programmaticMoveCount = 0;

  function send(data) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(data));
    }
  }

  window.__mapApiError = function(msg) {
    send({ type: 'apiError', message: msg });
  };

  function init() {
    var startLat = pendingCenter ? pendingCenter.lat : ${initialLat};
    var startLon = pendingCenter ? pendingCenter.lon : ${initialLon};
    var startZoom = (pendingCenter && typeof pendingCenter.zoom === 'number') ? pendingCenter.zoom : ${initialZoom};
    pendingCenter = null;

    programmaticMoveCount++;
    map = new ymaps.Map('map', {
      center: [startLat, startLon],
      zoom: startZoom,
      controls: ['zoomControl']
    }, {
      suppressMapOpenBlock: true
    });
    setTimeout(function() {
      programmaticMoveCount = Math.max(0, programmaticMoveCount - 1);
    }, 250);

    map.events.add('click', function(e) {
      var coords = e.get('coords');
      send({ type: 'mapPress', lat: coords[0], lon: coords[1] });
    });

    map.events.add('boundschange', function(e) {
      if (programmaticMoveCount > 0) {
        return;
      }
      var center = (e && e.get && e.get('newCenter')) || map.getCenter();
      var zoom = (e && e.get && e.get('newZoom')) || map.getZoom();
      send({
        type: 'cameraMove',
        lat: center[0],
        lon: center[1],
        zoom: zoom
      });
    });

    setMarkers(${JSON.stringify(markers)});
    send({ type: 'ready' });
  }

  function setMarkers(markers) {
    if (!map) return;
    for (var key in markerObjects) {
      map.geoObjects.remove(markerObjects[key]);
    }
    markerObjects = {};

    markers.forEach(function(m) {
      var placemark = new ymaps.Placemark(
        [m.lat, m.lon],
        { iconCaption: m.label || '' },
        {
          preset: 'islands#blueDotIcon',
          iconColor: m.color || '#2563EB'
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
    if (!map) {
      pendingCenter = { lat: lat, lon: lon, zoom: zoom };
      return;
    }
    var targetZoom = typeof zoom === 'number' ? zoom : map.getZoom();
    programmaticMoveCount++;
    try {
      var p = map.setCenter([lat, lon], targetZoom, { checkZoomRange: true });
      if (p && typeof p.then === 'function') {
        p.then(
          function() {
            setTimeout(function() {
              programmaticMoveCount = Math.max(0, programmaticMoveCount - 1);
            }, 80);
          },
          function() {
            setTimeout(function() {
              programmaticMoveCount = Math.max(0, programmaticMoveCount - 1);
            }, 80);
          }
        );
      } else {
        setTimeout(function() {
          programmaticMoveCount = Math.max(0, programmaticMoveCount - 1);
        }, 120);
      }
    } catch (e) {
      programmaticMoveCount = Math.max(0, programmaticMoveCount - 1);
    }
  }

  function fitBounds(markers) {
    if (!map || !markers || markers.length === 0) return;
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
    if (!map) return;
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

  // WebView geolocation fallback using HTML5 navigator.geolocation or ymaps.geolocation.
  function geolocate(reqId) {
    var done = false;
    function finish(lat, lon) {
      if (done) return;
      done = true;
      send({ type: 'geolocateResult', reqId: reqId, lat: lat, lon: lon });
    }

    if (navigator && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function(pos) {
          if (pos && pos.coords) {
            finish(pos.coords.latitude, pos.coords.longitude);
          }
        },
        function() {
          if (typeof ymaps !== 'undefined' && ymaps.geolocation) {
            ymaps.geolocation.get({ provider: 'auto' }).then(function(res) {
              var coords = res.geoObjects.position;
              if (coords && coords.length === 2) {
                finish(coords[0], coords[1]);
              } else {
                finish(null, null);
              }
            }, function() { finish(null, null); });
          } else {
            finish(null, null);
          }
        },
        { enableHighAccuracy: true, timeout: 4500, maximumAge: 60000 }
      );
      return;
    }

    if (typeof ymaps !== 'undefined' && ymaps.geolocation) {
      ymaps.geolocation.get({ provider: 'auto' }).then(function(res) {
        var coords = res.geoObjects.position;
        if (coords && coords.length === 2) {
          finish(coords[0], coords[1]);
        } else {
          finish(null, null);
        }
      }, function() { finish(null, null); });
      return;
    }

    finish(null, null);
  }

  window.handleCommand = function(cmd) {
    switch (cmd.type) {
      case 'setCenter': setCenter(cmd.lat, cmd.lon, cmd.zoom); break;
      case 'setMarkers': setMarkers(cmd.markers || []); break;
      case 'fitBounds': fitBounds(cmd.markers || []); break;
      case 'drawRoute': drawRoute(cmd.from, cmd.to); break;
      case 'geocode': reverseGeocode(cmd.reqId, cmd.lat, cmd.lon); break;
      case 'geolocate': geolocate(cmd.reqId); break;
    }
  };

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
  })(40);
</script>
</body>
</html>`;
}
