/* 전체 UI 다국어 전환 모듈
 * - 텍스트 노드/placeholder/title/aria-label 을 사전으로 변환
 * - 동적으로 생성되는 텍스트는 MutationObserver 로 자동 변환
 */
(function (global) {
  'use strict';

  const DICT = {
    ko: {},
    en: {
      '등산':'Hiking','신림역':'Sillim Station','고등어':'Mackerel','볼링':'Bowling',
      '지침':'Guide','긴급번호':'Emergency','기온':'Temperature','상태':'Condition','출처':'Source',
      '권장':'Recommended','실외 가능':'Outdoor OK','실내 중심':'Indoor focus','흐림':'Cloudy','맑음':'Clear','비/눈':'Rain/Snow','눈':'Snow',
      '야외 일정 유지가 가능합니다.':'Outdoor plan is fine.','실내 장소를 우선 적용했습니다.':'Indoor places applied first.',
      '경로 시뮬레이션':'Route simulation','대기':'Standby','재생 중':'Playing','일시정지':'Paused',
      '이동 중':'Moving','남은 거리':'Remaining','예상':'Est.','이전':'Prev','다음':'Next','초기화':'Reset',
      '경로를 분석하면 시뮬레이션할 수 있습니다.':'Analyze a route to start simulation.',
      '전체 경로 주행 완료':'Route simulation complete','시뮬레이션 시작':'Simulation started',
      '시뮬레이션이 완료되었습니다.':'Simulation finished.','먼저 경로를 분석해 주세요.':'Analyze a route first.',
      '도착 예정: ':'Arriving: ','주변 장소 목록':'Nearby places','장소':'Place','업종':'Category','거리':'Distance','평점':'Rating','영업':'Hours','요금':'Fee','혼잡':'Crowd','검색 결과가 없습니다.':'No places found.',
      '입력 청크 분류':'Input chunk classification','청크 없음':'No chunks','개':'items',
      'date':'DATE','time':'TIME','place':'PLACE','activity':'ACTIVITY','note':'NOTE',
      '3D 시뮬':'3D Sim','3D 경로 시뮬레이션을 시작했습니다.':'3D route simulation started.','3D 시뮬레이션을 종료했습니다.':'3D simulation stopped.',
      '위험구역':'Risk zones','목업 데이터':'(mock data)','주변 위험구역 없음':'No nearby risk zones','주변 도움 지점: ':'Nearby help: ',
      '우천 가능성':'Rain expected','실내 선호':'Indoor preference','실외 선호':'Outdoor preference',
      '동행 있음':'With companion','예산 제한':'Budget limit','혼잡도 민감':'Crowd sensitive',
      '등산 안전 지침':'Hiking safety','체육시설 안전 지침':'Facility safety','야간 이동 안전 지침':'Night safety','이동 안전 지침':'Transit safety',
      '일몰 2시간 전 하산 시작':'Start descent 2h before sunset','왕복 시간의 절반 시점에 원위치 복귀 알람':'Alarm at halfway of round trip','8829 산악안전신고':'Mountain safety 8829',
      '준비운동 후 이용':'Warm up before use','무거운 볼은 양손으로 운반':'Carry heavy balls with both hands','미끄러운 바닥 주의':'Watch slippery floor',
      '인적이 드문 골목 피하기':'Avoid empty alleys','가까운 지하철역·경찰서 위치 확인':'Check nearby station/police','휴대폰 배터리 확인':'Check phone battery',
      '횡단보도 이용':'Use crosswalks','자전거도로에서 보행 주의':'Watch bike lanes','교통카드·현금 준비':'Prepare card/cash',
      '주변 도움 지점: ':'Nearby help: ','데이터 없음':'No data','hiking':'Hiking','meeting':'Meeting','restaurant':'Meal','shopping':'Shopping',
      '플랜':'Plan', '플랜 분석':'Plan analysis', '플랜 구조화 결과':'Parsed plan',
      '시간별 장소 밀집도':'Hourly place density', '날씨 기반 실내·실외 적용':'Weather-based indoor/outdoor',
      '추천 이동수단':'Recommended transport', '시간 알람':'Time alarms',
      '안전 지침 · 위급 신고':'Safety guide · emergency', '자연어·다국어 가이드':'Multilingual AI guide',
      '날짜':'Date', '시간':'Time', '장소':'Place', '목적':'Purpose', '특이사항':'Special notes',
      '신뢰도':'Confidence', '미지정':'Not set', '확인 필요':'Check needed', '높음':'High',
      '분석 후 구조화 결과가 표시됩니다.':'Parsed result appears after analysis.',
      '분석 후 밀집도가 표시됩니다.':'Density appears after analysis.',
      '구역을 선택하면 플랜 순서에 맞는 이동경로와 교통수단을 분석합니다.':'Select a zone to analyze the route and transport.',
      '이 구역 경로 분석':'Analyze this zone', '경찰 112':'Police 112', '소방 119':'Fire 119',
      '여행 플랜에 대해 무엇이든 물어보세요. 여러 언어를 지원합니다.':'Ask anything about your trip. Multiple languages supported.',
      '궁금한 여행 질문을 입력하세요':'Ask a travel question', '질문':'Ask',
      '화면 언어가 변경되었습니다.':'Screen language changed.',
      '관측 데스크':'Observatory Desk', '음성/입력 언어':'Voice / input language',
      '한국어':'Korean', 'English':'English', '日本語':'Japanese', '中文':'Chinese',
      '음성으로 입력':'Speak to input', '🎤 음성':'🎤 Voice', '🔴 듣는 중':'🔴 Listening',
      '예: 오후2시부터 4시까지 쇼핑 / 9시 관악산 등산, 14시 신림역 약속':'e.g. Shop from 2 to 4 pm / Hike at 9am, meet at 2pm',
      '분석':'Analyze', '지도':'Map', '컴패스':'Compass', '☀ 라이트':'☀ Light', '◐ 다크':'◐ Dark',
      '섹션 이동':'Section navigation', '탐색':'Explore', '일정':'Plan', '기록':'Archive', '설정':'Settings',
      'START POINT':'STARTING POINT', '◎ 현재 위치 사용':'◎ Use current location',
      '실시간 추적 시작':'Start live tracking', '실시간 추적 중지':'Stop live tracking',
      'GPS 대기 · 위치 권한 필요':'GPS standby · location permission required',
      '위도':'Latitude', '경도':'Longitude', '반경(km)':'Radius (km)', '날짜':'Date',
      '출발지 이름':'Start name', '예산(원)':'Budget (KRW)', '이동수단':'Transport',
      '도보':'Walking', '버스':'Bus', '지하철':'Subway', '관심사 가중치':'Interest weights',
      '서울 시청 기준 · 360도 스캔':'Seoul City Hall · 360° scan',
      'INSIGHT PANEL':'INSIGHT PANEL', '시각화':'Visualization',
      '업종 분포':'Category mix', '방향 오빗 링':'Direction orbit', '방향 로즈 · 점수':'Direction rose · scores',
      'TOP3 경로 비교 레이더':'Top 3 route radar', '이동 흐름도':'Movement flow',
      '경로 프로필':'Route profile', '혼잡 호라이즌 · 히트맵':'Crowd horizon · heatmap',
      '경로 품질 추이':'Route quality trend',
      'ITINERARY':'ITINERARY', '시간대별 일정표':'Hourly itinerary',
      '행 선택 시 상세·시간 수정·장소 변경 가능':'Select a row for details, time edit or place change',
      '활동':'Activity', '장소':'Place', '계획':'Plan', '예상 시작':'Est. start', '예상 종료':'Est. end', '고정':'Fixed',
      'TOP ROUTES':'TOP ROUTES', '추천 경로 3선':'Top 3 recommended routes',
      'EXPECTATION':'EXPECTATION', '기대치 리포트':'Expectation report',
      'ARCHIVE':'ARCHIVE', '나의 여행 기록':'My travel archive',
      '현재 일정 저장':'Save current plan', '새로고침':'Refresh',
      'PREFERENCES':'PREFERENCES', '가중치 (입력 레일과 연동)':'Weights (synced with input rail)', '연동 상태':'Integration status',
      '▶ 재생':'▶ Play', '❚❚ 정지':'❚❚ Stop', '일정을 분석하면 타임라인이 생성됩니다.':'Analyze a plan to build the timeline.',
      '분석 결과가 없습니다.':'No itinerary yet.', '추정':'Estimated', '이동 또는 대기 구간':'Travel or waiting',
      '추천 이유':'Reasons', '주의사항':'Cautions', '대체 장소':'Alternatives', '없음':'None',
      '분석 후 표시됩니다.':'Shown after analysis.', '경로가 없습니다.':'No route.', '일정이 없습니다.':'No itinerary.',
      '이 경로 선택':'Select this route', '직선거리 기반 추정입니다. 실제 경로는 확인이 필요합니다.':'Straight-line estimate. Verify the actual route.',
      '여행 날짜가 지정되지 않아 날짜 정보는 null입니다.':'Travel date not specified.',
      '귀가 목적지가 지정되지 않아 확인이 필요합니다.':'Return destination not specified.',
      '검색 장소':'Places', '분석 방향':'Directions', '추천 경로':'Routes', '일정 충돌':'Conflicts',
      '데이터 신뢰도':'Data confidence', '개 업종':'categories', '8구역 · 45도':'8 sectors · 45°',
      '충돌 없음':'No conflicts', '확인 필요':'Check needed', '최상위 경로':'Top route',
      '저장된 여행 기록이 없습니다.':'No saved trips.', '아직 방문 기록이 없습니다.':'No visits recorded.',
      '방문 기록':'Visits', '이 일정 다시 사용':'Reuse this plan', '삭제':'Delete', '기록 추가':'Add record',
      '비용(원)':'Cost (KRW)', '메모':'Memo', '서버 상태':'Server', '샘플 장소':'Sample places',
      '포트':'Port', '음성 인식':'Voice input', 'GPS':'GPS', '외부 API':'External API',
      '미연동 (추정 경로)':'Not linked (estimated)', '사용 가능':'Available', '미지원':'Unsupported',
      'Web Speech API':'Web Speech API', '오류: ':'Error: ',
      '질문을 입력하거나 음성으로 말해 주세요.':'Enter a question or use voice input.',
      '경로를 선택했습니다.':'Route selected.', '현재 위치를 출발지로 적용했습니다.':'Current location applied.',
      '지도에서 출발지를 선택했습니다.':'Start point selected on map.', '시간을 수정하고 일정을 다시 검증했습니다.':'Time updated and schedule re-validated.',
      '일정 검증에 실패했습니다.':'Schedule validation failed.', '분석 중 오류가 발생했습니다.':'Analysis failed.',
      '먼저 분석을 실행해 주세요.':'Run analysis first.', '선택된 경로가 없습니다.':'No route selected.',
      '방문 기록을 저장했습니다.':'Visits saved.', '방문 기록을 추가했습니다.':'Visit added.',
      '이전 일정을 불러왔습니다. 분석을 다시 눌러 주세요.':'Previous plan loaded. Run analysis again.',
      '일정을 삭제했습니다.':'Trip deleted.', '실시간 위치 추적을 종료했습니다.':'Live tracking stopped.',
      '실시간 GPS 추적 중…':'Live GPS tracking…', '위치 권한이 거부되었습니다.':'Location permission denied.',
      'GPS 신호를 받지 못했습니다.':'GPS signal unavailable.', '음성 인식 완료: ':'Voice recognized: ',
      '음성 인식 오류: ':'Voice error: ', '음성 인식을 지원하지 않는 브라우저입니다.':'Voice input unsupported in this browser.',
      '음성 인식을 시작할 수 없습니다.':'Cannot start voice input.',
      '관악산 등산로 입구':'Gwanaksan Trail Entrance', '신림 샤워시설':'Sillim Shower Facility',
      '신림역':'Sillim Station', '신림 숯불고등어':'Sillim Mackerel Grill', '신림 볼링센터':'Sillim Bowling Center',
      '이태원 거리':'Itaewon Street', '명동':'Myeongdong', '롯데월드타워':'Lotte World Tower',
      '등산':'Hiking', '샤워':'Shower', '약속':'Meeting', '식사':'Meal', '볼링':'Bowling',
      '국제관광':'Intl. area', '쇼핑':'Shopping', '명소':'Attraction', '야경':'Night view',
      '공원':'Park', '카페':'Cafe', '문화':'Culture', '주점':'Bar', '지하철':'Subway',
      '북':'N', '북동':'NE', '동':'E', '남동':'SE', '남':'S', '남서':'SW', '서':'W', '북서':'NW',
      '여유':'Quiet', '붐빔':'Busy', 'SPOTS':'SPOTS', 'ROUTE SCORE':'ROUTE SCORE',
      '오차 약 ':'accuracy approx. ', 'GPS':'GPS', 'IP 추정':'IP estimate'
    },
    ja: {
      '등산':'登山','신림역':'新林駅','고등어':'さば','볼링':'ボウリング',
      '지침':'ガイド','긴급번호':'緊急番号','기온':'気温','상태':'状態','출처':'出典','권장':'推奨',
      '실외 가능':'屋外可','실내 중심':'屋内中心','흐림':'曇り','맑음':'晴れ','비/눈':'雨/雪','눈':'雪',
      '야외 일정 유지가 가능합니다.':'屋外日程は維持できます。','실내 장소를 우선 적용했습니다.':'屋内場所を優先しました。',
      '경로 시뮬레이션':'経路シミュレーション','대기':'待機','재생 중':'再生中','일시정지':'一時停止',
      '이동 중':'移動中','남은 거리':'残り距離','예상':'予定','이전':'前へ','다음':'次へ','초기화':'リセット',
      '경로를 분석하면 시뮬레이션할 수 있습니다.':'経路を分析するとシミュレーションできます。',
      '전체 경로 주행 완료':'全経路完了','시뮬레이션 시작':'シミュレーション開始',
      '시뮬레이션이 완료되었습니다.':'シミュレーションが完了しました。','먼저 경로를 분석해 주세요.':'まず経路を分析してください。',
      '도착 예정: ':'到着予定: ','주변 장소 목록':'周辺場所一覧','장소':'場所','업종':'業種','거리':'距離','평점':'評価','영업':'営業','요금':'料金','혼잡':'混雑','검색 결과가 없습니다.':'検索結果がありません。',
      '입력 청크 분류':'入力チャンク分類','청크 없음':'チャンクなし','개':'件',
      'date':'日付','time':'時間','place':'場所','activity':'活動','note':'特記',
      '3D 시뮬':'3Dシミュレーション','3D 경로 시뮬레이션을 시작했습니다.':'3D経路シミュレーションを開始しました。','3D 시뮬레이션을 종료했습니다.':'3Dシミュレーションを終了しました。',
      '위험구역':'危険区域','목업データ':'(モックデータ)','목업 데이터':'(モックデータ)','주변 위험구역 없음':'近くに危険区域はありません',
      '우천 가능성':'雨の可能性','실내 선호':'屋内希望','실외 선호':'屋外希望','동행 있음':'同行あり',
      '예산 제한':'予算制限','혼잡도 민감':'混雑敏感',
      '등산 안전 지침':'登山安全ガイド','체육시설 안전 지침':'施設安全ガイド','야간 이동 안전 지침':'夜間移動安全','이동 안전 지침':'移動安全',
      '일몰 2시간 전 하산 시작':'日没2時間前に下山','왕복 시간의 절반 시점에 원위치 복귀 알람':'往復時間の半分で戻るアラーム','8829 산악안전신고':'山岳安全8829',
      '주변 도움 지점: ':'近くの援助地点: ','데이터 없음':'データなし',
      'hiking':'登山','meeting':'待ち合わせ','restaurant':'食事','shopping':'買い物',
      '플랜':'プラン', '플랜 분석':'プラン分析', '플랜 구조화 결과':'プラン構造化結果',
      '시간별 장소 밀집도':'時間帯別場所集中度', '날씨 기반 실내·실외 적용':'天気による屋内・屋外適用',
      '추천 이동수단':'おすすめ交通手段', '시간 알람':'時間アラーム',
      '안전 지침 · 위급 신고':'安全ガイド・緊急通報', '자연어·다국어 가이드':'自然言語・多言語ガイド',
      '날짜':'日付', '시간':'時間', '장소':'場所', '목적':'目的', '특이사항':'特記事項',
      '신뢰도':'信頼度', '미지정':'未指定', '확인 필요':'確認必要', '높음':'高',
      '분석 후 구조화 결과가 표시됩니다.':'分析後に構造化結果が表示されます。',
      '분석 후 밀집도가 표시됩니다.':'分析後に集中度が表示されます。',
      '이 구역 경로 분석':'この地域の経路分析', '경찰 112':'警察112', '소방 119':'消防119',
      '여행 플랜에 대해 무엇이든 물어보세요. 여러 언어를 지원합니다.':'旅行プランについて何でも聞いてください。多言語対応です。',
      '궁금한 여행 질문을 입력하세요':'旅行の質問を入力', '질문':'質問',
      '화면 언어가 변경되었습니다.':'画面言語が変更されました。',
      '관측 데스크':'観測デスク', '음성/입력 언어':'音声／入力言語', '한국어':'韓国語', 'English':'英語',
      '日本語':'日本語', '中文':'中国語', '음성으로 입력':'音声で入力', '🎤 음성':'🎤 音声',
      '🔴 듣는 중':'🔴 認識中', '분석':'分析', '지도':'地図', '컴패스':'コンパス',
      '☀ 라이트':'☀ ライト', '◐ 다크':'◐ ダーク', '섹션 이동':'セクション移動',
      '탐색':'探索', '일정':'日程', '기록':'記録', '설정':'設定', 'START POINT':'出発点',
      '◎ 현재 위치 사용':'◎ 現在地を使用', '실시간 추적 시작':'リアルタイム追跡開始',
      '실시간 추적 중지':'リアルタイム追跡停止', 'GPS 대기 · 위치 권한 필요':'GPS待機・位置情報許可が必要',
      '위도':'緯度', '경도':'経度', '반경(km)':'半径(km)', '날짜':'日付', '출발지 이름':'出発地名',
      '예산(원)':'予算(ウォン)', '이동수단':'移動手段', '도보':'徒歩', '버스':'バス', '지하철':'地下鉄',
      '관심사 가중치':'関心の重み', '서울 시청 기준 · 360도 스캔':'ソウル市庁基準・360度スキャン',
      'INSIGHT PANEL':'インサイト', '시각화':'可視化', '업종 분포':'業種分布', '방향 오빗 링':'方向オービット',
      '방향 로즈 · 점수':'方向ローズ・点数', 'TOP3 경로 비교 레이더':'トップ3経路レーダー',
      '이동 흐름도':'移動フロー', '경로 프로필':'経路プロファイル',
      '혼잡 호라이즌 · 히트맵':'混雑ホライズン・ヒートマップ', '경로 품질 추이':'経路品質の推移',
      'ITINERARY':'旅程', '시간대별 일정표':'時間帯別旅程表',
      '행 선택 시 상세·시간 수정·장소 변경 가능':'行を選択すると詳細・時刻修正・場所変更が可能',
      '활동':'活動', '장소':'場所', '계획':'計画', '예상 시작':'開始予定', '예상 종료':'終了予定', '고정':'固定',
      'TOP ROUTES':'おすすめ経路', '추천 경로 3선':'おすすめ経路トップ3', 'EXPECTATION':'期待値レポート',
      '기대치 리포트':'期待値レポート', 'ARCHIVE':'記録', '나의 여행 기록':'旅行記録',
      '현재 일정 저장':'現在の日程を保存', '새로고침':'更新', 'PREFERENCES':'設定',
      '가중치 (입력 레일과 연동)':'重み（入力欄と連動）', '연동 상태':'連携状態',
      '▶ 재생':'▶ 再生', '❚❚ 정지':'❚❚ 停止', '일정을 분석하면 타임라인이 생성됩니다.':'分析するとタイムラインが生成されます。',
      '분석 결과가 없습니다.':'日程がありません。', '추정':'推定', '이동 또는 대기 구간':'移動または待機',
      '추천 이유':'おすすめ理由', '주의사항':'注意事項', '대체 장소':'代替場所', '없음':'なし',
      '분석 후 표시됩니다.':'分析後に表示されます。', '경로가 없습니다.':'経路がありません。',
      '일정이 없습니다.':'日程がありません。', '이 경로 선택':'この経路を選択',
      '직선거리 기반 추정입니다. 실제 경로는 확인이 필요합니다.':'直線距離の推定です。実際の経路を確認してください。',
      '여행 날짜가 지정되지 않아 날짜 정보는 null입니다.':'旅行日が未指定です。',
      '귀가 목적지가 지정되지 않아 확인이 필요합니다.':'帰宅先が未指定です。',
      '검색 장소':'検索場所', '분석 방향':'分析方向', '추천 경로':'推奨経路', '일정 충돌':'日程冲突',
      '데이터 신뢰도':'データ信頼度', '개 업종':'業種', '8구역 · 45도':'8区画・45度',
      '충돌 없음':'冲突なし', '확인 필요':'確認必要', '최상위 경로':'最高経路',
      '저장된 여행 기록이 없습니다.':'保存された記録がありません。', '아직 방문 기록이 없습니다.':'訪問記録がまだありません。',
      '방문 기록':'訪問記録', '이 일정 다시 사용':'この日程を再利用', '삭제':'削除', '기록 추가':'記録追加',
      '비용(원)':'費用(ウォン)', '메모':'メモ', '서버 상태':'サーバー', '샘플 장소':'サンプル場所',
      '포트':'ポート', '음성 인식':'音声認識', '외부 API':'外部API', '미연동 (추정 경로)':'未連携（推定経路）',
      '사용 가능':'利用可能', '미지원':'非対応', '오류: ':'エラー: ',
      '질문을 입력하거나 음성으로 말해 주세요.':'質問を入力するか音声で話してください。',
      '경로를 선택했습니다.':'経路を選択しました。', '현재 위치를 출발지로 적용했습니다.':'現在地を出発地に設定しました。',
      '지도에서 출발지를 선택했습니다.':'地図で出発地を選択しました。',
      '시간을 수정하고 일정을 다시 검증했습니다.':'時刻を修正し再検証しました。',
      '일정 검증에 실패했습니다.':'日程検証に失敗しました。', '분석 중 오류가 발생했습니다.':'分析中にエラーが発生しました。',
      '먼저 분석을 실행해 주세요.':'まず分析を実行してください。', '선택된 경로가 없습니다.':'選択された経路がありません。',
      '방문 기록을 저장했습니다.':'訪問記録を保存しました。', '방문 기록을 추가했습니다.':'訪問記録を追加しました。',
      '이전 일정을 불러왔습니다. 분석을 다시 눌러 주세요.':'前の日程を読み込みました。再分析してください。',
      '일정을 삭제했습니다.':'日程を削除しました。', '실시간 위치 추적을 종료했습니다.':'リアルタイム追跡を終了しました。',
      '실시간 GPS 추적 중…':'リアルタイムGPS追跡中…', '위치 권한이 거부되었습니다.':'位置情報の許可が拒否されました。',
      'GPS 신호를 받지 못했습니다.':'GPS信号を受信できませんでした。', '음성 인식 완료: ':'音声認識完了: ',
      '음성 인식 오류: ':'音声認識エラー: ', '음성 인식을 지원하지 않는 브라우저입니다.':'このブラウザは音声認識に非対応です。',
      '음성 인식을 시작할 수 없습니다.':'音声認識を開始できません。',
      '관악산 등산로 입구':'冠岳山登山口', '신림역':'新林駅', '명동':'明洞', '이태원 거리':'梨泰院通り',
      '등산':'登山', '샤워':'シャワー', '약속':'待ち合わせ', '식사':'食事', '볼링':'ボウリング',
      '국제관광':'国際観光', '쇼핑':'買い物', '명소':'名所', '야경':'夜景', '공원':'公園',
      '카페':'カフェ', '문화':'文化', '주점':'居酒屋', '지하철':'地下鉄',
      '북':'北', '북동':'北東', '동':'東', '남동':'南東', '남':'南', '남서':'南西', '서':'西', '북서':'北西',
      '여유':'余裕', '붐빔':'混雑', '오차 약 ':'誤差約'
    },
    zh: {
      '등산':'登山','신림역':'新林站','고등어':'鲭鱼','볼링':'保龄球',
      '지침':'指南','긴급번호':'紧急电话','기온':'气温','상태':'状况','출처':'来源','권장':'建议',
      '실외 가능':'可户外','실내 중심':'以室内为主','흐림':'多云','맑음':'晴','비/눈':'雨/雪','눈':'雪',
      '야외 일정 유지가 가능합니다.':'可维持户外行程。','실내 장소를 우선 적용했습니다.':'已优先安排室内场所。',
      '경로 시뮬레이션':'路线模拟','대기':'待机','재생 중':'播放中','일시정지':'已暂停',
      '이동 중':'行进中','남은 거리':'剩余距离','예상':'预计','이전':'上一步','다음':'下一步','초기화':'重置',
      '경로를 분석하면 시뮬레이션할 수 있습니다.':'分析路线后可开始模拟。',
      '전체 경로 주행 완료':'全程模拟完成','시뮬레이션 시작':'模拟开始',
      '시뮬레이션이 완료되었습니다.':'模拟已完成。','먼저 경로를 분석해 주세요.':'请先分析路线。',
      '도착 예정: ':'即将到达: ','주변 장소 목록':'附近地点列表','장소':'地点','업종':'类别','거리':'距离','평점':'评分','영업':'营业','요금':'费用','혼잡':'拥挤','검색 결과가 없습니다.':'没有搜索结果。',
      '입력 청크 분류':'输入分块分类','청크 없음':'无分块','개':'项',
      'date':'日期','time':'时间','place':'地点','activity':'活动','note':'备注',
      '3D 시뮬':'3D模拟','3D 경로 시뮬레이션을 시작했습니다.':'已启动3D路线模拟。','3D 시뮬레이션을 종료했습니다.':'已结束3D模拟。',
      '위험구역':'危险区域','목업 데이터':'(示例数据)','주변 위험구역 없음':'附近无危险区域',
      '우천 가능성':'可能下雨','실내 선호':'偏好室内','실외 선호':'偏好户外','동행 있음':'有同行者',
      '예산 제한':'预算限制','혼잡도 민감':'对拥挤敏感',
      '등산 안전 지침':'登山安全指南','체육시설 안전 지침':'设施安全指南','야간 이동 안전 지침':'夜间出行安全','이동 안전 지침':'出行安全',
      '일몰 2시간 전 하산 시작':'日落前2小时下山','왕복 시간의 절반 시점에 원위치 복귀 알람':'往返时间过半时返回原位提醒','8829 산악안전신고':'山地安全8829',
      '주변 도움 지점: ':'附近求助点: ','데이터 없음':'无数据',
      'hiking':'登山','meeting':'会面','restaurant':'用餐','shopping':'购物',
      '플랜':'计划', '플랜 분석':'计划分析', '플랜 구조화 결과':'计划结构化结果',
      '시간별 장소 밀집도':'分时段地点密度', '날씨 기반 실내·실외 적용':'基于天气的室内外安排',
      '추천 이동수단':'推荐交通方式', '시간 알람':'时间提醒',
      '안전 지침 · 위급 신고':'安全指南 · 紧急报警', '자연어·다국어 가이드':'自然语言·多语言指南',
      '날짜':'日期', '시간':'时间', '장소':'地点', '목적':'目的', '특이사항':'特殊事项',
      '신뢰도':'可信度', '미지정':'未指定', '확인 필요':'需确认', '높음':'高',
      '분석 후 구조화 결과가 표시됩니다.':'分析后显示结构化结果。',
      '분석 후 밀집도가 표시됩니다.':'分析后显示密度。',
      '이 구역 경로 분석':'分析此区域路线', '경찰 112':'警察112', '소방 119':'消防119',
      '여행 플랜에 대해 무엇이든 물어보세요. 여러 언어를 지원합니다.':'欢迎咨询旅行计划，支持多种语言。',
      '궁금한 여행 질문을 입력하세요':'请输入旅行问题', '질문':'提问',
      '화면 언어가 변경되었습니다.':'界面语言已更改。',
      '관측 데스크':'观测台', '음성/입력 언어':'语音／输入语言', '한국어':'韩语', 'English':'英语',
      '日本語':'日语', '中文':'中文', '음성으로 입력':'语音输入', '🎤 음성':'🎤 语音',
      '🔴 듣는 중':'🔴 聆听中', '분석':'分析', '지도':'地图', '컴패스':'罗盘',
      '☀ 라이트':'☀ 浅色', '◐ 다크':'◐ 深色', '섹션 이동':'栏目导航',
      '탐색':'探索', '일정':'日程', '기록':'记录', '설정':'设置', 'START POINT':'出发地',
      '◎ 현재 위치 사용':'◎ 使用当前位置', '실시간 추적 시작':'开始实时追踪',
      '실시간 추적 중지':'停止实时追踪', 'GPS 대기 · 위치 권한 필요':'GPS待机 · 需要位置权限',
      '위도':'纬度', '경도':'经度', '반경(km)':'半径(km)', '날짜':'日期', '출발지 이름':'出发地名称',
      '예산(원)':'预算(韩元)', '이동수단':'交通方式', '도보':'步行', '버스':'公交', '지하철':'地铁',
      '관심사 가중치':'兴趣权重', '서울 시청 기준 · 360도 스캔':'以首尔市厅为中心 · 360度扫描',
      'INSIGHT PANEL':'数据面板', '시각화':'可视化', '업종 분포':'业态分布', '방향 오빗 링':'方向环图',
      '방향 로즈 · 점수':'方向玫瑰 · 评分', 'TOP3 경로 비교 레이더':'前三路线雷达对比',
      '이동 흐름도':'移动流向图', '경로 프로필':'路线剖面',
      '혼잡 호라이즌 · 히트맵':'拥挤地平线 · 热力图', '경로 품질 추이':'路线质量趋势',
      'ITINERARY':'行程表', '시간대별 일정표':'分时段行程表',
      '행 선택 시 상세·시간 수정·장소 변경 가능':'点击行可查看详情、修改时间或更换地点',
      '활동':'活动', '장소':'地点', '계획':'计划', '예상 시작':'预计开始', '예상 종료':'预计结束', '고정':'固定',
      'TOP ROUTES':'推荐路线', '추천 경로 3선':'推荐路线前三', 'EXPECTATION':'预期报告',
      '기대치 리포트':'预期报告', 'ARCHIVE':'档案', '나의 여행 기록':'我的旅行记录',
      '현재 일정 저장':'保存当前行程', '새로고침':'刷新', 'PREFERENCES':'偏好设置',
      '가중치 (입력 레일과 연동)':'权重（与输入栏同步）', '연동 상태':'连接状态',
      '▶ 재생':'▶ 播放', '❚❚ 정지':'❚❚ 停止', '일정을 분석하면 타임라인이 생성됩니다.':'分析后生成时间线。',
      '분석 결과가 없습니다.':'暂无行程。', '추정':'估算', '이동 또는 대기 구간':'移动或等待',
      '추천 이유':'推荐理由', '주의사항':'注意事项', '대체 장소':'备选地点', '없음':'无',
      '분석 후 표시됩니다.':'分析后显示。', '경로가 없습니다.':'暂无路线。', '일정이 없습니다.':'暂无行程。',
      '이 경로 선택':'选择此路线', '직선거리 기반 추정입니다. 실제 경로는 확인이 필요합니다.':'基于直线距离估算，请核实实际路线。',
      '여행 날짜가 지정되지 않아 날짜 정보는 null입니다.':'未指定旅行日期。',
      '귀가 목적지가 지정되지 않아 확인이 필요합니다.':'未指定返程目的地。',
      '검색 장소':'搜索地点', '분석 방향':'分析方向', '추천 경로':'推荐路线', '일정 충돌':'行程冲突',
      '데이터 신뢰도':'数据可信度', '개 업종':'类业态', '8구역 · 45도':'8个区域 · 45度',
      '충돌 없음':'无冲突', '확인 필요':'需确认', '최상위 경로':'最优路线',
      '저장된 여행 기록이 없습니다.':'暂无保存的旅行记录。', '아직 방문 기록이 없습니다.':'暂无访问记录。',
      '방문 기록':'访问记录', '이 일정 다시 사용':'再次使用该行程', '삭제':'删除', '기록 추가':'添加记录',
      '비용(원)':'费用(韩元)', '메모':'备注', '서버 상태':'服务器', '샘플 장소':'示例地点',
      '포트':'端口', '음성 인식':'语音识别', '외부 API':'外部API', '미연동 (추정 경로)':'未连接（估算路线）',
      '사용 가능':'可用', '미지원':'不支持', '오류: ':'错误: ',
      '질문을 입력하거나 음성으로 말해 주세요.':'请输入问题或使用语音输入。',
      '경로를 선택했습니다.':'已选择路线。', '현재 위치를 출발지로 적용했습니다.':'已将当前位置设为出发地。',
      '지도에서 출발지를 선택했습니다.':'已在地图上选择出发地。',
      '시간을 수정하고 일정을 다시 검증했습니다.':'时间已修改并重新验证。',
      '일정 검증에 실패했습니다.':'行程验证失败。', '분석 중 오류가 발생했습니다.':'分析出错。',
      '먼저 분석을 실행해 주세요.':'请先运行分析。', '선택된 경로가 없습니다.':'未选择路线。',
      '방문 기록을 저장했습니다.':'访问记录已保存。', '방문 기록을 추가했습니다.':'访问记录已添加。',
      '이전 일정을 불러왔습니다. 분석을 다시 눌러 주세요.':'已载入之前的行程，请重新分析。',
      '일정을 삭제했습니다.':'行程已删除。', '실시간 위치 추적을 종료했습니다.':'已停止实时定位。',
      '실시간 GPS 추적 중…':'实时GPS追踪中…', '위치 권한이 거부되었습니다.':'位置权限被拒绝。',
      'GPS 신호를 받지 못했습니다.':'无法获取GPS信号。', '음성 인식 완료: ':'语音识别完成: ',
      '음성 인식 오류: ':'语音识别错误: ', '음성 인식을 지원하지 않는 브라우저입니다.':'此浏览器不支持语音识别。',
      '음성 인식을 시작할 수 없습니다.':'无法启动语音识别。',
      '관악산 등산로 입구':'冠岳山登山口', '신림역':'新林站', '명동':'明洞', '이태원 거리':'梨泰院街',
      '등산':'登山', '샤워':'淋浴', '약속':'会面', '식사':'用餐', '볼링':'保龄球',
      '국제관광':'国际观光', '쇼핑':'购物', '명소':'景点', '야경':'夜景', '공원':'公园',
      '카페':'咖啡馆', '문화':'文化', '주점':'酒吧', '지하철':'地铁',
      '북':'北', '북동':'东北', '동':'东', '남동':'东南', '남':'南', '남서':'西南', '서':'西', '북서':'西北',
      '여유':'宽松', '붐빔':'拥挤', '오차 약 ':'误差约'
    }
  };

  // 숫자/동적 문장용 규칙: [정규식, 언어별 치환 템플릿]
  const RULES = [
    [/^경로\s*(\d+)개를 추천했습니다\.$/, { en:'Recommended $1 routes.', ja:'$1件の経路を提案しました。', zh:'已推荐 $1 条路线。' }],
    [/^장소를\s*(.+)\(으\)로 변경했습니다\.$/, { en:'Place changed to $1.', ja:'場所を$1に変更しました。', zh:'已将地点更改为 $1。' }],
    [/^GPS 위치 확인 완료$/, { en:'GPS location confirmed', ja:'GPS位置を確認しました', zh:'已确认GPS位置' }],
    [/^GPS 위치 확인 중…$/, { en:'Locating via GPS…', ja:'GPSで位置確認中…', zh:'正在通过GPS定位…' }]
  ];

  let current = localStorage.getItem('sc-ui-lang') || 'ko';
  let applying = false;

  function canonicalize(text) {
    if (!text) return text;
    const key = text.trim();
    if (DICT.ko[key] !== undefined) return key;
    for (const lang of ['en', 'ja', 'zh']) {
      const table = DICT[lang];
      for (const k in table) if (table[k] === key) return k;
    }
    return text;
  }

  function translateText(text) {
    if (!text || !text.trim()) return text;
    const source = canonicalize(text);
    const trimmed = source.trim();
    if (current === 'ko') return trimmed;
    if (DICT[current] && DICT[current][trimmed] !== undefined) return DICT[current][trimmed];
    for (const [re, table] of RULES) {
      const m = trimmed.match(re);
      if (m && table[current]) return trimmed.replace(re, table[current]);
    }
    // 앞뒤 공백/접두어가 있는 문장
    for (const [re, table] of RULES) {
      const m = text.match(re);
      if (m && table[current]) return text.replace(re, table[current]);
    }
    // 한 텍스트 노드에 여러 항목이 섞여 있는 경우(예: "장소 등산 · 신림역") 교체
    const pairs = [];
    if (current === 'ko') {
      for (const lang of ['en', 'ja', 'zh'])
        for (const k in DICT[lang]) pairs.push([DICT[lang][k], k]);
    } else {
      for (const k in DICT[current]) pairs.push([k, DICT[current][k]]);
    }
    pairs.sort((a, b) => b[0].length - a[0].length);
    let result = text;
    pairs.forEach(([from, to]) => { if (from && result.includes(from)) result = result.split(from).join(to); });
    return result;
  }

  function apply(root) {
    if (applying) return;
    applying = true;
    try {
      const scope = root || document.body;
      document.documentElement.lang = ({ ko:'ko', en:'en', ja:'ja', zh:'zh-CN' })[current] || 'ko';
      document.title = translateText('Seoul Compass AI — 관측 데스크');
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((node) => {
        if (node.parentElement && node.parentElement.closest('[translate="no"]')) return;
        const next = translateText(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
      });
      const all = scope.querySelectorAll ? Array.from(scope.querySelectorAll('*')) : [];
      if (scope.nodeType === 1) all.unshift(scope);
      all.forEach((el) => {
        if (el.closest('[translate="no"]')) return;
        ['placeholder', 'title', 'aria-label'].forEach((attr) => {
          const value = el.getAttribute(attr);
          if (value) {
            const next = translateText(value);
            if (next !== value) el.setAttribute(attr, next);
          }
        });
      });
    } finally { applying = false; }
  }

  function setLang(lang) {
    current = lang;
    localStorage.setItem('sc-ui-lang', lang);
    apply();
  }

  new MutationObserver((records) => {
    if (applying) return;
    let changed = false;
    records.forEach((r) => { if (r.addedNodes.length || r.type === 'characterData') changed = true; });
    if (changed) apply();
  }).observe(document.body, { childList:true, subtree:true, characterData:true });

  global.SeoulI18n = { apply, setLang, translateText, get lang() { return current; } };
})(window);
