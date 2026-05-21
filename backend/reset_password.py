# Utility script to reset user passwords
import sys
import os

# Add the current directory to sys.path to import local modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import SessionLocal
from models import User
from auth import get_password_hash

def reset_password(username, new_password):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            print(f"User '{username}' not found.")
            return
        
        user.hashed_password = get_password_hash(new_password)
        db.commit()
        print(f"Successfully reset password for user '{username}'.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 reset_password.py <username> <new_password>")
    else:
        reset_password(sys.argv[1], sys.argv[2])
