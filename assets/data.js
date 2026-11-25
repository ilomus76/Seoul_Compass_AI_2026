/* Seoul Compass AI 2026 — 샘플 데이터
 * 실제 공식 데이터가 아닌 데모용 예시 데이터입니다. 방문 전 공식 정보를 확인하세요.
 */
(function (global) {
  'use strict';

  const SPOTS = [
    {
      id: 'gyeongbokgung', name: '경복궁', nameEn: 'Gyeongbokgung Palace',
      category: 'heritage', district: '종로구', districtEn: 'Jongno-gu',
      lat: 37.5796, lng: 126.9770, rating: 4.8, indoor: false, emoji: '🏯',
      tags: ['한옥', '역사', '궁궐', '사진', 'palace', 'history'],
      desc: '조선의 법궁. 근정전과 경회루, 국립민속박물관까지 하루 종일 둘러볼 수 있습니다.',
      descEn: 'The main royal palace of the Joseon dynasty, with Geunjeongjeon Hall and Gyeonghoeru Pavilion.',
      hours: '09:00–17:00 (화요일 휴무)', transit: '지하철 3호선 경복궁역 5번 출구',
      tip: '한복을 입으면 입장료가 면제됩니다.', tipEn: 'Free admission if you wear a traditional hanbok.'
    },
    {
      id: 'bukchon', name: '북촌한옥마을', nameEn: 'Bukchon Hanok Village',
      category: 'heritage', district: '종로구', districtEn: 'Jongno-gu',
      lat: 37.5826, lng: 126.9850, rating: 4.6, indoor: false, emoji: '🏘️',
      tags: ['한옥', '골목', '산책', '사진', 'hanok', 'village'],
      desc: '계단식 한옥 골목이 이어지는 전통 마을. 조용한 오전 산책을 추천합니다.',
      descEn: 'A hillside neighborhood of traditional hanok houses, best visited in the quiet morning.',
      hours: '상시 개방 (주민 생활 공간)', transit: '지하철 3호선 안국역 2번 출구',
      tip: '주민들을 배려해 조용히 둘러보세요.', tipEn: 'Please keep quiet — this is a residential area.'
    },
    {
      id: 'insadong', name: '인사동', nameEn: 'Insadong Street',
      category: 'culture', district: '종로구', districtEn: 'Jongno-gu',
      lat: 37.5720, lng: 126.9910, rating: 4.5, indoor: false, emoji: '🖌️',
      tags: ['전통', '공예', '찻집', '기념품', 'traditional', 'crafts'],
      desc: '전통 공예품과 찻집, 갤러리가 모인 거리. 전통 문화를 가까이서 만날 수 있습니다.',
      descEn: 'A street of traditional crafts, tea houses and galleries in the heart of Jongno.',
      hours: '10:00–20:00 (상점별 상이)', transit: '지하철 3호선 안국역 6번 출구',
      tip: '골목 안쪽의 작은 찻집이 숨은 명소입니다.', tipEn: 'Hidden tea houses await in the narrow alleys.'
    },
    {
      id: 'deoksugung', name: '덕수궁', nameEn: 'Deoksugung Palace',
      category: 'heritage', district: '중구', districtEn: 'Jung-gu',
      lat: 37.5659, lng: 126.9753, rating: 4.7, indoor: false, emoji: '🏛️',
      tags: ['궁궐', '석조전', '산책', '야경', 'palace', 'walk'],
      desc: '서양식 석조전과 돌담길이 어우러진 궁궐. 저녁 산책 코스로도 좋습니다.',
      descEn: 'A palace blending Korean and Western architecture, with a lovely stone-wall walk.',
      hours: '09:00–21:00 (월요일 휴무)', transit: '지하철 1호선 시청역 2번 출구',
      tip: '돌담길 야간 조명이 아름답습니다.', tipEn: 'The stone wall is beautifully lit at night.'
    },
    {
      id: 'nmuseum', name: '국립중앙박물관', nameEn: 'National Museum of Korea',
      category: 'culture', district: '용산구', districtEn: 'Yongsan-gu',
      lat: 37.5240, lng: 126.9805, rating: 4.9, indoor: true, emoji: '🏺',
      tags: ['실내', '박물관', '역사', '비 오는 날', 'museum', 'indoor'],
      desc: '한국 역사와 문화를 한눈에. 비 오는 날에도 즐길 수 있는 대표 실내 명소입니다.',
      descEn: 'Korea’s largest museum — an ideal rainy-day destination covering thousands of years.',
      hours: '10:00–18:00 (주말 21:00, 월요일 휴무)', transit: '지하철 4호선 이촌역 2번 출구',
      tip: '상설전만 둘러보아도 2~3시간이 걸립니다.', tipEn: 'Allow 2–3 hours for the permanent exhibitions alone.'
    },
    {
      id: 'mmca', name: '국립현대미술관 서울', nameEn: 'MMCA Seoul',
      category: 'culture', district: '종로구', districtEn: 'Jongno-gu',
      lat: 37.5790, lng: 126.9880, rating: 4.6, indoor: true, emoji: '🖼️',
      tags: ['실내', '미술관', '전시', '비 오는 날', 'art', 'indoor'],
      desc: '옛 국군기무사터를 재생한 미술관. 현대 미술 전시와 넓은 마당이 인상적입니다.',
      descEn: 'A contemporary art museum on a former military site, with spacious courtyards.',
      hours: '10:00–18:00 (목·토 21:00, 월요일 휴무)', transit: '지하철 3호선 안국역 1번 출구',
      tip: '전시 관람 후 마당에서 잠시 쉬어가세요.', tipEn: 'Take a break in the courtyard after the exhibitions.'
    },
    {
      id: 'ddp', name: '동대문디자인플라자', nameEn: 'Dongdaemun Design Plaza',
      category: 'culture', district: '중구', districtEn: 'Jung-gu',
      lat: 37.5665, lng: 126.9826, rating: 4.5, indoor: true, emoji: '🌐',
      tags: ['실내', '디자인', '전시', '야경', 'design', 'indoor'],
      desc: '자하 하디드가 설계한 비정형 건축물. 전시와 디자인 마켓, 야경까지 한곳에서.',
      descEn: 'Zaha Hadid’s futuristic landmark for design exhibitions, markets and night views.',
      hours: '10:00–20:00 (전시별 상이)', transit: '지하철 1·4호선 동대문역 1번 출구',
      tip: '밤에는 LED 조명이 건물 외벽을 수놓습니다.', tipEn: 'The facade lights up after dark.'
    },
    {
      id: 'namsan', name: '남산서울타워', nameEn: 'N Seoul Tower',
      category: 'night', district: '용산구', districtEn: 'Yongsan-gu',
      lat: 37.5512, lng: 126.9882, rating: 4.6, indoor: false, emoji: '🗼',
      tags: ['야경', '전망', '데이트', 'night', 'view'],
      desc: '서울의 상징적인 전망대. 해 질 녘에 올라가면 도시 전체가 발아래 펼쳐집니다.',
      descEn: 'Seoul’s iconic observation tower, best visited around sunset for panoramic views.',
      hours: '10:00–23:00', transit: '지하철 4호선 명동역 3번 출구 → 케이블카',
      tip: '케이블카 대신 남산순환버스도 편리합니다.', tipEn: 'The Namsan circular bus is a convenient alternative to the cable car.'
    },
    {
      id: 'lotteworld', name: '롯데월드타워', nameEn: 'Lotte World Tower',
      category: 'night', district: '송파구', districtEn: 'Songpa-gu',
      lat: 37.5125, lng: 127.1025, rating: 4.6, indoor: true, emoji: '🌆',
      tags: ['야경', '전망', '쇼핑', '실내', 'night', 'indoor', 'view'],
      desc: '서울 전경을 내려다보는 전망대와 쇼핑몰이 함께 있는 복합 공간입니다.',
      descEn: 'A tower with an observation deck and shopping mall overlooking the city.',
      hours: '전망대 10:00–22:00', transit: '지하철 2·8호선 잠실역 2번 출구',
      tip: '맑은 날 저녁 예약이 가장 인기 있습니다.', tipEn: 'Evening slots on clear days are the most popular.'
    },
    {
      id: 'banpo', name: '반포한강공원', nameEn: 'Banpo Hangang Park',
      category: 'nature', district: '서초구', districtEn: 'Seocho-gu',
      lat: 37.5133, lng: 126.9958, rating: 4.7, indoor: false, emoji: '🌊',
      tags: ['한강', '피크닉', '자전거', '야경', 'river', 'picnic'],
      desc: '한강변 잔디밭과 달빛무지개분수 쇼. 피크닉과 산책에 딱 좋은 곳입니다.',
      descEn: 'Riverside lawns and the Moonlight Rainbow Fountain — perfect for a picnic or stroll.',
      hours: '상시 개방', transit: '지하철 3·7·9호선 고속터미널역 8-1번 출구',
      tip: '분수 쇼는 계절과 기상에 따라 운영이 달라집니다.', tipEn: 'Fountain shows vary by season and weather.'
    },
    {
      id: 'yeouido', name: '여의도한강공원', nameEn: 'Yeouido Hangang Park',
      category: 'nature', district: '영등포구', districtEn: 'Yeongdeungpo-gu',
      lat: 37.5284, lng: 126.9216, rating: 4.6, indoor: false, emoji: '🛶',
      tags: ['한강', '벚꽃', '자전거', '피크닉', 'river', 'cherry'],
      desc: '넓은 잔디밭과 자전거길. 봄에는 벚꽃, 가을에는 억새가 아름답습니다.',
      descEn: 'Wide lawns and cycling paths, famous for cherry blossoms in spring.',
      hours: '상시 개방', transit: '지하철 5호선 여의나루역 3번 출구',
      tip: '자전거 대여소가 공원 입구 근처에 있습니다.', tipEn: 'Bike rental stations are near the park entrance.'
    },
    {
      id: 'seoulforest', name: '서울숲', nameEn: 'Seoul Forest',
      category: 'nature', district: '성동구', districtEn: 'Seongdong-gu',
      lat: 37.5444, lng: 127.0374, rating: 4.7, indoor: false, emoji: '🌳',
      tags: ['공원', '산책', '가족', '사진', 'park', 'walk'],
      desc: '숲과 습지, 미술관이 어우러진 도심 생태 공원. 느긋한 오후에 좋습니다.',
      descEn: 'An urban eco-park with forests, wetlands and galleries — great for a slow afternoon.',
      hours: '05:00–24:00', transit: '수인분당선 서울숲역 4번 출구',
      tip: '사슴방사장과 나비정원을 함께 둘러보세요.', tipEn: 'Don’t miss the deer enclosure and butterfly garden.'
    },
    {
      id: 'bukhansan', name: '북한산국립공원', nameEn: 'Bukhansan National Park',
      category: 'nature', district: '강북구', districtEn: 'Gangbuk-gu',
      lat: 37.6584, lng: 126.9779, rating: 4.8, indoor: false, emoji: '⛰️',
      tags: ['등산', '자연', '트레킹', 'hiking', 'nature'],
      desc: '서울 북부의 거대한 화강암 산맥. 백운대 코스는 반나절 이상 잡으세요.',
      descEn: 'Granite peaks north of the city; the Baegundae route takes half a day or more.',
      hours: '상시 개방 (일몰 후 입산 제한)', transit: '지하철 4호선 수유역 → 버스',
      tip: '초보자는 우이동 코스를 추천합니다.', tipEn: 'Beginners should try the Ui-dong trail.'
    },
    {
      id: 'myeongdong', name: '명동', nameEn: 'Myeongdong',
      category: 'shopping', district: '중구', districtEn: 'Jung-gu',
      lat: 37.5636, lng: 126.9834, rating: 4.4, indoor: false, emoji: '🛍️',
      tags: ['쇼핑', '화장품', '길거리음식', 'shopping', 'street food'],
      desc: '쇼핑과 길거리 음식이 가득한 서울의 대표 상권. 밤에도 활기가 넘칩니다.',
      descEn: 'Seoul’s busiest shopping district, packed with beauty stores and street food.',
      hours: '10:00–22:00 (상점별 상이)', transit: '지하철 4호선 명동역 6번 출구',
      tip: '환율과 면세 혜택을 비교해 보세요.', tipEn: 'Compare exchange rates and duty-free benefits.'
    },
    {
      id: 'gwjangmarket', name: '광장시장', nameEn: 'Gwangjang Market',
      category: 'food', district: '종로구', districtEn: 'Jongno-gu',
      lat: 37.5700, lng: 126.9990, rating: 4.5, indoor: true, emoji: '🍜',
      tags: ['맛집', '실내', '빈대떡', '육회', 'food', 'indoor', 'market'],
      desc: '100년 전통의 식자재 시장. 빈대떡과 육회비빔밥으로 유명합니다.',
      descEn: 'A century-old market famous for mung-bean pancakes and raw beef bibimbap.',
      hours: '09:00–23:00 (점포별 상이)', transit: '지하철 1·4호선 종로5가역 8번 출구',
      tip: '혼잡 시간대에는 자리 찾기가 어려울 수 있습니다.', tipEn: 'Finding a seat can be tricky at peak hours.'
    },
    {
      id: 'ikseon', name: '익선동', nameEn: 'Ikseon-dong',
      category: 'food', district: '종로구', districtEn: 'Jongno-gu',
      lat: 37.5722, lng: 126.9942, rating: 4.5, indoor: true, emoji: '🍵',
      tags: ['맛집', '카페', '한옥', '골목', 'food', 'cafe', 'indoor'],
      desc: '한옥을 개조한 카페와 식당이 모인 골목. 비 오는 날에도 즐길 수 있습니다.',
      descEn: 'Narrow alleys lined with cafés and restaurants in converted hanok houses.',
      hours: '11:00–22:00 (업체별 상이)', transit: '지하철 1·3호선 종로3가역 4번 출구',
      tip: '골목 끝까지 걸어가면 조용한 카페가 나옵니다.', tipEn: 'Walk to the end of the alley for quieter cafés.'
    },
    {
      id: 'hongdae', name: '홍대 거리', nameEn: 'Hongdae Street',
      category: 'culture', district: '마포구', districtEn: 'Mapo-gu',
      lat: 37.5563, lng: 126.9236, rating: 4.4, indoor: false, emoji: '🎤',
      tags: ['음악', '카페', '젊음', '거리공연', 'music', 'cafe'],
      desc: '버스킹과 클럽, 개성 있는 카페가 모인 젊은 문화의 중심지입니다.',
      descEn: 'A lively youth culture hub with buskers, clubs and independent cafés.',
      hours: '상시 (상점별 상이)', transit: '지하철 2호선 홍대입구역 9번 출구',
      tip: '저녁 7시 이후 거리 공연이 활발합니다.', tipEn: 'Street performances pick up after 7 p.m.'
    },
    {
      id: 'yeonnam', name: '연남동 카페거리', nameEn: 'Yeonnam-dong Café Street',
      category: 'food', district: '마포구', districtEn: 'Mapo-gu',
      lat: 37.5610, lng: 126.9250, rating: 4.5, indoor: true, emoji: '☕',
      tags: ['카페', '디저트', '골목', '실내', 'cafe', 'dessert', 'indoor'],
      desc: '골목마다 개성 있는 카페가 들어선 동네. 느린 오후를 보내기 좋습니다.',
      descEn: 'A neighborhood of characterful cafés tucked into quiet alleys.',
      hours: '10:00–22:00 (업체별 상이)', transit: '지하철 2호선 홍대입구역 3번 출구 → 도보',
      tip: '경의선 숲길과 함께 코스를 짜보세요.', tipEn: 'Combine your visit with the Gyeongui Line Forest Park.'
    },
    {
      id: 'seongsu', name: '성수동 카페거리', nameEn: 'Seongsu-dong Café Street',
      category: 'food', district: '성동구', districtEn: 'Seongdong-gu',
      lat: 37.5445, lng: 127.0557, rating: 4.5, indoor: true, emoji: '🥐',
      tags: ['카페', '편집숍', '공장개조', '실내', 'cafe', 'indoor', 'shops'],
      desc: '옛 공장을 개조한 카페와 편집숍이 가득한 서울의 힙한 동네입니다.',
      descEn: 'Hip cafés and select shops in converted factories, east of the Han River.',
      hours: '10:00–22:00 (업체별 상이)', transit: '지하철 2호선 성수역 3번 출구',
      tip: '주말 오후에는 대기가 길어질 수 있습니다.', tipEn: 'Expect queues on weekend afternoons.'
    },
    {
      id: 'itaewon', name: '이태원', nameEn: 'Itaewon',
      category: 'food', district: '용산구', districtEn: 'Yongsan-gu',
      lat: 37.5345, lng: 126.9940, rating: 4.3, indoor: false, emoji: '🌍',
      tags: ['세계음식', '다국가', '밤거리', 'world food', 'nightlife'],
      desc: '다양한 국적의 음식점과 상점이 모인 거리. 세계적인 분위기를 느낄 수 있습니다.',
      descEn: 'An international district with food and shops from around the world.',
      hours: '상점별 상이', transit: '지하철 6호선 이태원역 1번 출구',
      tip: '할랄·비건 옵션을 찾기 쉬운 지역입니다.', tipEn: 'A good area for halal and vegan options.'
    },
    {
      id: 'seouland', name: '서울대공원', nameEn: 'Seoul Grand Park',
      category: 'nature', district: '과천시', districtEn: 'Gwacheon',
      lat: 37.4391, lng: 127.0170, rating: 4.6, indoor: false, emoji: '🦒',
      tags: ['동물원', '가족', '공원', 'zoo', 'family'],
      desc: '동물원과 식물원, 호수가 있는 넓은 공원. 하루 계획을 잡고 가세요.',
      descEn: 'A spacious park with a zoo, botanical garden and lake — plan a full day.',
      hours: '09:00–18:00 (시설별 상이)', transit: '지하철 4호선 대공원역 2번 출구',
      tip: '동물원과 케이블카를 함께 이용하면 편합니다.', tipEn: 'Combine the zoo with the cable car for an easier day.'
    },
    {
      id: 'changyeong', name: '창경궁', nameEn: 'Changyeonggung Palace',
      category: 'heritage', district: '종로구', districtEn: 'Jongno-gu',
      lat: 37.5795, lng: 126.9967, rating: 4.6, indoor: false, emoji: '🏯',
      tags: ['궁궐', '역사', '산책', 'palace', 'history'],
      desc: '조선 왕궁 중 하나로, 봄에는 벚꽃이 유명합니다. 통문으로 창덕궁과 이어집니다.',
      descEn: 'A Joseon palace known for spring cherry blossoms, connected to Changdeokgung.',
      hours: '09:00–21:00 (월요일 휴무)', transit: '지하철 4호선 혜화역 4번 출구',
      tip: '창덕궁과 묶어서 관람하면 좋습니다.', tipEn: 'Visit together with neighboring Changdeokgung.'
    },
    {
      id: 'seochon', name: '서촌', nameEn: 'Seochon',
      category: 'culture', district: '종로구', districtEn: 'Jongno-gu',
      lat: 37.5800, lng: 126.9690, rating: 4.6, indoor: false, emoji: '🏡',
      tags: ['한옥', '골목', '카페', '전시', 'hanok', 'cafe'],
      desc: '경복궁 서쪽의 오래된 동네. 작은 갤러리와 한옥 카페가 숨어 있습니다.',
      descEn: 'An old neighborhood west of Gyeongbokgung, full of small galleries and hanok cafés.',
      hours: '상시 (상점별 상이)', transit: '지하철 3호선 경복궁역 2번 출구',
      tip: '통인시장의 도시락 카페도 색다른 경험입니다.', tipEn: 'Try the lunch-box café at Tongin Market.'
    }
  ];

  const CATEGORIES = [
    { key: 'all', ko: '전체', en: 'All', emoji: '✨' },
    { key: 'heritage', ko: '궁궐·한옥', en: 'Palaces', emoji: '🏯' },
    { key: 'culture', ko: '문화·예술', en: 'Culture', emoji: '🖼️' },
    { key: 'nature', ko: '자연·공원', en: 'Nature', emoji: '🌳' },
    { key: 'night', ko: '야경·전망', en: 'Night', emoji: '🌃' },
    { key: 'food', ko: '맛집·카페', en: 'Food', emoji: '🍜' },
    { key: 'shopping', ko: '쇼핑', en: 'Shopping', emoji: '🛍️' }
  ];

  const I18N = {
    ko: {
      'nav.explore': '명소 찾기', 'nav.course': '코스 설계', 'nav.guide': 'AI 가이드',
      'hero.eyebrow': '데이터로 찾는 나만의 서울', 'hero.title1': '오늘의 서울,', 'hero.title2': '컴패스가 안내합니다.',
      'hero.desc': '명소를 검색하고, 취향에 맞는 코스를 만들고, 궁금한 건 AI 가이드에게 물어보세요.',
      'hero.search': '어디를 가고 싶나요? (예: 야경, 한옥, 맛집)', 'hero.searchBtn': '찾기',
      'stat.spots': '수록 명소', 'stat.areas': '커버 지역', 'stat.langs': '지원 언어',
      'explore.eyebrow': 'EXPLORE SEOUL', 'explore.title': '어디로 갈까요?', 'explore.indoor': '실내만 보기',
      'map.title': '서울 지도', 'map.badge': '개략도', 'map.note': '위치는 실제 좌표를 개략도에 매핑한 것입니다.',
      'course.title': '내 여행 코스', 'course.clear': '비우기', 'course.empty': "명소 카드에서 '코스에 담기'를 눌러보세요.",
      'course.recommend': '취향으로 코스 추천받기',
      'guide.eyebrow': 'AI CONCIERGE', 'guide.title': 'AI 가이드에게 물어보세요',
      'guide.badge': '로컬 추천 엔진 · 외부 API 불필요', 'guide.placeholder': '예: 오늘 비 와! 실내 코스 짜줘', 'guide.send': '보내기',
      'footer.note': '본 사이트는 서울 여행 가이드 개발을 위한 데모 프로젝트입니다. 수록 정보는 예시 데이터이며, 방문 전 반드시 공식 정보를 확인하세요.',
      'card.add': '코스에 담기', 'card.added': '담김 ✓', 'card.detail': '상세 보기',
      'modal.add': '코스에 담기', 'modal.close': '닫기', 'empty.title': '조건에 맞는 명소가 없어요.',
      'empty.desc': '검색어나 필터를 바꿔보세요.', 'chat.welcome': '안녕하세요! 서울컴패스 AI 가이드입니다. 궁금한 여행 질문을 입력해 보세요.',
      'chat.help': '이렇게 물어보세요: 코스 짜줘 / 비 와! 실내로 재조정 / 야경 명소 / 지하철 정보 / 도움말',
      'course.summary': '예상 소요', 'course.walk': '이동 거리', 'course.start': '출발', 'course.stop': '도착',
      'weather.rain': '비', 'weather.clear': '맑음', 'weather.cloud': '흐림'
    },
    en: {
      'nav.explore': 'Explore', 'nav.course': 'Plan a course', 'nav.guide': 'AI Guide',
      'hero.eyebrow': 'Find your own Seoul', 'hero.title1': 'Seoul today,', 'hero.title2': 'guided by Compass.',
      'hero.desc': 'Search places, build a course that fits your taste, and ask the AI guide anything.',
      'hero.search': 'Where do you want to go? (e.g. night view, hanok, food)', 'hero.searchBtn': 'Search',
      'stat.spots': 'Places', 'stat.areas': 'Districts', 'stat.langs': 'Languages',
      'explore.eyebrow': 'EXPLORE SEOUL', 'explore.title': 'Where to next?', 'explore.indoor': 'Indoor only',
      'map.title': 'Seoul map', 'map.badge': 'Sketch', 'map.note': 'Positions are approximate coordinates mapped onto a sketch.',
      'course.title': 'My itinerary', 'course.clear': 'Clear', 'course.empty': "Tap 'Add to course' on any place card.",
      'course.recommend': 'Recommend a course for me',
      'guide.eyebrow': 'AI CONCIERGE', 'guide.title': 'Ask the AI guide',
      'guide.badge': 'Local recommendation engine · no API key needed', 'guide.placeholder': 'e.g. It’s raining! Indoor plan please', 'guide.send': 'Send',
      'footer.note': 'This is a demo project for developing a Seoul travel guide. All information is sample data — verify with official sources before visiting.',
      'card.add': 'Add to course', 'card.added': 'Added ✓', 'card.detail': 'Details',
      'modal.add': 'Add to course', 'modal.close': 'Close', 'empty.title': 'No places match your filters.',
      'empty.desc': 'Try changing the search term or filter.', 'chat.welcome': 'Hi! I’m the Seoul Compass AI guide. Ask me anything about your trip.',
      'chat.help': 'Try: plan a course / raining, indoor plan / night views / subway info / help',
      'course.summary': 'Estimated time', 'course.walk': 'Walking distance', 'course.start': 'Start', 'course.stop': 'End',
      'weather.rain': 'Rain', 'weather.clear': 'Clear', 'weather.cloud': 'Cloudy'
    }
  };

  global.SeoulData = { SPOTS, CATEGORIES, I18N };
})(window);
