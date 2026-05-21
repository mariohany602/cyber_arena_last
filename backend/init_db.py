#!/usr/bin/env python3
"""
Database initialization script for Cyber Arena
This script creates the database tables using SQLAlchemy
"""

from database import Base, engine
from models import User

def init_db():
    """Initialize the database tables"""
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("✓ Database tables created successfully!")
    print("\nTables created:")
    print("  - users")
    print("\nYou can now start the backend server with:")
    print("  uvicorn main:app --reload --port 8000")

if __name__ == "__main__":
    try:
        init_db()
    except Exception as e:
        print(f"✗ Error creating database: {e}")
        print("\nMake sure:")
        print("  1. MySQL server is running")
        print("  2. Database 'cyber_arena' exists")
        print("  3. Database credentials in database.py are correct")
        print("\nTo create the database, run:")
        print("  mysql -u root -p -e 'CREATE DATABASE cyber_arena;'")
