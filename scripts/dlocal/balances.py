#!/usr/bin/env python3
"""
dLocal balance scraper using camoufox (Firefox-based, anti-fingerprinting).
Test script to check if camoufox bypasses Cloudflare bot protection.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

# Load .env manually (no python-dotenv dependency assumed)
env_path = Path(__file__).parents[2] / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from camoufox.async_api import AsyncCamoufox  # noqa: E402


def notify_slack_error(partner: str, task: str, error: Exception) -> None:
    """Send a Slack error alert via chat.postMessage using bot token."""
    import urllib.request
    from datetime import datetime, timezone

    token = os.environ.get("SLACK_BOT_TOKEN")
    channel = os.environ.get("SLACK_CHANNEL_ID")
    if not token or not channel:
        return

    timestamp = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S UTC")
    text = (
        f":red_circle: *Script failure* — Provider: `{partner}` | Process: `{task}`\n"
        f"*Error:* `{error}`\n"
        f"*Time:* {timestamp}"
    )

    payload = json.dumps({"channel": channel, "text": text}).encode()
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass


def parse_amount(raw: str) -> float:
    return float(raw.replace(",", "")) if raw.replace(",", "").replace(".", "").isdigit() else 0.0


async def main() -> None:
    username = os.environ.get("DLOCAL_USERNAME")
    password = os.environ.get("DLOCAL_PASSWORD")
    webhook_url = os.environ.get("BALANCES_WEBHOOK_URL")

    if not username or not password:
        print("[error] DLOCAL_USERNAME / DLOCAL_PASSWORD not set in .env", file=sys.stderr)
        sys.exit(1)

    print("[info] starting with camoufox (headless Firefox)")

    async with AsyncCamoufox(headless=True) as browser:
        page = await browser.new_page()
        page.set_default_timeout(90000)

        # -----------------------------------------------------------------------
        # LOGIN — Cloudflare + Auth0 two-step
        # -----------------------------------------------------------------------
        print("[info] navigating to dashboard.dlocal.com")
        await page.goto("https://dashboard.dlocal.com/", wait_until="domcontentloaded")
        await page.wait_for_timeout(15000)  # Cloudflare → Auth0 redirect

        current_url = page.url
        print(f"[info] url after wait: {current_url}")

        # Email step
        try:
            await page.get_by_role("textbox", name="Email").fill(username)
            await page.get_by_role("button", name="CONTINUE").click()
            await page.wait_for_timeout(3000)
        except Exception as e:
            print(f"[error] cloudflare_blocked — could not reach login form: {e}", file=sys.stderr)
            screenshot = Path(__file__).parents[2] / ".tmp/camoufox_blocked.png"
            screenshot.parent.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(screenshot))
            print(f"[info] screenshot saved to {screenshot}")
            notify_slack_error("dlocal", "balances", e)
            sys.exit(1)

        # Password step
        await page.get_by_role("textbox", name="Password").fill(password)
        await page.get_by_role("button", name="CONTINUE").click()
        await page.wait_for_timeout(4000)

        if "dashboard.dlocal.com" not in page.url:
            err = Exception(f"login_failed — unexpected URL: {page.url}")
            print(f"[error] {err}", file=sys.stderr)
            notify_slack_error("dlocal", "balances", err)
            sys.exit(1)

        print("[info] logged_in")

        # -----------------------------------------------------------------------
        # NAVIGATE — Balance Report
        # -----------------------------------------------------------------------
        await page.goto("https://dashboard.dlocal.com/balance/report", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        await page.wait_for_selector("main ul li", timeout=15000)
        print("[info] balance_page_loaded")

        # -----------------------------------------------------------------------
        # EXTRACT — 4 summary cards
        # -----------------------------------------------------------------------
        cards = await page.evaluate("""() => {
            const items = document.querySelectorAll('main ul li');
            const result = {};
            for (const item of items) {
                const ps = item.querySelectorAll('p');
                if (ps.length >= 2) {
                    const title = ps[0].textContent?.trim() ?? '';
                    const value = ps[1].textContent?.trim() ?? '0';
                    const currency = ps[2]?.textContent?.trim() ?? 'IDR';
                    if (title) result[title] = { value, currency };
                }
            }
            return result;
        }""")

        print(f"[info] cards_extracted: {list(cards.keys())}")

        available    = parse_amount(cards.get("AVAILABLE BALANCE",    {}).get("value", "0"))
        in_transit   = parse_amount(cards.get("IN TRANSIT TO YOUR BANK", {}).get("value", "0"))
        payins       = parse_amount(cards.get("PAYINS IN TRANSIT",    {}).get("value", "0"))
        current      = parse_amount(cards.get("CURRENT BALANCE",      {}).get("value", "0"))

        if current == 0 and available == 0:
            err = Exception("extraction_failed — all values zero, page may not have loaded")
            print(f"[error] {err}", file=sys.stderr)
            notify_slack_error("dlocal", "balances", err)
            sys.exit(1)

        from datetime import datetime, timezone
        result = {
            "partner": "dlocal",
            "scrape_timestamp": datetime.now(timezone.utc).isoformat(),
            "balances": {
                "IDR": {
                    "available": available,
                    "pending": in_transit + payins,
                    "current": current,
                }
            },
            "detail": {
                "available_balance": available,
                "in_transit_to_bank": in_transit,
                "payins_in_transit": payins,
                "current_balance": current,
            },
        }

        print(f"[info] result: {json.dumps(result, indent=2)}")

        # -----------------------------------------------------------------------
        # DELIVER
        # -----------------------------------------------------------------------
        if webhook_url:
            if not webhook_url.startswith("https://"):
                raise ValueError(f"BALANCES_WEBHOOK_URL must use HTTPS, got: {webhook_url!r}")
            import urllib.request
            req = urllib.request.Request(
                webhook_url,
                data=json.dumps(result).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                print(f"[info] webhook delivered — status {resp.status}")
        else:
            print("[warn] BALANCES_WEBHOOK_URL not set, skipping delivery")

        print("[info] completed")


asyncio.run(main())
