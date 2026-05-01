# db.py
import re
import mysql.connector
from mysql.connector import Error


DANGEROUS = re.compile(
    r"\b(drop|delete|truncate|alter|update|insert|replace|create|grant|revoke)\b",
    re.IGNORECASE
)

ALLOWED_PREFIX = ("select", "show", "describe", "desc", "explain", "use")


def connect_mysql(host: str, user: str, password: str, database: str | None = None):
    """
    Returns: (conn, error_message_or_None)
    """
    try:
        conn = mysql.connector.connect(
            host=host,
            user=user,
            password=password,
            database=database if database else None,
            autocommit=True
        )
        if conn.is_connected():
            return conn, None
        return None, "Unable to connect (unknown reason)."
    except Error as e:
        return None, str(e)


def close_conn(conn):
    try:
        if conn and conn.is_connected():
            conn.close()
    except Exception:
        pass


def _single_statement(sql: str) -> str:
    # block multi-statement execution
    s = sql.strip().rstrip(";").strip()
    # if still contains ";" inside, it's likely multiple statements
    if ";" in s:
        raise ValueError("Multiple SQL statements are not allowed.")
    return s


def _is_allowed(sql: str) -> bool:
    s = sql.strip().lower()
    return s.startswith(ALLOWED_PREFIX)


def _enforce_select_limit(sql: str, limit: int = 100) -> str:
    s = sql.strip().rstrip(";").strip()
    low = s.lower()
    if low.startswith("select") and " limit " not in low:
        return f"{s} LIMIT {limit}"
    return s


def validate_sql(sql: str) -> str:
    s = _single_statement(sql)

    if not _is_allowed(s):
        raise ValueError("Only SELECT/SHOW/DESCRIBE/EXPLAIN/USE queries are allowed.")

    if DANGEROUS.search(s):
        raise ValueError("Dangerous SQL keywords detected. Query blocked.")

    # Enforce LIMIT for SELECT
    s = _enforce_select_limit(s, limit=100)
    return s


def execute_sql_safe(conn, sql: str) -> dict:
    """
    Executes validated SQL and returns structured output.
    """
    final_sql = validate_sql(sql)

    cursor = conn.cursor()
    cursor.execute(final_sql)

    # USE db has no results
    if final_sql.lower().startswith("use "):
        return {
            "final_sql": final_sql,
            "message": "📌 Database changed.",
            "columns": [],
            "rows": []
        }

    # Some SHOW/DESCRIBE return rows
    rows = cursor.fetchall() if cursor.with_rows else []
    columns = [d[0] for d in cursor.description] if cursor.description else []

    return {
        "final_sql": final_sql,
        "message": f"✅ Returned {len(rows)} row(s).",
        "columns": columns,
        "rows": rows
    }


def get_schema_summary(conn, max_tables: int = 20) -> str:
    """
    Lightweight schema summary for better LLM SQL generation.
    It lists tables + a few columns from each.
    """
    try:
        cur = conn.cursor()
        cur.execute("SHOW TABLES")
        tables = [r[0] for r in cur.fetchall()][:max_tables]

        parts = []
        for t in tables:
            cur.execute(f"DESCRIBE `{t}`")
            cols = [row[0] for row in cur.fetchall()][:10]
            parts.append(f"{t}({', '.join(cols)})")

        if not parts:
            return "No tables found."
        return "Tables:\n- " + "\n- ".join(parts)

    except Exception:
        # If user has no DB selected or permission issue
        return "Schema unavailable (select a database or check permissions)."
