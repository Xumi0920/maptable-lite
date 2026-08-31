#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""离线精简省界 GeoJSON：用 Douglas-Peucker 折线简化，容差 0.005°(约500m) 保留区划形状。
用法：python scripts/simplify_provinces.py [input.json] [output.json] [tolerance]
默认：src/lib/china_provinces.json → src/lib/china_provinces.json（就地）
"""
import json, sys, copy

def dp(points, tol):
    """Douglas-Peucker 折线简化：points 是 [(x,y),...] 闭合环。返回精简后的点(不含重复首尾)。"""
    if len(points) < 3:
        return points
    # 去重：闭合环首尾相同则保留首部
    pts = points
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return pts
    def perp_dist(p, a, b):
        # 点 p 到线段 ab 的垂直距离(平面近似,度)
        ax, ay = a; bx, by = b; px, py = p
        dx, dy = bx - ax, by - ay
        L = (dx*dx + dy*dy) ** 0.5
        if L == 0:
            return ((px-ax)**2 + (py-ay)**2) ** 0.5
        return abs(dx*(ay-py) - dy*(ax-px)) / L
    def simplify(seg):
        if len(seg) < 3:
            return seg
        a, b = seg[0], seg[-1]
        max_d, max_i = 0, -1
        for i in range(1, len(seg)-1):
            d = perp_dist(seg[i], a, b)
            if d > max_d:
                max_d, max_i = d, i
        if max_d > tol:
            left = simplify(seg[:max_i+1])
            right = simplify(seg[max_i:])
            return left[:-1] + right
        return [a, b]
    result = simplify(pts)
    # 保证闭环至少 3 个不同点（否则 polygon 无效，形成不了面）
    if len(set(result)) < 3:
        # 等间隔保留最多 5 个点
        n = len(pts)
        idxs = sorted(set([0, n // 3, 2 * n // 3, n - 1]))
        result = [pts[i] for i in idxs]
    return result + [pts[0]]  # 补回闭合点

def simplify_ring(ring, tol):
    """GeoJSON 一个环 [[lng,lat],...] → 简化后的环。"""
    pts = [(p[0], p[1]) for p in ring]
    closed = pts[0] == pts[-1]
    sp = dp(pts, tol)
    # dp 已返回(可能已闭合)；确保闭合
    if sp[0] != sp[-1]:
        sp = sp + [sp[0]]
    return [[x, y] for x, y in sp]

def simplify_geom(coords, tol):
    """GeoJSON coordinates(Polygon 或 MultiPolygon) 精简。"""
    if not coords:
        return coords
    if isinstance(coords[0], list) and isinstance(coords[0][0], list) and isinstance(coords[0][0][0], (int, float)):
        # Polygon: [ring, ring...]
        return [simplify_ring(r, tol) for r in coords]
    # MultiPolygon: [[ring...], [ring...]...]
    return [simplify_geom(poly, tol) for poly in coords]

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else 'src/lib/china_provinces.json'
    out = sys.argv[2] if len(sys.argv) > 2 else src
    tol = float(sys.argv[3]) if len(sys.argv) > 3 else 0.005
    d = json.load(open(src, encoding='utf-8'))
    total = 0
    for f in d['features']:
        g = f.get('geometry')
        if not g or g['type'] not in ('Polygon', 'MultiPolygon'):
            continue
        before = json.dumps(g['coordinates'])
        g['coordinates'] = simplify_geom(g['coordinates'], tol)
        after = json.dumps(g['coordinates'])
        total += len(before) - len(after)
    json.dump(d, open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    size = len(open(out, 'rb').read())
    print(f'简化完成({tol}°): {len(d["features"])}省, 输出 {size/1024:.0f}KB, 原{src}')

if __name__ == '__main__':
    main()
