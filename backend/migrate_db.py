import sqlite3
import os

db_path = "/home/maria/project/cyber_arena3/cyber_arena/backend/sql_app.db"

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    columns_to_add = [
        ("job_title", "VARCHAR(100)"),
        ("bio", "VARCHAR(500)"),
        ("location", "VARCHAR(100)"),
        ("profile_pic", "VARCHAR(255)"),
        ("is_2fa_enabled", "BOOLEAN DEFAULT 0"),
        ("totp_secret", "VARCHAR(255)"),
        ("email_otp", "VARCHAR(10)"),
        ("email_otp_expiry", "DATETIME")
    ]
    
    for col_name, col_type in columns_to_add:
        try:
            cursor.execute(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}")
            print(f"Added column {col_name}")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e):
                print(f"Column {col_name} already exists")
            else:
                print(f"Error adding {col_name}: {e}")
                
    conn.commit()
    conn.close()
    print("Migration complete.")
else:
    print("Database not found.")
