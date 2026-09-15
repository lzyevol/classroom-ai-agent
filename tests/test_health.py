from unittest.mock import patch


def test_health_ok(client):
    with patch("app.api.health.health_check", return_value=True):
        resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["neo4j"] == "connected"


def test_health_neo4j_down(client):
    with patch("app.api.health.health_check", side_effect=Exception("conn refused")):
        resp = client.get("/health")
    assert resp.status_code == 503
    assert "unavailable" in resp.json()["detail"].lower()
