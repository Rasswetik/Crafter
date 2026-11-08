import threading

from market_refresh import MIN_INTERVAL, refresh_interval, start_market_refresh


def test_interval_parsing():
    assert refresh_interval("") == 0
    assert refresh_interval("0") == 0
    assert refresh_interval("abc") == 0
    assert refresh_interval("-5") == 0
    assert refresh_interval("10") == MIN_INTERVAL
    assert refresh_interval("300") == 300


def test_disabled_without_interval():
    assert start_market_refresh(lambda: None, 0) is None


def test_scheduler_survives_failures_and_records_state():
    calls = []
    done = threading.Event()

    def trigger():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("upstream down")
        if len(calls) >= 3:
            done.set()

    state = {}
    # sleep stub: never blocks, returns True (stop) once the third call ran
    start_market_refresh(trigger, 60, state, sleep=lambda _s: done.is_set())
    assert done.wait(5)
    assert len(calls) >= 3
    assert state["interval"] == 60
    assert state["last_run"] > 0
    assert state["last_error"] == ""
