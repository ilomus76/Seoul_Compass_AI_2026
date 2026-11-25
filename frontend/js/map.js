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

  /* 카카오맵 JS SDK 연동 (키가 있을 때만 사용, 없으면 SVG 지도 폴백) */
  let kakaoMap = null;
  let kakaoOverlays = [];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const old = document.querySelector(`script[src="${src}"]`);
      if (old && window.kakao) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function useKakaoMap(container, key, center, data) {
    if (!key || !container) return false;
    const lat = Number(center.latitude) || 37.5665;
    const lng = Number(center.longitude) || 126.9780;
    loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`)
      .then(() => window.kakao.maps.load(() => {
        const km = window.kakao.maps;
        const pos = new km.LatLng(lat, lng);
        if (!kakaoMap) {
          container.innerHTML = '';
          kakaoMap = new km.Map(container, { center: pos, level: 3 });
        } else {
          kakaoMap.setCenter(pos);
        }
        kakaoOverlays.forEach(o => o.setMap(null));
        kakaoOverlays = [];
        // 검색 반경 원
        const circle = new km.Circle({ center: pos, radius: (Number(data.radius_km) || 5) * 1000,
          strokeColor:'#b8914e', strokeOpacity:.5, fillColor:'#b8914e', fillOpacity:.08 });
        circle.setMap(kakaoMap); kakaoOverlays.push(circle);
        // 장소 마커
        (data.places || []).forEach(p => {
          const marker = new km.Marker({ position: new km.LatLng(p.lat, p.lng) });
          marker.setMap(kakaoMap); kakaoOverlays.push(marker);
        });
        // 경로 폴리라인 (TOP3 색상)
        const colors = ['#b8914e','#2f8f83','#b45f54'];
        (data.routes || []).forEach((r, i) => {
          const path = (r.nodes || []).map(n => new km.LatLng(n.place.lat, n.place.lng));
          if (path.length < 2) return;
          const line = new km.Polyline({ path, strokeColor: colors[i % 3], strokeOpacity:.9, strokeWeight:4 });
          line.setMap(kakaoMap); kakaoOverlays.push(line);
        });
      }))
      .catch(() => { /* 로드 실패 시 SVG 폴백 유지 */ });
    return true;
  }

  global.SeoulMapHelper = { useCurrentLocation, watchPosition, stopWatch, screenToLatLng, ipFallback, useKakaoMap };
})(window);
