"""Apply checked, narrow fixes to the locked upstream tree; fail on drift."""
from pathlib import Path
import sys

root = Path(sys.argv[1])
context = root/'crates/obscura-browser/src/context.rs'
source = context.read_text()
for expression in ['stealth', 'self.stealth']:
    old = f'if {expression} {{\n            client.block_trackers = true;\n        }}'
    new = f'client.block_trackers = {expression} && obscura_net::blocklist::tracker_blocking_enabled(\n            std::env::var("OBSCURA_BLOCK_TRACKERS").ok().as_deref(),\n        );'
    if source.count(old) != 1:
        raise RuntimeError(f'Unexpected context source for {expression}')
    source = source.replace(old, new)
context.write_text(source)

client = root/'crates/obscura-net/src/wreq_client.rs'
source = client.read_text()
old = '''#[cfg(feature = "stealth")]
fn tracker_blocking_enabled(value: Option<&str>) -> bool {
    !matches!(
        value.map(str::trim),
        Some(value) if matches!(value.to_ascii_lowercase().as_str(), "0" | "false" | "no" | "off")
    )
}'''
if source.count(old) != 1:
    raise RuntimeError('Unexpected stealth filter parser source')
source = source.replace(old, 'use crate::blocklist::tracker_blocking_enabled;')
client.write_text(source)

blocklist = root/'crates/obscura-net/src/blocklist.rs'
source = blocklist.read_text()
source += '''

/// Shared filter policy for both classic-resource and TLS-stealth transports.
pub fn tracker_blocking_enabled(value: Option<&str>) -> bool {
    !matches!(
        value.map(str::trim),
        Some(value) if matches!(value.to_ascii_lowercase().as_str(), "0" | "false" | "no" | "off")
    )
}

#[cfg(test)]
mod snapflow_filter_tests {
    use super::tracker_blocking_enabled;

    #[test]
    fn shared_filter_policy_preserves_default_and_explicit_off() {
        assert!(tracker_blocking_enabled(None));
        assert!(tracker_blocking_enabled(Some("true")));
        for value in ["0", "false", "no", "off", " OFF "] {
            assert!(!tracker_blocking_enabled(Some(value)));
        }
    }
}
'''
blocklist.write_text(source)
print('Applied shared tracker filtering policy to constructor, fork and stealth client')

# Classic external scripts used the plain client even in TLS-stealth mode.
# Match the existing stylesheet transport selection without changing ordering.
page = root/'crates/obscura-browser/src/page.rs'
source = page.read_text()
old = '        let client = self.http_client.clone();\n        let page_callbacks = self.callbacks.clone();'
new = '        let client = self.http_client.clone();\n        #[cfg(feature = "stealth")]\n        let stealth_client = self.stealth_client.clone();\n        let page_callbacks = self.callbacks.clone();'
assert source.count(old) == 1
source = source.replace(old, new)
old = '                let client = client.clone();\n                let cbs = page_callbacks.clone();'
new = '                let client = client.clone();\n                #[cfg(feature = "stealth")]\n                let stealth_client = stealth_client.clone();\n                let cbs = page_callbacks.clone();'
assert source.count(old) == 1
source = source.replace(old, new)
old = '''                    match client
                        .fetch_resource_with_callbacks(&parsed, request, Some(&cbs))
                        .await
                    {'''
new = '''                    #[cfg(feature = "stealth")]
                    let response = if let Some(stealth_client) = stealth_client {
                        stealth_client.fetch_resource_with_callbacks(&parsed, request, Some(&cbs)).await
                    } else {
                        client.fetch_resource_with_callbacks(&parsed, request, Some(&cbs)).await
                    };
                    #[cfg(not(feature = "stealth"))]
                    let response = client.fetch_resource_with_callbacks(&parsed, request, Some(&cbs)).await;
                    match response {'''
assert source.count(old) == 1
source = source.replace(old,new)
page.write_text(source)
print('Classic scripts now use the active TLS-stealth resource transport')
