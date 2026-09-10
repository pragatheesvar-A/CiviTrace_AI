"""
Dual-stack launcher.

Windows resolves `localhost` to IPv6 (::1) first. If the server only listens on
IPv4, every browser/tool request stalls ~2 s before falling back — which looks
exactly like "the backend is slow". Binding a single IPv6 socket with
IPV6_V6ONLY=0 serves ::1, 127.0.0.1 and 0.0.0.0 from one socket.

    python serve.py            # port 8010
    python serve.py 9000       # custom port
"""
import socket
import sys

import uvicorn

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
RELOAD = "--reload" in sys.argv


def _dual_stack_socket(port: int) -> socket.socket:
    s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)  # accept IPv4 too
    except (AttributeError, OSError):
        pass
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("::", port))
    s.listen(256)
    s.set_inheritable(True)
    return s


if __name__ == "__main__":
    if RELOAD:
        # reload needs the import-string path; bind IPv6 host (covers IPv4 on Win)
        uvicorn.run("main:app", host="::", port=PORT, reload=True)
    else:
        sock = _dual_stack_socket(PORT)
        print(f"CiviTrace AI API  ->  http://localhost:{PORT}   http://127.0.0.1:{PORT}")
        config = uvicorn.Config("main:app", log_level="info")
        uvicorn.Server(config).run(sockets=[sock])
