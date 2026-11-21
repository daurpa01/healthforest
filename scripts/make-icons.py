#!/usr/bin/env python3
"""Iconos geométricos de HealthForest, sin dependencias."""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def png(size: int) -> bytes:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x / size, y / size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")


def pixel(u: float, v: float) -> bytes:
    # Fondo bosque con copa y tronco.
    bg = (20, 53, 43, 255)
    if (u - 0.5) ** 2 + (v - 0.38) ** 2 < 0.045:
        return bytes((62, 174, 122, 255))
    if (u - 0.36) ** 2 + (v - 0.46) ** 2 < 0.028:
        return bytes((31, 107, 76, 255))
    if (u - 0.66) ** 2 + (v - 0.45) ** 2 < 0.022:
        return bytes((143, 208, 176, 255))
    if 0.45 < u < 0.55 and 0.52 < v < 0.82:
        return bytes((226, 179, 64, 255))
    # Esquinas redondeadas.
    radius = 0.18
    for cx, cy in ((radius, radius), (1 - radius, radius), (radius, 1 - radius), (1 - radius, 1 - radius)):
        if ((u < radius or u > 1 - radius) and (v < radius or v > 1 - radius)) and (u - cx) ** 2 + (v - cy) ** 2 > radius ** 2:
            return bytes((0, 0, 0, 0))
    return bytes(bg)


def ico(png32: bytes, png16: bytes) -> bytes:
    # ICO con PNG embebidos.
    images = [(32, png32), (16, png16)]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b""
    blobs = b""
    for size, data in images:
        entries += struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    return header + entries + blobs


def icns(images: dict[str, bytes]) -> bytes:
    # ic07 = 128, ic08 = 256, ic09 = 512, ic11 = 32@2x (64).
    body = b""
    for kind, data in images.items():
        body += kind.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    return b"icns" + struct.pack(">I", len(body) + 8) + body


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    sizes = {16: png(16), 32: png(32), 64: png(64), 128: png(128), 256: png(256), 512: png(512)}
    (ROOT / "32x32.png").write_bytes(sizes[32])
    (ROOT / "128x128.png").write_bytes(sizes[128])
    (ROOT / "128x128@2x.png").write_bytes(sizes[256])
    (ROOT / "icon.ico").write_bytes(ico(sizes[32], sizes[16]))
    (ROOT / "icon.icns").write_bytes(icns({"ic11": sizes[64], "ic07": sizes[128], "ic08": sizes[256], "ic09": sizes[512]}))
    print("iconos en", ROOT)


if __name__ == "__main__":
    main()
