from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import time
from pathlib import Path

from neo4j import GraphDatabase

SOURCE_ID = "book_embodied_ai_intro_2024"
INPUT_FILES = (
    Path("data/processed/kg_entities.jsonl"),
    Path("data/processed/kg_relations.jsonl"),
    Path("data/processed/kg_section_links.jsonl"),
    Path("data/processed/chunks.jsonl"),
    Path("config/kg_ontology.json"),
)


def fingerprint() -> str:
    missing_files = [str(path) for path in INPUT_FILES if not path.is_file()]
    if missing_files:
        raise FileNotFoundError(
            "Neo4j import input files are missing: " + ", ".join(missing_files)
        )

    digest = hashlib.sha256()
    for path in INPUT_FILES:
        digest.update(path.name.encode("utf-8"))
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def wait_for_neo4j(uri: str, username: str, password: str, database: str) -> None:
    for attempt in range(1, 61):
        try:
            driver = GraphDatabase.driver(uri, auth=(username, password))
            driver.verify_connectivity()
            with driver.session(database=database) as session:
                session.run("RETURN 1").consume()
            driver.close()
            return
        except Exception as exc:
            if attempt == 60:
                raise RuntimeError("Neo4j did not become ready in time") from exc
            time.sleep(2)


def graph_is_current(uri: str, username: str, password: str, database: str, current: str) -> bool:
    driver = GraphDatabase.driver(uri, auth=(username, password))
    try:
        with driver.session(database=database) as session:
            record = session.run(
                "MATCH (m:GraphImport {source_id: $source_id}) "
                "OPTIONAL MATCH (e:KnowledgeEntity {source_id: $source_id}) "
                "RETURN m.fingerprint AS fingerprint, count(e) AS entity_count",
                source_id=SOURCE_ID,
            ).single()
            return (
                record is not None
                and record["fingerprint"] == current
                and record["entity_count"] > 0
            )
    finally:
        driver.close()


def clear_source_graph(uri: str, username: str, password: str, database: str) -> None:
    driver = GraphDatabase.driver(uri, auth=(username, password))
    try:
        with driver.session(database=database) as session:
            session.run(
                "MATCH ()-[r]->() WHERE r.source_id = $source_id DELETE r",
                source_id=SOURCE_ID,
            ).consume()
            session.run(
                "MATCH (n) WHERE n.source_id = $source_id DETACH DELETE n",
                source_id=SOURCE_ID,
            ).consume()
    finally:
        driver.close()


def mark_import(uri: str, username: str, password: str, database: str, current: str) -> None:
    driver = GraphDatabase.driver(uri, auth=(username, password))
    try:
        with driver.session(database=database) as session:
            session.run(
                "MERGE (m:GraphImport {source_id: $source_id}) "
                "SET m.fingerprint = $fingerprint, m.updated_at = datetime()",
                source_id=SOURCE_ID,
                fingerprint=current,
            ).consume()
    finally:
        driver.close()


def main() -> None:
    uri = os.environ["NEO4J_URI"]
    username = os.environ.get("NEO4J_USERNAME", "neo4j")
    password = os.environ["NEO4J_PASSWORD"]
    database = os.environ.get("NEO4J_DATABASE", "neo4j")
    current = fingerprint()

    wait_for_neo4j(uri, username, password, database)
    if graph_is_current(uri, username, password, database, current):
        print("Neo4j graph is already current; skipping import.")
        return

    print("Neo4j graph is missing or outdated; replacing the managed source graph...")
    clear_source_graph(uri, username, password, database)
    print("Importing Neo4j graph data...")
    subprocess.run(
        [
            sys.executable,
            "scripts/10_import_neo4j.py",
            "--uri",
            uri,
            "--username",
            username,
            "--database",
            database,
        ],
        check=True,
    )
    mark_import(uri, username, password, database, current)
    print("Neo4j graph import completed.")


if __name__ == "__main__":
    main()
