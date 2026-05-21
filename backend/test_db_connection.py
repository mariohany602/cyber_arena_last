
import sys
from sqlalchemy import create_engine, text
from database import DATABASE_URL

try:
    print(f"Testing connection to: {DATABASE_URL}")
    engine = create_engine(DATABASE_URL)
    with engine.connect() as connection:
        result = connection.execute(text("SELECT 1"))
        print("\n✅ Database connection successful!")
except Exception as e:
    print(f"\n❌ Database connection failed: {e}")
    sys.exit(1)
