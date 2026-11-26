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
  let mapRevision = 0;
  let resizeObserver = null;
  let outerRadiusCircle = null;
  let renderedSearch = null;
  let fittedLevel = null;
  let markerInfo = null;
  const scriptLoads = new Map();
  const markerImages = new Map();
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]);

  // 작은 점만 보이게 하되 투명한 24px 영역으로 마우스·터치 선택은 유지한다.
  function smallMarker(km, position, title, color, radius = 5, warning) {
    const key = `${color}-${radius}`;
    if (!markerImages.has(key)) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="${radius}" fill="${color}" stroke="white" stroke-width="1.5"/></svg>`;
      markerImages.set(key, new km.MarkerImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
        new km.Size(24, 24), {offset:new km.Point(12, 12)}));
    }
    const marker = new km.Marker({position, title, image:markerImages.get(key), zIndex:5});
    marker.setMap(kakaoMap); kakaoOverlays.push(marker);
    const showName = () => {
      if (!markerInfo || !kakaoMap) return;
      markerInfo.setContent(`<div class="map-place-tooltip${warning ? ' visit-warning' : ''}">${escapeHtml(title)}${warning ? `<br>${escapeHtml(warning.reason)}` : ''}</div>`);
      markerInfo.open(kakaoMap, marker);
    };
    km.event.addListener(marker, 'mouseover', showName);
    km.event.addListener(marker, 'mouseout', () => { if (markerInfo) markerInfo.close(); });
    km.event.addListener(marker, 'click', showName);
    return marker;
  }

  function changeZoom(delta) {
    if (!kakaoMap) return false;
    const current = kakaoMap.getLevel();
    const next = Math.max(1, Math.min(14, current + delta));
    if (next !== current) {
      fittedLevel = null;
      kakaoMap.setLevel(next);
    }
    return true;
  }

  // 두 손가락 간격이 1.25배씩 바뀔 때마다 확대·축소 버튼과 같은 한 단계를 적용한다.
  function bindPinchZoom(container, zoomStep) {
    const pointers = new Map();
    const span = () => {
      const [a, b] = pointers.values();
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };
    let lastSpan = 0;
    let pinching = false;
    let skipClick = false;
    let mapGesture;
    const capture = {capture:true};
    container.addEventListener('pointerdown', event => {
      if (!pointers.size) skipClick = false;
      if (event.pointerType !== 'touch') return;
      pointers.set(event.pointerId, event);
      if (pointers.size !== 2) return;
      lastSpan = span();
      event.stopPropagation();
      if (pinching) return;
      pinching = skipClick = true;
      if (kakaoMap) {
        mapGesture = {map:kakaoMap, zoomable:kakaoMap.getZoomable(), draggable:kakaoMap.getDraggable()};
        kakaoMap.setZoomable(false);
        kakaoMap.setDraggable(false);
      }
    }, capture);
    container.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, event);
      if (pinching) event.stopPropagation();
      if (pointers.size !== 2) return;
      const distance = span();
      if (!distance || !lastSpan) {
        lastSpan = distance;
        return;
      }
      const ratio = distance / lastSpan;
      const steps = Math.log(ratio) / Math.log(1.25);
      const levels = Math.sign(steps) * Math.floor(Math.abs(steps) + 1e-9);
      if (levels) {
        zoomStep(-levels);
        lastSpan *= 1.25 ** levels;
      }
    }, capture);
    const end = event => {
      if (!pointers.delete(event.pointerId)) return;
      lastSpan = pointers.size === 2 ? span() : 0;
      if (pointers.size || !pinching) return;
      pinching = false;
      if (mapGesture?.map && mapGesture.map === kakaoMap) {
        kakaoMap.setZoomable(mapGesture.zoomable);
        kakaoMap.setDraggable(mapGesture.draggable);
      }
      mapGesture = null;
    };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => container.addEventListener(type, end, capture));
    container.addEventListener('click', event => {
      if (!skipClick || event.detail === 0) return;
      skipClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, capture);
  }

  function resetZoom() {
    if (!kakaoMap) return false;
    fitSearchRadius();
    return true;
  }

  // 동일 활동의 후보 군집과 선택 방문점을 시간 순서의 점선·화살표로 표시한다.
  function drawJourney(km, model, filter, container, layers) {
    if (!model) return;
    const helper = global.SeoulJourney;
    const overlay = (position, content, options = {}) => {
      const item = new km.CustomOverlay({position, content, xAnchor:.5, yAnchor:.5, zIndex:7, ...options});
      item.setMap(kakaoMap); kakaoOverlays.push(item);
    };
    model.stops.filter(s => helper.visible(s.index, filter)).forEach(stop => {
      stop.clusters.filter(g => g.size > 1).forEach(group => {
        const position = new km.LatLng(group.center.lat, group.center.lng);
        const area = new km.Circle({center:position, radius:group.radius, strokeColor:stop.color,
          strokeWeight:1, strokeOpacity:.4, fillColor:stop.color, fillOpacity:.07, zIndex:2});
        area.setMap(kakaoMap); kakaoOverlays.push(area);
        overlay(destination(km, group.center.lat, group.center.lng, 180, group.radius / 1000),
          `<span class="journey-cluster-label" style="--journey-color:${stop.color}">${escapeHtml(stop.name)} 후보 ${group.size}곳</span>`, {zIndex:4});
      });
    });
    model.segments.filter(s => helper.visible(s.index, filter)).forEach(segment => {
      const path = [segment.from, segment.to].map(p => new km.LatLng(p.lat, p.lng));
      // 실제 길찾기 좌표가 없는 연결은 항상 점선으로 구분한다.
      if (!layers.length) {
        const line = new km.Polyline({path, strokeColor:segment.color, strokeOpacity:.9, strokeWeight:3,
          strokeStyle:'dash', zIndex:5});
        line.setMap(kakaoMap); kakaoOverlays.push(line);
      }
      const [a, b] = helper.arrowSegment(segment);
      const lat = (Number(a.lat) + Number(b.lat)) / 2;
      const lng = (Number(a.lng) + Number(b.lng)) / 2;
      const angle = Math.atan2(-(b.lat - a.lat),
        (b.lng - a.lng) * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI;
      overlay(new km.LatLng(lat, lng),
        `<div class="journey-segment" data-start="${segment.startMinute ?? ''}" data-end="${segment.endMinute ?? ''}"><div class="journey-arrow" style="color:${segment.color};transform:rotate(${angle}deg)" aria-label="다음 활동으로 이동">➤</div></div>`);
    });
    model.stops.filter(s => s.place && helper.visible(s.index, filter)).forEach(stop => {
      const left = stop.index % 3 === 2, below = stop.index % 3 === 1;
      overlay(new km.LatLng(stop.point.lat, stop.point.lng),
        `<div class="journey-stop" data-start="${stop.startMinute ?? ''}" data-end="${stop.endMinute ?? ''}" style="--journey-color:${stop.color}" title="${escapeHtml(stop.place.name)} · ${escapeHtml(stop.name)}${stop.warning ? ` · ${escapeHtml(stop.warning.reason)}` : stop.conflict ? ' · 시간 충돌' : ''}">
          <span class="journey-stop-label" style="transform:translate(${left ? -8 : 8}px,${below ? 6 : -6}px)"><b>${stop.index + 1}</b>${escapeHtml(stop.time)}${stop.warning ? ` <span class="visit-warning">${escapeHtml(stop.place.name)} · 확인 필요</span>` : stop.conflict ? ' !' : ''}</span></div>`,
        {xAnchor:left ? 1 : 0, yAnchor:below ? 0 : 1});
    });
    helper.highlight(container, Number(document.getElementById('scrubSlider').value));
  }

  // SVG 보기로 전환하면 이전 지도와 대기 중인 SDK 그리기를 정리한다.
  function clearKakaoMap() {
    mapRevision += 1;
    if (resizeObserver) resizeObserver.disconnect();
    resizeObserver = null;
    if (markerInfo) markerInfo.close();
    markerInfo = null;
    kakaoOverlays.forEach(o => o.setMap(null));
    kakaoOverlays = [];
    kakaoMap = null;
    outerRadiusCircle = null;
    renderedSearch = null;
    fittedLevel = null;
  }

  // 바깥쪽 반경 원까지 여백을 두고 표시한다.
  function fitSearchRadius() {
    if (!kakaoMap || !outerRadiusCircle) return;
    kakaoMap.relayout();
    kakaoMap.setBounds(outerRadiusCircle.getBounds(), 48, 48, 48, 48);
    fittedLevel = kakaoMap.getLevel();
  }

  // 방문 구간이 반경 안에서 너무 작게 보이면 선택 경로를 화면에 맞춘다.
  function fitJourney(km, points) {
    const bounds = new km.LatLngBounds();
    points.forEach(point => bounds.extend(new km.LatLng(point.lat, point.lng)));
    fittedLevel = null;
    kakaoMap.relayout();
    kakaoMap.setBounds(bounds, 96, 72, 70, 72);
  }

  // 중심점에서 지정한 방위와 거리만큼 떨어진 지리 좌표를 구한다.
  function destination(km, lat, lng, bearing, distanceKm) {
    const angle = distanceKm / 6371;
    const heading = bearing * Math.PI / 180;
    const phi = lat * Math.PI / 180;
    const lambda = lng * Math.PI / 180;
    const endLat = Math.asin(Math.sin(phi) * Math.cos(angle)
      + Math.cos(phi) * Math.sin(angle) * Math.cos(heading));
    const endLng = lambda + Math.atan2(Math.sin(heading) * Math.sin(angle) * Math.cos(phi),
      Math.cos(angle) - Math.sin(phi) * Math.sin(endLat));
    return new km.LatLng(endLat * 180 / Math.PI, endLng * 180 / Math.PI);
  }

  function loadScript(src) {
    if (scriptLoads.has(src)) return scriptLoads.get(src);
    const loading = new Promise((resolve, reject) => {
      const old = document.querySelector(`script[src="${src}"]`);
      if (old && window.kakao) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    scriptLoads.set(src, loading);
    return loading;
  }

  function useKakaoMap(container, key, center, data, onFallback) {
    if (!key || !container) return false;
    const lat = Number(center.latitude) || 37.5665;
    const lng = Number(center.longitude) || 126.9780;
    const radius = Number(data.radius_km) || 5;
    const {radiusRings, displayRadius} = global.SeoulCompassMap;
    const revision = ++mapRevision;
    loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`)
      .then(() => {
        if (!window.kakao || !window.kakao.maps) throw new Error('카카오맵 SDK 로드 실패');
        return new Promise((resolve, reject) => window.kakao.maps.load(() => {
          if (revision !== mapRevision) { resolve(); return; }
          try {
            const km = window.kakao.maps;
            const pos = new km.LatLng(lat, lng);
            const sameCenter = renderedSearch?.lat === lat && renderedSearch.lng === lng;
            const sameRadius = renderedSearch?.radius === radius;
            // 경로 선택은 오버레이만 갱신한다. 다른 후보 지역은 현재 배율로 중심을 옮긴다.
            const shouldFit = !kakaoMap || (!data.preserveZoom && !(sameCenter && sameRadius));
            if (!kakaoMap) {
              container.innerHTML = '';
              // SDK의 배경 스타일이 컴패스 화면에 남지 않도록 전용 자식 영역을 쓴다.
              const canvas = document.createElement('div');
              canvas.style.width = '100%'; canvas.style.height = '100%';
              container.appendChild(canvas);
              kakaoMap = new km.Map(canvas, { center: pos, level: 3, keyboardShortcuts:true });
              kakaoMap.setZoomable(true);
              markerInfo = new km.InfoWindow({zIndex:10, disableAutoPan:true});
              if (window.ResizeObserver) {
                resizeObserver = new ResizeObserver(() => {
                  if (!kakaoMap) return;
                  if (kakaoMap.getLevel() === fittedLevel) fitSearchRadius();
                  else kakaoMap.relayout();
                });
                resizeObserver.observe(container);
              }
            } else if (!sameCenter) {
              kakaoMap.setCenter(pos);
            }
            kakaoOverlays.forEach(o => o.setMap(null));
            kakaoOverlays = [];
            markerInfo.close();
            // 이전 SVG의 8개 방향 부채꼴을 실제 지도 좌표 위에 표시한다.
            const names = ['북','북동','동','남동','남','남서','서','북서'];
            const labels = ['N','NE','E','SE','S','SW','W','NW'];
            const sectorColors = ['#b45f54','#c08a4a','#b8914e','#6f9b6a','#2f8f83','#5479b0','#6b5ba8','#9b6aa0'];
            names.forEach((name, i) => {
              const path = [pos];
              for (let step = 0; step <= 18; step += 1) {
                path.push(destination(km, lat, lng, i * 45 - 22.5 + step * 2.5, radius));
              }
              const score = Number((data.scores || {})[name]) || 0;
              const sector = new km.Polygon({ path, strokeColor: sectorColors[i], strokeWeight: 1,
                strokeOpacity: 0, fillColor: sectorColors[i], fillOpacity: .08 + Math.min(.35, score / 200), zIndex: 1 });
              sector.setMap(kakaoMap); kakaoOverlays.push(sector);
              const label = new km.CustomOverlay({ position: destination(km, lat, lng, i * 45, displayRadius(radius) * 1.10),
                content: `<span class="map-direction-label" translate="no">${labels[i]}</span>`,
                xAnchor:.5, yAnchor:.5, zIndex:4 });
              label.setMap(kakaoMap); kakaoOverlays.push(label);
            });
            // 반경을 공통 중심에서 작은 원부터 그려 마지막 원을 화면 맞춤에 사용한다.
            for (const ring of radiusRings(radius)) {
              const circle = new km.Circle({center:pos, radius:ring.km * 1000,
                strokeColor:ring.color, strokeWeight:1, strokeStyle:'dot', strokeOpacity:1, fillOpacity:0, zIndex:3});
              circle.setMap(kakaoMap); kakaoOverlays.push(circle);
              outerRadiusCircle = circle;
              const label = new km.CustomOverlay({position:destination(km, lat, lng, 0, ring.km),
                content:`<span class="map-radius-label" style="color:${ring.color}">반경 ${ring.km}km</span>`,
                xAnchor:.5, yAnchor:0, zIndex:5});
              label.setMap(kakaoMap); kakaoOverlays.push(label);
            }
            smallMarker(km, pos, '검색 기준점', '#E53935', 6);
            const departure = data.route_start;
            if (departure && (departure.latitude !== lat || departure.longitude !== lng)) {
              const marker = smallMarker(km, new km.LatLng(departure.latitude, departure.longitude),
                `출발지: ${departure.name || ''}`, '#26364b', 6);
              const label = new km.CustomOverlay({ position: marker.getPosition(), zIndex: 6, yAnchor: 2,
                content: '<span class="map-location-label">경로 출발지</span>' });
              label.setMap(kakaoMap); kakaoOverlays.push(label);
            }
            if (data.focusPoints?.length) fitJourney(km, data.focusPoints);
            else if (shouldFit) fitSearchRadius();
            renderedSearch = {lat, lng, radius};
            const legend = document.getElementById('compassLegend');
            if (legend) legend.innerHTML = labels.map((label, i) =>
              `<span translate="no"><i style="background:${sectorColors[i]}"></i>${label}</span>`).join('');
            // 장소 마커
            (data.places || []).forEach(p => {
              const color = p.visit_warning ? global.SeoulJourney.REFERENCE_COLOR
                : (global.SeoulCharts && global.SeoulCharts.COLORS[p.category]) || '#2f8f83';
              smallMarker(km, new km.LatLng(p.lat, p.lng), p.name, color, 5, p.visit_warning);
            });
            (data.route_layers || []).forEach(layer => {
              global.SeoulJourney.pathsFor(layer).forEach(points => {
                const path = points.map(p => new km.LatLng(p.lat, p.lng));
                const line = new km.Polyline({path, strokeColor:layer.color, strokeOpacity:layer.opacity,
                  strokeWeight:layer.width, strokeStyle:layer.network ? 'solid' : 'dash',
                  zIndex:(layer.network ? 12 : 7) - layer.width / 3});
                line.setMap(kakaoMap); kakaoOverlays.push(line);
              });
            });
            drawJourney(km, data.journey, data.journey_filter, container, data.route_layers || []);
            resolve();
          } catch (error) { reject(error); }
        }));
      })
      .catch(() => {
        if (revision !== mapRevision) return;
        clearKakaoMap();
        if (onFallback) onFallback('카카오맵 로드 실패 → SVG 지도로 전환합니다.');
      });
    return true;
  }

  global.SeoulMapHelper = {useCurrentLocation, watchPosition, stopWatch, screenToLatLng, ipFallback,
    useKakaoMap, clearKakaoMap, changeZoom, resetZoom, bindPinchZoom};
})(window);
