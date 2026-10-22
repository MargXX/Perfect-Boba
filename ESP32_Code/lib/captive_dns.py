import asyncio
import socket

# A tiny DNS server that answers every name with the ESP32's own address.
# Phones look up a test site when they join WiFi (captive.apple.com,
# connectivitycheck.gstatic.com...); with no answer at all, Android decides the
# network is broken and sends traffic over mobile data instead, so the order
# page won't load. The web server answers those test pages (see boba_server.py).


def _answer(query, ip):
    # Skip the 12-byte header and the question's name (length-prefixed labels
    # ending in a 0 byte); the type and class take 4 more bytes.
    i = 12
    while query[i]:
        i += query[i] + 1
    end = i + 5
    is_a = query[end - 4:end - 2] == b"\x00\x01"
    header = query[:2] + b"\x81\x80" + b"\x00\x01" + (b"\x00\x01" if is_a else b"\x00\x00") + b"\x00\x00\x00\x00"
    out = header + query[12:end]
    if is_a:
        # Name = pointer to the question's name, type A, class IN, 60 s TTL, 4-byte address.
        out += b"\xc0\x0c\x00\x01\x00\x01\x00\x00\x00\x3c\x00\x04" + ip
    return out


async def serve(ip):
    ip_bytes = bytes(int(x) for x in ip.split("."))
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", 53))
    s.setblocking(False)
    while True:
        try:
            query, addr = s.recvfrom(512)
        except OSError:
            # asyncio can't wait on UDP sockets, so check a few times a second.
            await asyncio.sleep_ms(50)
            continue
        try:
            s.sendto(_answer(query, ip_bytes), addr)
        except Exception as e:
            print("dns error:", e)
