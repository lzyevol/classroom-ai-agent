from __future__ import annotations

from neo4j import GraphDatabase, Driver

_driver: Driver | None = None


def init_driver(uri: str, username: str, password: str) -> Driver:
    global _driver
    _driver = GraphDatabase.driver(uri, auth=(username, password))
    _driver.verify_connectivity()
    return _driver


def close_driver() -> None:
    global _driver
    if _driver is not None:
        _driver.close()
        _driver = None


def get_driver() -> Driver:
    if _driver is None:
        raise RuntimeError("Neo4j driver not initialized")
    return _driver


def health_check() -> bool:
    driver = get_driver()
    with driver.session() as session:
        session.run("RETURN 1").consume()
    return True
