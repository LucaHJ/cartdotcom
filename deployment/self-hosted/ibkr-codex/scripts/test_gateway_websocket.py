"""End-to-end check for the protected public noVNC websocket route."""

import asyncio

import httpx
import websockets

from app.notifications import create_validation_link


async def main() -> None:
    link = create_validation_link()
    with httpx.Client(timeout=20) as client:
        validation = client.get(link)
        validation.raise_for_status()
        token = client.cookies.get("ibkr_validation")
    if not token:
        raise RuntimeError("The validation response did not issue a session cookie.")
    websocket_url = link.split("/account-validation", 1)[0].replace("https://", "wss://") + "/gateway/websockify"
    async with websockets.connect(
        websocket_url,
        additional_headers={"Cookie": f"ibkr_validation={token}"},
        open_timeout=15,
    ) as websocket:
        greeting = await asyncio.wait_for(websocket.recv(), 10)
        if not bytes(greeting).startswith(b"RFB "):
            raise RuntimeError("The gateway websocket did not return an RFB greeting.")
    print("protected gateway websocket: ok")


if __name__ == "__main__":
    asyncio.run(main())

