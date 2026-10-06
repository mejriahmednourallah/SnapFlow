"""Opt-in, scan-scoped content routing. Measurements remain Chromium-owned."""
import asyncio
from collections import OrderedDict, deque
import time
from urllib.parse import urlparse


class AcquisitionRouter:
    def __init__(self):
        self.origins = OrderedDict()

    def state(self, scan_id, url):
        now = time.monotonic()
        expired = [key for key, value in self.origins.items() if now-value['updated'] > 1200]
        for key in expired:
            self.origins.pop(key)
        key = (scan_id, urlparse(url).netloc.lower())
        if key not in self.origins:
            while len(self.origins) >= 1024:
                self.origins.popitem(last=False)
            self.origins[key] = dict(updated=now, outcomes=deque(maxlen=5), probes=asyncio.Semaphore(2))
        state = self.origins[key]
        state['updated'] = now
        self.origins.move_to_end(key)
        return state

    @staticmethod
    def bypass(state):
        return sum(not success for _url, success in state['outcomes']) >= 3

    @staticmethod
    def record(state, url, success):
        # Origin policy counts distinct URLs, not both attempts of one URL.
        previous = [(u, ok) for u, ok in state['outcomes'] if u != url]
        state['outcomes'].clear()
        state['outcomes'].extend(previous + [(url, success)])

    async def acquire(self, scan_id, url, budget_ms, fetch):
        """fetch(engine, timeout_ms) includes slot wait, acquisition and cleanup."""
        state = self.state(scan_id, url)
        started = time.monotonic()
        deadline = started + budget_ms/1000
        attempts = []

        async def attempt(engine, allowance):
            remaining = max(1, int((deadline-time.monotonic())*1000))
            allowance = min(allowance, remaining)
            began = time.monotonic()
            result = await fetch(engine, allowance)
            attempts.append(dict(engine=engine, status=str(getattr(result.status, 'value', result.status)),
                                 elapsed_ms=round((time.monotonic()-began)*1000),
                                 error=result.error, final_url=result.final_url,
                                 rendered_html=result.rendered_html,
                                 visible_text=result.visible_text,
                                 navigation_status=result.navigation_status))
            return result

        result = None
        # Waiting for another probe consumes the same page budget.
        try:
            await asyncio.wait_for(state['probes'].acquire(), max(.001,(deadline-time.monotonic())))
        except asyncio.TimeoutError:
            return None, attempts
        try:
            if not self.bypass(state):
                for _ in range(2):
                    if deadline-time.monotonic() < .5:
                        break
                    result = await attempt('obscura', max(500,int(budget_ms*.22)))
                    usable = (str(getattr(result.status, 'value', result.status)) == 'success'
                              and bool((result.rendered_html or '').strip())
                              and bool((result.visible_text or '').strip()))
                    if usable:
                        self.record(state, url, True)
                        return result, attempts
                    # Unsupported/unavailable engines and perimeter rejection
                    # are deterministic; a fresh-context repeat cannot fix them.
                    error = (result.error or '').lower()
                    if any(token in error for token in ['unsupported','not supported','connection refused','not started','outside_allowed']):
                        break
                self.record(state, url, False)
        finally:
            state['probes'].release()
        if deadline-time.monotonic() >= .1:
            result = await attempt('chromium', max(1,int((deadline-time.monotonic())*1000)))
        return result, attempts
