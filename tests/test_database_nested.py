"""The PostgreSQL wrapper must survive nested `with db():` blocks (a helper inside a purchase): the inner block is a savepoint, the outer one still closes normally."""
from database import Postgres


class FakeTransaction:
    def __init__(self, log, name):
        self.log, self.name = log, name

    def __enter__(self):
        self.log.append('enter ' + self.name)

    def __exit__(self, exc_type, value, traceback):
        self.log.append('exit ' + self.name + (' error' if exc_type else ''))
        return False


class FakeConnection:
    def __init__(self):
        self.log, self.count = [], 0

    def transaction(self):
        self.count += 1
        return FakeTransaction(self.log, str(self.count))


def make():
    db = Postgres.__new__(Postgres)
    db.pool, db.connection, db.transactions = None, FakeConnection(), []
    return db


def test_nested_blocks_close_in_order():
    db = make()
    with db:
        assert db.transaction is not None
        with db:
            pass
        assert db.transaction is not None          # the outer one is still open
    assert db.transaction is None and db.connection.log == ['enter 1', 'enter 2', 'exit 2', 'exit 1']


def test_an_error_inside_rolls_back_every_level():
    db = make()
    try:
        with db:
            with db:
                raise ValueError('boom')
    except ValueError:
        pass
    assert db.connection.log == ['enter 1', 'enter 2', 'exit 2 error', 'exit 1 error'] and db.transaction is None
