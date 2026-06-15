from models import FieldDefinition, NodeDefinition, StepOutcome


async def execute(page, node: NodeDefinition, field: FieldDefinition | None, context) -> StepOutcome:
    url = node.config.get("url") or context.snapshot.target_url
    if not isinstance(url, str) or not url.strip():
        raise ValueError("navigation_url_missing")
    response = await page.goto(
        url.strip(),
        wait_until="domcontentloaded",
        timeout=context.settings.navigation_timeout_ms,
    )
    await page.wait_for_timeout(context.settings.settle_ms)
    return StepOutcome(
        output={
            "requested_url": url,
            "final_url": page.url,
            "status_code": response.status if response else None,
            "title": await page.title(),
        }
    )
