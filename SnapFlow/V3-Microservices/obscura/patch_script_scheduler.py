"""Repair locked classic-script scheduling without extending its page deadline.

Fetches remain bounded and concurrent. Parser-blocking and defer scripts wait
for their own response; async responses run when ready after their encounter,
and wait for load only after DOMContentLoaded has been dispatched.
"""
from pathlib import Path
import sys

page = Path(sys.argv[1]) / 'crates/obscura-browser/src/page.rs'
source = page.read_text()

def replace(old, new, expected=1):
    global source
    if source.count(old) != expected:
        raise RuntimeError(f'Scheduler source drift: expected {expected} occurrences of {old[:90]!r}')
    source = source.replace(old, new)

# Preserve failed fetch identities as well as successful responses. A failed
# boot request must not cause us to wait for unrelated slow async requests.
replace('return Some((idx, url, resp));', 'return (idx, url, Some(resp));')
replace('Ok(resp) => Some((idx, url, resp)),', 'Ok(resp) => (idx, url, Some(resp)),')
replace('''                            tracing::warn!("Failed to fetch script {}: {}", url, e);
                            None''', '''                            tracing::warn!("Failed to fetch script {}: {}", url, e);
                            (idx, url, None)''')
replace('''        let client = self.http_client.clone();
        #[cfg(feature = "stealth")]
        let stealth_client = self.stealth_client.clone();''', '''        // Prioritize parse/defer dependencies within the same bounded fetch pool.
        fetch_tasks.sort_by_key(|(index, _)| all_scripts[*index].is_async);
        let client = self.http_client.clone();
        #[cfg(feature = "stealth")]
        let stealth_client = self.stealth_client.clone();''')

begin = source.index('        use futures::StreamExt as _;\n        let fetch_stream =', source.index('async fn execute_scripts_with_module_budget'))
end = source.index('        // Spec: readyState is "loading"', begin)
source = source[:begin] + '''        use futures::{StreamExt as _, FutureExt as _};
        let mut fetch_stream = futures::stream::iter(fetch_futures).buffer_unordered(16);
        let mut pending: std::collections::HashSet<usize> = fetch_tasks.iter().map(|(index, _)| *index).collect();
        let mut fetched: std::collections::HashMap<usize, (String, String, obscura_net::Response)> = std::collections::HashMap::new();
        let mut ready_async: std::collections::VecDeque<usize> = std::collections::VecDeque::new();
        let mut encountered_async: std::collections::HashSet<usize> = std::collections::HashSet::new();
        let record_fetch = |page: &mut Self,
                            pending: &mut std::collections::HashSet<usize>,
                            fetched: &mut std::collections::HashMap<usize, (String, String, obscura_net::Response)>,
                            ready_async: &mut std::collections::VecDeque<usize>,
                            (index, url, response): (usize, String, Option<obscura_net::Response>)| {
            pending.remove(&index);
            if let Some(response) = response {
                if !script_response_is_executable(response.status) {
                    page.record_network_event_with_body(&url, "GET", "Script", response.status,
                        &response.headers, &response.body, false);
                    tracing::warn!("Refusing to execute script {} after HTTP {}", url, response.status);
                    return;
                }
                let code = obscura_net::decode_non_html(&response.body, response.content_type());
                fetched.insert(index, (url, code, response));
                if all_scripts[index].is_async {
                    ready_async.push_back(index);
                }
            }
        };

''' + source[end:]

replace('''        let mut post_parse = Vec::new();''', '''        let execute_ready_async = |page: &mut Self,
                                   fetched: &mut std::collections::HashMap<usize, (String, String, obscura_net::Response)>,
                                   ready_async: &mut std::collections::VecDeque<usize>,
                                   encountered_async: &std::collections::HashSet<usize>| {
            for _ in 0..ready_async.len() {
                let index = ready_async.pop_front().unwrap();
                if encountered_async.contains(&index) {
                    execute_classic(page, &all_scripts[index], fetched.remove(&index));
                } else {
                    ready_async.push_back(index);
                }
            }
        };
        let mut post_parse = Vec::new();''')

drain = '''            while let Some(Some(result)) = fetch_stream.next().now_or_never() {
                record_fetch(self, &mut pending, &mut fetched, &mut ready_async, result);
            }
            execute_ready_async(self, &mut fetched, &mut ready_async, &encountered_async);
'''
replace('''        for (index, script) in all_scripts.iter().enumerate() {
            if tokio::time::Instant::now() >= script_deadline {''', '''        for (index, script) in all_scripts.iter().enumerate() {
''' + drain + '''            if tokio::time::Instant::now() >= script_deadline {''')

wait = '''                        while pending.contains(&index) {
                            match tokio::time::timeout_at(script_deadline, fetch_stream.next()).await {
                                Ok(Some(result)) => {
                                    record_fetch(self, &mut pending, &mut fetched, &mut ready_async, result);
                                    execute_ready_async(self, &mut fetched, &mut ready_async, &encountered_async);
                                }
                                _ => break,
                            }
                        }
'''
replace('''                    if script.is_defer && !script.is_async && script.src.is_some() {
                        post_parse.push(ScheduledScript::Classic(index));
                    } else {
                        let fetched_script = fetched.remove(&index);''', '''                    if script.is_async && script.src.is_some() {
                        encountered_async.insert(index);
                        execute_ready_async(self, &mut fetched, &mut ready_async, &encountered_async);
                    } else if script.is_defer && script.src.is_some() {
                        post_parse.push(ScheduledScript::Classic(index));
                    } else {
''' + wait + '''                        let fetched_script = fetched.remove(&index);''')
replace('''                ScheduledScript::Classic(index) => {
                    let script = &all_scripts[index];
                    let fetched_script = fetched.remove(&index);''', '''                ScheduledScript::Classic(index) => {
                    let script = &all_scripts[index];
''' + wait + '''                    let fetched_script = fetched.remove(&index);''')

replace('''            let load_blockers_finished =
                Self::drive_load_delaying_scripts(js, script_deadline).await;''', '''        }

        // Async classic scripts delay load, never parser/defer execution or DCL.
''' + drain + '''        while pending.iter().any(|index| encountered_async.contains(index)) {
            match tokio::time::timeout_at(script_deadline, fetch_stream.next()).await {
                Ok(Some(result)) => {
                    record_fetch(self, &mut pending, &mut fetched, &mut ready_async, result);
                    execute_ready_async(self, &mut fetched, &mut ready_async, &encountered_async);
                }
                _ => break,
            }
        }
        // Dropping the stream cancels unfinished fetches at the existing deadline.
        drop(fetch_stream);

        if let Some(js) = &mut self.js {
            let load_blockers_finished =
                Self::drive_load_delaying_scripts(js, script_deadline).await;''')
page.write_text(source)
print('Applied response-preserving, parser/defer/async classic-script scheduling')
