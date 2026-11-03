"""합성 테스트 도안 PDF (실제 하트 체인 가디건 PDF 구조를 흉내). 사용: python3 scripts/make-fixture.py out.pdf"""
import sys, random
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.colors import HexColor, black, white

pdfmetrics.registerFont(UnicodeCIDFont("HYGothic-Medium"))
F = "HYGothic-Medium"
out = sys.argv[1] if len(sys.argv) > 1 else "fixture.pdf"
c = canvas.Canvas(out)
random.seed(3)

_first = [True]
def page(w=595, h=842):
    if not _first[0]:
        c.showPage()
    _first[0] = False
    c.setPageSize((w, h))

def text(x, y_top, s, size=9):
    # y_top: 위에서부터 pt
    c.setFont(F, size); c.drawString(x, c._pagesize[1] - y_top, s)

def chart(n0, n1, cols, x0, y_bottom_top, cell_w, row_h, colored=False, stitch_numbers=True):
    """y_bottom_top: 맨 아래 단 아래 경계의 '위에서부터' 좌표"""
    H = c._pagesize[1]
    top = y_bottom_top - (n1 - n0 + 1) * row_h
    c.setLineWidth(0.3)
    palette = [HexColor("#B23A48"), HexColor("#2F5D8A")]
    for i, n in enumerate(range(n0, n1 + 1)):
        yb = y_bottom_top - i * row_h  # 이 단 아래 경계 (위에서부터)
        for k in range(cols):
            x = x0 + k * cell_w
            if colored and ((k + n) % 7 in (0, 1) or (n % 9 == 0)):
                c.setFillColor(palette[(n // 9) % 2]); c.rect(x, H - yb, cell_w, row_h, stroke=0, fill=1)
            elif not colored and (k % 6 in (0, 5)):
                c.setFillColor(black); c.rect(x + cell_w * 0.45, H - yb + row_h * 0.15, cell_w * 0.1, row_h * 0.7, stroke=0, fill=1)
        c.setFillColor(black); c.setFont(F, max(4, min(7, row_h * 1.1)))
        ymid = yb - row_h / 2
        # 단 번호: 홀수 오른쪽, 짝수 왼쪽 (숫자 세로 중심이 단 중심에 오게)
        fs = max(4, min(7, row_h * 1.1))
        base = H - ymid - fs * 0.35
        if n % 2: c.drawString(x0 + cols * cell_w + 3, base, str(n))
        else: c.drawRightString(x0 - 3, base, str(n))
    c.setStrokeColor(black)
    for k in range(cols + 1):
        c.setLineWidth(0.6 if k % 10 == 0 else 0.25)
        c.line(x0 + k * cell_w, H - top, x0 + k * cell_w, H - y_bottom_top)
    for i in range(n1 - n0 + 2):
        c.setLineWidth(0.25); y = y_bottom_top - i * row_h
        c.line(x0, H - y, x0 + cols * cell_w, H - y)
    if stitch_numbers:
        c.setFont(F, 6)
        for k in range(0, cols, 10):
            c.drawCentredString(x0 + (cols - k - 0.5) * cell_w, H - (y_bottom_top + 9), str(k * 2 + 10))

# 1 표지
page(); text(80, 120, "하트 체인 가디건", 22); text(80, 150, "MAYO KNIT 테스트용 합성 도안", 11)
# 2 사이즈표·게이지·스와치 차트
page()
text(50, 50, "사이즈표  S M L XL 2XL 3XL", 11)
text(50, 70, "게이지: 18코 23단 메리야스뜨기 / 38코 27단 무늬뜨기 (10cm)", 10)
text(50, 88, "무늬 스와치: 일반코잡기로 38코를 잡아 주세요. 코잡기가 1단, 2단 안면부터 시작합니다.", 9)
text(50, 104, "스와치는 세탁 후 건조해서 콧수와 단수를 재어 주세요. 차트대로 뜹니다.", 9)
chart(1, 31, 38, 120, 760, 9, 18 * 0.6, colored=True)
# 3 진행 과정·차트 보는 법·기법 설명
page()
text(50, 60, "진행 과정: 뒷판 → 앞판 → 앞뒤판 연결 → 몸통 → 고무단 → 소매 → 버튼밴드 → 카라", 9)
text(50, 90, "차트 보는 법: 안뜨기 기호는 생략했습니다. 홀수단은 겉면(RS), 짝수단은 안면(WS)이며", 9)
text(50, 104, "안면에서는 차트를 반대로(겉↔안) 읽습니다. 차트는 겉면에서 본 모양입니다.", 9)
text(85, 318, "기법 설명", 12)
for i, s in enumerate(["| 겉뜨기", "빈칸 안뜨기", "2/1LC 왼쪽 교차", "2/1RC 오른쪽 교차", "2/2LC 왼쪽 교차", "2/2RC 오른쪽 교차", "1/1LPC", "1/1RPC", "DS 독일식 경사뜨기", "M1R 오른쪽 늘림", "M1L 왼쪽 늘림", "k2tog 왼코겹치기", "ssk 오른코겹치기", "YO 바늘비우기", "턴 뜨개를 돌림"]):
    y = 340 + i * 32
    c.setFillColor(black); c.rect(85, 842 - y - 4, 14, 14, stroke=1, fill=0)
    text(125, y + 6, s, 9)
# 4–6 사이즈별 뒷판 경사뜨기
ko = "뒷판은 아래에서 위로 뜨며 경사뜨기로 어깨 경사를 만듭니다. 차트를 함께 보세요. "
for p, sz, n in ((4, "S, M 사이즈", 100), (5, "L, XL 사이즈", 110), (6, "2XL, 3XL 사이즈", 124)):
    page(842, 595)
    text(40, 40, f"뒷판 경사뜨기 — {sz}", 12)
    text(40, 60, ko, 9)
    for i in range(1, 15):
        side = "(RS)" if i % 2 else "(WS)"
        text(40, 70 + i * 24, f"{i}단{side}", 9)
        text(110, 70 + i * 24, f"겉{n//10 + i}, DS, 턴, 겉3 (괄호 숫자는 사이즈 순서)", 9)
# 7–12 공통 서술
for p in range(7, 13):
    page(842, 595)
    title = {7: "오른쪽 앞판", 8: "왼쪽 앞판", 9: "앞뒤판 연결 · 몸통 (L사이즈 샘플)", 10: "고무단 · 소매", 11: "버튼밴드 · 단춧구멍", 12: "카라 41–56단 · 마무리"}[p]
    text(40, 40, title, 12)
    text(40, 60, "모든 사이즈 공통입니다. 숫자는 S (M) L (XL) 2XL (3XL) 순서입니다. " * 2, 9)
    for i in range(1, 12):
        text(40, 80 + i * 24, f"{i*2}단", 9)
        text(110, 80 + i * 24, "100 (104) 110 (114) 124 (134)코가 되도록 겉뜨기, 2/1LC, 안2", 9)
    text(40, 400, "16단~58단까지 [차트 S:p13 / M:p13 / L:p13]를 따라 진행합니다.", 9)
# 13 L 뒷판 차트 (가로 페이지, 2–116단, 단 간격 4.5pt)
page(842, 595)
text(40, 24, "L 뒷판", 11)
chart(2, 116, 110, 72, 560, 6.36, 4.5)
# 14 몸통 (아주 넓은 가로 페이지, 73–130단, 단 간격 4.87pt)
page(1502, 595)
text(40, 24, "L 몸통", 11)
chart(73, 130, 220, 60, 400, 6.4, 4.87)
c.save()
print(out)
