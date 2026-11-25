/* 위치 도우미: GPS(브라우저 Geolocation) + 권한 거부 시 IP 기반 폴백 */
(function (global) {
  'use strict';

  function ipFallback() {
    // 외부 키 없이 사용하는 IP 기반 추정 (정확도 낮음). 429 대비 이중 폴백.
    return fetch('https://ipwho.is/')
      .then((r) => { if (!r.ok) throw new Error('IP 위치 조회 실패'); return r.json(); })
      .then((d) => {
        if (d.success === false) throw new Error(d.message || 'IP 위치 조회 실패');
        return { latitude: Number(d.latitude), longitude: Number(d.longitude),
                 accuracy: 5000, source: 'ip', city: d.city || '' };
      })
      .catch(() => fetch('https://ipapi.co/json/')
        .then((r) => { if (!r.ok) throw new Error('IP 위치 조회 실패(요청 제한)'); return r.json(); })
        .then((d) => ({ latitude: Number(d.latitude), longitude: Number(d.longitude),
                        accuracy: 5000, source: 'ip', city: d.city || '' })));
  }

  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('이 브라우저는 위치 기능을 지원하지 않습니다.')); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          source: 'gps', city: ''
        }),
        (err) => reject(new Error(err.code === 1 ? '위치 권한이 거부되었습니다.' : 'GPS 신호를 받지 못했습니다.')),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });
  }

  function useCurrentLocation(onSuccess, onError, onStatus) {
    if (onStatus) onStatus('GPS 위치 확인 중…', 'wait');
    getCurrentPosition()
      .then((pos) => { if (onStatus) onStatus('GPS 위치 확인 완료', 'ok'); onSuccess(pos); })
      .catch((gpsError) => {
        if (onStatus) onStatus(gpsError.message + ' · IP 위치로 대체 중…', 'warn');
        ipFallback()
          .then((pos) => { if (onStatus) onStatus('IP 기반 추정 위치 (정확도 낮음)', 'warn'); onSuccess(pos); })
          .catch(() => { if (onStatus) onStatus('위치를 확인할 수 없습니다.', 'warn'); onError(gpsError.message); });
      });
  }

  function watchPosition(onUpdate, onError) {
    if (!navigator.geolocation) { onError('이 브라우저는 위치 기능을 지원하지 않습니다.'); return null; }
    return navigator.geolocation.watchPosition(
      (pos) => onUpdate({
        latitude: pos.coords.latitude, longitude: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy), source: 'gps', city: ''
      }),
      (err) => onError(err.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  function stopWatch(id) {
    if (id != null && navigator.geolocation) navigator.geolocation.clearWatch(id);
  }

  function screenToLatLng(clickX, clickY, svgWidth, startLat, startLng, radiusKm) {
    const cx = svgWidth / 2, cy = svgWidth / 2;
    const dx = (clickX - cx) / (svgWidth * 0.4);
    const dy = (cy - clickY) / (svgWidth * 0.4);
    return {
      latitude: startLat - dy * radiusKm / 111,
      longitude: startLng + dx * radiusKm / (111 * Math.cos(startLat * Math.PI / 180)),
      source: 'map', city: ''
    };
  }

  global.SeoulMapHelper = { useCurrentLocation, watchPosition, stopWatch, screenToLatLng, ipFallback };
})(window);
