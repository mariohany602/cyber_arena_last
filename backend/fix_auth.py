import sqlite3
import os
import sys

# Ensure we can import from the venv site-packages
venv_path = os.path.join(os.getcwd(), 'venv', 'lib', 'python3.10', 'site-packages')
sys.path.append(venv_path)

from passlib.context import CryptContext

def fix_auth():
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    
    # Target credentials
    target_email = "test@gmail.com"
    target_pass = "admin123"
    target_hash = pwd_context.hash(target_pass)
    
    db_path = "sql_app.db"
    if not os.path.exists(db_path):
        print(f"Error: {db_path} not found.")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # 1. Update existing 'test' user
    cursor.execute("UPDATE users SET hashed_password = ? WHERE email = ?", (target_hash, target_email))
    if cursor.rowcount > 0:
        print(f"✓ Password for {target_email} has been reset to '{target_pass}'.")
    else:
        # If test user doesn't exist, create it
        cursor.execute(
            "INSERT INTO users (username, email, hashed_password) VALUES (?, ?, ?)",
            ("test", target_email, target_hash)
        )
        print(f"✓ Created user {target_email} with password '{target_pass}'.")

    # 2. Add an explicit admin account
    admin_email = "admin@cyberarena.com"
    cursor.execute("SELECT id FROM users WHERE email = ?", (admin_email,))
    if not cursor.fetchone():
        cursor.execute(
            "INSERT INTO users (username, email, hashed_password) VALUES (?, ?, ?)",
            ("admin", admin_email, target_hash)
        )
        print(f"✓ Created admin user {admin_email} with password '{target_pass}'.")

    conn.commit()
    conn.close()
    print("\nAuth fix complete. Try logging in now.")

if __name__ == "__main__":
    fix_auth()
