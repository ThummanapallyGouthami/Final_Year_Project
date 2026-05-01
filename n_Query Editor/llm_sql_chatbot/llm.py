# llm.py
import os
import re
import google.generativeai as genai

# Read key from environment (recommended)
# Put in .env: GOOGLE_API_KEY="YOUR_KEY"
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "").strip()
if not GOOGLE_API_KEY:
    # Don't crash app import; raise when used
    pass
else:
    genai.configure(api_key=GOOGLE_API_KEY)

MODEL_NAME = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")


def wants_chart(user_text: str) -> bool:
    t = user_text.lower()
    return any(k in t for k in ["graph", "chart", "plot", "bar", "line", "pie", "visual"])


def nl_to_sql(user_text: str, schema_hint: str = "") -> str:
    if not GOOGLE_API_KEY:
        raise RuntimeError("GOOGLE_API_KEY not set. Add it to .env or environment variables.")

    model = genai.GenerativeModel(
        model_name=MODEL_NAME,
        generation_config={
            "temperature": 0.0,
            "max_output_tokens": 256
        }
    )

    prompt = f"""
You are an expert MySQL SQL generator.

Rules:
- Output ONLY valid MySQL SQL
- No explanation
- No markdown
- Only ONE SQL statement
- Prefer SELECT/SHOW/DESCRIBE/EXPLAIN/USE
- If user asks destructive actions, convert to safe SELECT alternative
- If table/column unknown, use SHOW TABLES or DESCRIBE <table>

Database schema (if available):
{schema_hint}

User Request:
{user_text}
""".strip()

    resp = model.generate_content(prompt)
    sql = (resp.text or "").strip()

    # Clean common formatting artifacts (just in case)
    sql = re.sub(r"^```sql\s*|\s*```$", "", sql, flags=re.IGNORECASE).strip()
    sql = sql.replace("\n", " ").strip()

    return sql
