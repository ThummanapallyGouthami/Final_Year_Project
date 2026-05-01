# app.py
import os
import uuid
from flask import Flask, render_template, request, jsonify, session
from dotenv import load_dotenv

from db import connect_mysql, close_conn, execute_sql_safe, get_schema_summary
from llm import nl_to_sql, wants_chart

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me")

# In-memory connection store (simple)
# NOTE: In production, use Redis or server-side session storage.
CONNECTIONS = {}  # session_id -> mysql connection


def _session_id() -> str:
    if "sid" not in session:
        session["sid"] = uuid.uuid4().hex
    return session["sid"]


def _get_conn():
    sid = _session_id()
    return CONNECTIONS.get(sid)


def _set_conn(conn):
    sid = _session_id()
    # close old conn if exists
    old = CONNECTIONS.get(sid)
    if old:
        close_conn(old)
    CONNECTIONS[sid] = conn


def _clear_conn():
    sid = _session_id()
    conn = CONNECTIONS.pop(sid, None)
    if conn:
        close_conn(conn)


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/connect")
def api_connect():
    data = request.get_json(force=True)
    host = (data.get("host") or "").strip()
    user = (data.get("user") or "").strip()
    password = data.get("password") or ""
    database = (data.get("database") or "").strip() or None

    if not host or not user:
        return jsonify({"ok": False, "error": "Host and Username are required."}), 400

    conn, err = connect_mysql(host=host, user=user, password=password, database=database)
    if err:
        return jsonify({"ok": False, "error": err}), 400

    _set_conn(conn)
    return jsonify({"ok": True, "message": "✅ MySQL connection successful"})


@app.post("/api/disconnect")
def api_disconnect():
    _clear_conn()
    return jsonify({"ok": True, "message": "Disconnected"})


@app.post("/api/chat")
def api_chat():
    conn = _get_conn()
    if not conn:
        return jsonify({"ok": False, "error": "Not connected to MySQL. Please connect first."}), 400

    data = request.get_json(force=True)
    user_text = (data.get("message") or "").strip()
    if not user_text:
        return jsonify({"ok": False, "error": "Message is required."}), 400

    # Optional: provide schema summary to improve SQL generation (helps Gemini)
    schema_hint = get_schema_summary(conn, max_tables=20)

    try:
        sql = nl_to_sql(user_text=user_text, schema_hint=schema_hint)
    except Exception as e:
        return jsonify({"ok": False, "error": f"LLM error: {e}"}), 500

    # Execute SQL safely
    try:
        result = execute_sql_safe(conn, sql)
    except Exception as e:
        return jsonify({
            "ok": True,
            "user_message": user_text,
            "sql": sql,
            "assistant": "❌ SQL execution failed. Try rephrasing or use a simpler request.",
            "error": str(e),
            "columns": [],
            "rows": [],
            "chart": None
        }), 200

    chart = None
    if wants_chart(user_text) and result.get("columns") and result.get("rows"):
        # Basic chart suggestion (frontend can render using Chart.js or similar)
        cols = result["columns"]
        chart = {
            "type": "bar",
            "x": cols[0],
            "y": cols[1] if len(cols) > 1 else cols[0],
            "note": "Suggested chart. If data types mismatch, choose different columns."
        }

    return jsonify({
        "ok": True,
        "user_message": user_text,
        "sql": result.get("final_sql", sql),
        "assistant": result.get("message", "Done."),
        "columns": result.get("columns", []),
        "rows": result.get("rows", []),
        "chart": chart
    })


if __name__ == "__main__":
    app.run(debug=True)
