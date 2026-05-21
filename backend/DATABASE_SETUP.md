# Cyber Arena - Database Setup

## MySQL Database Configuration

### Prerequisites
- MySQL Server installed and running
- MySQL credentials (username and password)

### Setup Steps

1. **Create the database and tables**:
   ```bash
   mysql -u root -p < setup_db.sql
   ```

2. **Configure database connection**:
   
   The default connection string in `database.py` is:
   ```
   mysql+pymysql://root:password@localhost:3306/cyber_arena
   ```

   To use a different configuration, set the `DATABASE_URL` environment variable:
   ```bash
   export DATABASE_URL="mysql+pymysql://your_user:your_password@localhost:3306/cyber_arena"
   ```

3. **Install Python dependencies**:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

4. **Run the backend server**:
   ```bash
   cd backend
   uvicorn main:app --reload --port 8000
   ```

   The database tables will be created automatically on first run.

### Environment Variables

You can create a `.env` file in the backend directory with:
```
DATABASE_URL=mysql+pymysql://your_user:your_password@localhost:3306/cyber_arena
SECRET_KEY=your-secret-key-change-this-in-production
```

### Security Notes

- Change the `SECRET_KEY` in `auth.py` for production
- Use strong MySQL credentials
- Consider using environment variables for sensitive data
- For production, use a more secure token storage method than localStorage
