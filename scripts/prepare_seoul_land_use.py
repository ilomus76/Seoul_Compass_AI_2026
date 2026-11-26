"""서울시 OA-21145의 2025년 비오톱 ZIP을 위·경도 표본으로 변환한다."""
import argparse
import json
import math
import struct
from pathlib import Path
from zipfile import ZipFile


LABELS = {
    'R': '주거지', 'B': '상업·업무지', 'I': '공업지·도시기반시설',
    'T': '교통시설', 'G': '조경녹지', 'F': '산림지', 'W': '하천·습지',
    'A': '경작지', 'U': '유휴지',
}
SOURCE_TYPES = dict(zip('ABCDEFGHI', 'RBITGWAFU'))


def projected_point(latitude, longitude):
    """WGS84에서 EPSG:5174 좌표로 변환한다. EPSG:5191 역변환과 중부원점 투영."""
    lat, lng = map(math.radians, (latitude, longitude))
    wgs_e2, bessel_e2 = (2 / inv - 1 / inv ** 2 for inv in (298.257223563, 299.1528128))
    wgs_n = 6378137 / math.sqrt(1 - wgs_e2 * math.sin(lat) ** 2)
    x = wgs_n * math.cos(lat) * math.cos(lng)
    y = wgs_n * math.cos(lat) * math.sin(lng)
    z = wgs_n * (1 - wgs_e2) * math.sin(lat)
    rx, ry, rz = (math.radians(a / 3600) for a in (-1.162, 2.347, 1.592))
    x, y, z = ((v - t) / 1.000006342 for v, t in zip((x, y, z), (-145.907, 505.034, 685.756)))
    x, y, z = x + rz * y - ry * z, y - rz * x + rx * z, z + ry * x - rx * y
    lng, p = math.atan2(y, x), math.hypot(x, y)
    lat = math.atan2(z, p)
    a = 6377397.155
    for _ in range(5):
        n = a / math.sqrt(1 - bessel_e2 * math.sin(lat) ** 2)
        lat = math.atan2(z + bessel_e2 * n * math.sin(lat), p)

    e2, e4, e6 = bessel_e2, bessel_e2 ** 2, bessel_e2 ** 3

    def meridian(phi):
        return a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
                    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
                    + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi)
                    - 35 * e6 / 3072 * math.sin(6 * phi))

    n = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    t = math.tan(lat) ** 2
    c = e2 / (1 - e2) * math.cos(lat) ** 2
    delta = (lng - math.radians(127.002890277778)) * math.cos(lat)
    east = 200000 + n * (delta + (1 - t + c) * delta ** 3 / 6)
    north = (500000 + meridian(lat) - meridian(math.radians(38))
             + n * math.tan(lat) * (delta ** 2 / 2 + (5 - t + 9 * c + 4 * c ** 2) * delta ** 4 / 24))
    return east, north


def polygon_records(data):
    """SHP Polygon 레코드에서 외곽선과 내부 구멍의 선분을 읽는다."""
    offset = 100
    while offset < len(data):
        words = struct.unpack_from('>i', data, offset + 4)[0]
        start, offset = offset + 8, offset + 8 + 2 * words
        if struct.unpack_from('<i', data, start)[0] == 0:
            yield []
            continue
        parts, count = struct.unpack_from('<2i', data, start + 36)
        rings = struct.unpack_from(f'<{parts}i', data, start + 44) + (count,)
        points = list(struct.iter_unpack('<2d', data[start + 44 + 4 * parts:offset]))
        if len(points) != count:
            raise ValueError('Polygon(5) 형식 파일을 사용해 주세요.')
        yield [(points[i - 1], points[i]) for first, last in zip(rings, rings[1:]) for i in range(first + 1, last)]


def build_grid(shapes, fields):
    count, start, size = struct.unpack_from('<IHH', fields, 4)
    if fields[32:43].rstrip(b'\0').decode('cp949') != '비오톱유형':
        raise ValueError('비오톱유형 필드가 첫 번째인 원본을 사용해 주세요.')
    west, south = 178000, 435000
    cell = 25
    grid = [bytearray(b'.' * 1600) for _ in range(1320)]
    processed = 0
    for i, edges in enumerate(polygon_records(shapes)):
        if i >= count:
            raise ValueError('SHP와 DBF의 행 수가 다릅니다.')
        processed += 1
        kind = SOURCE_TYPES.get(chr(fields[start + i * size + 1]))
        if not kind or not edges:
            continue
        crossings = {}
        for (x1, y1), (x2, y2) in edges:
            if y1 == y2:
                continue
            first = max(0, math.ceil((min(y1, y2) - south) / cell - .5))
            last = min(len(grid), math.ceil((max(y1, y2) - south) / cell - .5))
            for row in range(first, last):
                y = south + (row + .5) * cell
                crossings.setdefault(row, []).append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        for row, points in crossings.items():
            columns = [math.ceil((x - west) / cell - .5) for x in sorted(points)]
            for left, right in zip(columns[::2], columns[1::2]):
                lo, hi = max(0, left), min(len(grid[row]), right)
                if hi > lo:
                    grid[row][lo:hi] = kind.encode() * (hi - lo)
    if processed != count:
        raise ValueError('SHP와 DBF의 행 수가 다릅니다.')

    lat0, lng0, dy, dx = 37.40, 126.75, .0005, .000625
    rows = []
    for j in range(660):
        row = bytearray()
        for i in range(720):
            x, y = projected_point(lat0 + j * dy, lng0 + i * dx)
            col, line = math.floor((x - west) / cell), math.floor((y - south) / cell)
            row.append(grid[line][col] if 0 <= line < len(grid) and 0 <= col < len(grid[0]) else ord('.'))
        rows.append(row.decode('ascii'))
    return dict(south=lat0, west=lng0, lat_step=dy, lng_step=dx, labels=LABELS, rows=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    with ZipFile(args.source) as archive:
        shape, fields = (archive.read(next(name for name in archive.namelist() if name.endswith(suffix)))
                         for suffix in ('.shp', '.dbf'))
    grid = build_grid(shape, fields)
    args.output.write_text(json.dumps(grid, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
