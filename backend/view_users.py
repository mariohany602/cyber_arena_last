from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import User
from database import DATABASE_URL

# Setup database connection
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)
session = SessionLocal()

def view_users():
    print("-" * 50)
    print(f"Connecting to: {DATABASE_URL}")
    print("-" * 50)
    
    users = session.query(User).all()
    
    if not users:
        print("No users found in the database.")
    else:
        print(f"Found {len(users)} user(s):")
        print("-" * 50)
        print(f"{'ID':<5} | {'Username':<20} | {'Email':<30} | {'Active'}")
        print("-" * 50)
        for user in users:
            print(f"{user.id:<5} | {user.username:<20} | {user.email:<30} | {user.is_active}")
    print("-" * 50)

if __name__ == "__main__":
    try:
        view_users()
    except Exception as e:
        print(f"Error accessing database: {e}")
    finally:
        session.close()
