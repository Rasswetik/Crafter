"""Periodic Portals catalogue refresh.

Runs the existing catalogue sync (``start_catalog_refresh``) on a fixed interval
from one daemon thread. Gunicorn is configured with a single worker, so there is
exactly one scheduler per deployment. Disabled when the interval is 0.
"""
import os
import threading
import time

MIN_INTERVAL = 60


def refresh_interval(raw=None):
    """Seconds between refreshes; 0 disables. Values below 60 are raised to 60."""
    value = os.getenv("MARKET_REFRESH_SECONDS", "0") if raw is None else raw
    try:
        seconds = int(str(value).strip() or 0)
    except ValueError:
        return 0
    if seconds <= 0:
        return 0
    return max(MIN_INTERVAL, seconds)


def start_market_refresh(trigger, interval, state=None, sleep=None):
    """Call ``trigger()`` every ``interval`` seconds. Returns a stop Event, or None.

    ``state`` (dict) receives ``interval``, ``last_run`` and ``last_error`` so the
    admin status endpoint can show them. A failing trigger never stops the loop.
    """
    if not interval:
        return None
    state = state if state is not None else {}
    state.update(interval=interval, last_run=0, last_error="")
    stop = threading.Event()
    wait = sleep or stop.wait

    def loop():
        while not stop.is_set():
            try:
                trigger()
                state["last_error"] = ""
            except Exception as error:  # keep scheduling after upstream failures
                state["last_error"] = str(error)[:150]
            state["last_run"] = int(time.time())
            if wait(interval):
                break

    threading.Thread(target=loop, name="market-refresh", daemon=True).start()
    return stop
