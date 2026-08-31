#!/usr/bin/env python3
"""신규자과정 좌석 조회 페이지 빌드 스크립트.

명단 엑셀(좌석배려 반영본, 좌석배치도 시트 포함)을 읽어 개인정보를 암호화한
정적 HTML(seat-lookup/index.html)을 생성한다.
페이지 소스에는 이름·전화번호 원본이 들어가지 않는다:
  - 조회 키: PBKDF2-SHA256(이름|뒤4자리, salt, 200k회) 앞 16바이트(hex)
  - 레코드: 같은 파생값의 뒤 32바이트를 AES-256-GCM 키로 사용해 암호화

좌석은 교번=좌석번호 1:1 매칭(좌석배려가 교번 재배열로 이미 반영됨).
443번은 휠체어석.

사용법:  python3 build_seat_lookup.py [엑셀비밀번호]
"""
import sys, os, io, re, json, base64, hashlib, secrets
import openpyxl
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BASE = os.path.dirname(os.path.abspath(__file__))
ROSTER_XLSX = os.path.join(BASE, "2026년_제2기_신규자과정_분임편성_및_교육생명단(좌석배려 반영).xlsx")
TEMPLATE = os.path.join(BASE, "seat-lookup.template.html")
OUT_DIR = os.path.join(BASE, "seat-lookup")

SALT = "djhrd-2026-2-newbie-v1"
ITER = 200_000

# 체육대회 조 매핑. {교번: "청팀"} 또는 분임→조 규칙이 정해지면 team_of()를 수정.
def team_of(row):
    return None  # 아직 미정 → 페이지에 "추후 안내" 표시


def open_workbook(password):
    with open(ROSTER_XLSX, "rb") as fp:
        head = fp.read(8)
        fp.seek(0)
        if head[:4] == b"PK\x03\x04":  # 암호 해제된 파일
            return openpyxl.load_workbook(fp, data_only=True)
        import msoffcrypto
        off = msoffcrypto.OfficeFile(fp)
        off.load_key(password=password)
        buf = io.BytesIO()
        off.decrypt(buf)
        return openpyxl.load_workbook(buf, data_only=True)


def load_roster(wb):
    ws = wb["분임편성 명단"]
    people = []
    for r in range(5, ws.max_row + 1):
        eid = ws.cell(r, 2).value  # 교번
        if eid is None:
            continue
        people.append({
            "eid": int(eid),
            "name": str(ws.cell(r, 5).value).strip(),
            "phone": str(ws.cell(r, 9).value).strip(),
            "bunim": int(ws.cell(r, 14).value),  # 분임(집계용)
        })
    people.sort(key=lambda p: p["eid"])
    return people


def load_seats(wb):
    """좌석배치도 시트에서 1층 좌석(1~443)을 읽는다. 443(휠체어석)은 문자열 셀."""
    ws = wb["좌석배치도"]
    grid, wheel = [], set()
    for r in range(7, 23):  # 1층: 1~15열 + 휠체어석 행
        for c in range(1, ws.max_column + 1):
            v = ws.cell(r, c).value
            if isinstance(v, (int, float)) and 1 <= v <= 443:
                n = int(v)
            elif isinstance(v, str) and "휠체어" in v and (m := re.match(r"^(\d{1,3})", v.strip())):
                n = int(m.group(1))  # 예: "443(휠체어석)"
                wheel.add(n)
            else:
                continue
            grid.append([n, r - 6, c])
    nums = sorted(s[0] for s in grid)
    assert nums == list(range(1, 444)), f"좌석 수 이상: {len(grid)}개, 누락/중복 확인 필요"
    return sorted(grid), wheel


def encrypt_records(people, wheel):
    data = {}
    for p in people:
        material = f'{p["name"].replace(" ", "")}|{p["phone"][-4:]}'.encode()
        dk = hashlib.pbkdf2_hmac("sha256", material, SALT.encode(), ITER, dklen=48)
        lookup_id, aes_key = dk[:16].hex(), dk[16:48]
        rec = {"n": p["name"], "e": p["eid"], "b": p["bunim"],
               "t": team_of(p), "s": p["eid"]}  # 교번=좌석번호 1:1
        if p["eid"] in wheel:
            rec["w"] = 1
        iv = secrets.token_bytes(12)
        ct = AESGCM(aes_key).encrypt(iv, json.dumps(rec, ensure_ascii=False).encode(), None)
        assert lookup_id not in data, f'조회키 충돌: {p["name"]}'
        data[lookup_id] = base64.b64encode(iv + ct).decode()
    return data


def main():
    password = sys.argv[1] if len(sys.argv) > 1 else "66640"
    wb = open_workbook(password)
    people = load_roster(wb)
    grid, wheel = load_seats(wb)
    assert len(people) == len(grid), f"인원 {len(people)} ≠ 좌석 {len(grid)}"
    data = encrypt_records(people, wheel)

    with open(TEMPLATE, encoding="utf-8") as f:
        html = f.read()
    html = (html
            .replace("__DATA__", json.dumps(data, separators=(",", ":")))
            .replace("__GRID__", json.dumps(grid, separators=(",", ":")))
            .replace("__SALT__", SALT)
            .replace("__ITER__", str(ITER)))

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "index.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"완료: {out} ({os.path.getsize(out)//1024} KB)")
    print(f"인원 {len(people)}명 / 좌석 {len(grid)}석 / 휠체어석 {sorted(wheel)}")


if __name__ == "__main__":
    main()
