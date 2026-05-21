# Cyber Arena - Authentication Setup Guide

## Quick Start

### 1. Database Setup

**Option A: Using MySQL Command Line**
```bash
# Create the database
mysql -u root -p -e "CREATE DATABASE cyber_arena;"

# Or run the SQL script
mysql -u root -p < backend/setup_db.sql
```

**Option B: Using Python Script**
```bash
cd backend
python3 init_db.py
```

### 2. Configure Database Connection

Edit `backend/database.py` and update the connection string with your MySQL credentials:
```python
DATABASE_URL = "mysql+pymysql://YOUR_USER:YOUR_PASSWORD@localhost:3306/cyber_arena"
```

Or set an environment variable:
```bash
export DATABASE_URL="mysql+pymysql://YOUR_USER:YOUR_PASSWORD@localhost:3306/cyber_arena"
```

### 3. Start the Backend

```bash
cd backend
uvicorn main:app --reload --port 8000
```

The backend will be available at: http://localhost:8000

### 4. Start the Frontend

```bash
cd frontend
npm run dev
```

The frontend will be available at: http://localhost:5173

## Testing the Authentication

### 1. Sign Up
- Navigate to http://localhost:5173/signup
- Create a new account with:
  - Username (min 3 characters)
  - Email (valid format)
  - Password (min 6 characters)
  - Confirm password

### 2. Login
- Navigate to http://localhost:5173/login
- Enter your email and password
- You'll be redirected to the dashboard

### 3. Protected Routes
- Try accessing http://localhost:5173/ without logging in
- You should be redirected to the login page
- After logging in, you can access all routes

### 4. Logout
- Click the "Logout" button in the sidebar
- You'll be redirected to the login page
- Token will be removed from localStorage

## API Endpoints

- `POST /api/auth/signup` - Register a new user
- `POST /api/auth/login` - Login and get JWT token
- `GET /api/auth/me` - Get current user info (requires authentication)

## Troubleshooting

### Database Connection Error
- Make sure MySQL is running: `sudo systemctl status mysql`
- Check credentials in `database.py`
- Verify database exists: `mysql -u root -p -e "SHOW DATABASES;"`

### Port Already in Use
- Backend: Change port in uvicorn command: `uvicorn main:app --reload --port 8001`
- Frontend: Vite will automatically use next available port

### CORS Errors
- Make sure backend is running on port 8000
- Check CORS settings in `backend/main.py`

## Security Notes

⚠️ **Before deploying to production:**
- Change `SECRET_KEY` in `backend/auth.py`
- Use environment variables for sensitive data
- Consider using httpOnly cookies instead of localStorage
- Enable HTTPS
- Use a production-grade database (not default MySQL settings)
- Implement rate limiting for auth endpoints
