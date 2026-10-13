"""Disposable Android AsyncStorage 2.2 SQLite model: same table and 6 MiB maximum.

No device data or application configuration is read. Each bridge operation uses
real SQLite transactions, INSERT OR REPLACE, and SQLite's own SQLITE_FULL error.
"""
import json
import sqlite3
import sys

connection = sqlite3.connect(sys.argv[1])
connection.execute("PRAGMA page_size=4096")
connection.execute("PRAGMA max_page_count=1536")
connection.execute("CREATE TABLE IF NOT EXISTS catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
with open(sys.argv[2], encoding="utf-8") as request_file:
    request = json.load(request_file)
operation, args = request["operation"], request.get("args", [])
try:
    if operation == "getItem":
        row = connection.execute("SELECT value FROM catalystLocalStorage WHERE key=?", (args[0],)).fetchone()
        result = row[0] if row else None
    elif operation == "setItem":
        connection.execute("INSERT OR REPLACE INTO catalystLocalStorage VALUES (?, ?)", args)
        connection.commit()
        result = None
    elif operation == "getAllKeys":
        result = [row[0] for row in connection.execute("SELECT key FROM catalystLocalStorage")]
    elif operation == "multiGet":
        result = []
        for key in args[0]:
            row = connection.execute("SELECT value FROM catalystLocalStorage WHERE key=?", (key,)).fetchone()
            result.append([key, row[0] if row else None])
    elif operation in ("removeItem", "multiRemove"):
        keys = args if operation == "removeItem" else args[0]
        connection.executemany("DELETE FROM catalystLocalStorage WHERE key=?", [(key,) for key in keys])
        connection.commit()
        result = None
    elif operation == "stats":
        result = {name: connection.execute("PRAGMA " + name).fetchone()[0]
                  for name in ("page_count", "page_size", "max_page_count", "freelist_count")}
    else:
        raise ValueError("Unknown test bridge operation")
    print(json.dumps({"result": result}))
except sqlite3.Error as error:
    connection.rollback()
    print(json.dumps({"error": {"code": error.sqlite_errorname, "message": str(error)}}))
finally:
    connection.close()
