/* 지도/위치 도우미: 현재 위치와 지도 클릭으로 출발지를 설정한다. */
(function (global) {
  'use strict';

  function useCurrentLocation(onSuccess, onError) {
    if (!navigator.geolocation) {
      onError('이 브라우저는 위치 기능을 지원하지 않습니다.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => onSuccess(pos.coords.latitude, pos.coords.longitude),
      () => onError('위치 권한이 거부되었습니다. 직접 좌표를 입력해 주세요.'),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  // 화면 좌표를 출발지 위경도로 바꾸는 단순 역투영 (데모용)
  function screenToLatLng(clickX, clickY, svgWidth, startLat, startLng, radiusKm) {
    const cx = svgWidth / 2, cy = svgWidth / 2;
    const dx = (clickX - cx) / (svgWidth * 0.4);
    const dy = (cy - clickY) / (svgWidth * 0.4);
    return {
      latitude: startLat - dy * radiusKm / 111,
      longitude: startLng + dx * radiusKm / (111 * Math.cos(startLat * Math.PI / 180))
    };
  }

  global.SeoulMapHelper = { useCurrentLocation, screenToLatLng };
})(window);
