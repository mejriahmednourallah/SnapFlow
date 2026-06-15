from . import (
    assert_node,
    check,
    click,
    condition,
    fill,
    inspect_response,
    navigate,
    screenshot,
    select,
    submit,
    upload,
    wait,
)

HANDLERS = {
    "trigger": navigate.execute,
    "navigate": navigate.execute,
    "form_fill": fill.execute,
    "fill": fill.execute,
    "select": select.execute,
    "check": check.execute,
    "upload": upload.execute,
    "click": click.execute,
    "submit": submit.execute,
    "wait": wait.execute,
    "condition": condition.execute,
    "assert": assert_node.execute,
    "screenshot": screenshot.execute,
    "inspect_response": inspect_response.execute,
}

__all__ = ["HANDLERS"]
