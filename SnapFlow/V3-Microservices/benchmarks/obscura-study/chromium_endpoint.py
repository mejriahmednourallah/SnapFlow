"""Expose a headless Chromium CDP endpoint inside the isolated Docker network.

The relay is needed because headless Chromium binds its debugging port to
loopback. The engine container contains no Playwright driver process.
"""
import asyncio
import glob
import subprocess


async def relay(reader, writer):
    peer_reader, peer_writer = await asyncio.open_connection("127.0.0.1", 9222)

    async def forward(source, destination):
        try:
            while data := await source.read(65536):
                destination.write(data)
                await destination.drain()
        finally:
            destination.close()

    await asyncio.gather(forward(reader, peer_writer), forward(peer_reader, writer), return_exceptions=True)


async def main():
    binary = glob.glob("/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell")[0]
    process = subprocess.Popen([binary, "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--remote-debugging-port=9222", "--remote-debugging-address=127.0.0.1", "--no-first-run", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    server = await asyncio.start_server(relay, "0.0.0.0", 9333)
    print("Chromium endpoint started", flush=True)
    try:
        async with server:
            await server.serve_forever()
    finally:
        process.terminate()
        process.wait(timeout=5)


if __name__ == "__main__":
    asyncio.run(main())
