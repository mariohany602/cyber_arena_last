
import os

code_to_append = """

# --- Security Hardening: Password & 2FA ---

@app.put("/api/v1/profile/password", tags=["Security"])
def update_password(
    password_data: PasswordUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    \"\"\"Update operator password with validation\"\"\"
    # 1. Verify current password
    if not verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect current password")
    
    # 2. Check confirmation
    if password_data.new_password != password_data.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    
    # 3. Validate complexity
    password = password_data.new_password
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long")
    if not re.search(r'[A-Z]', password):
        raise HTTPException(status_code=400, detail="Password must contain at least one uppercase letter")
    if not re.search(r'[a-z]', password):
        raise HTTPException(status_code=400, detail="Password must contain at least one lowercase letter")
    if not re.search(r'[0-9]', password):
        raise HTTPException(status_code=400, detail="Password must contain at least one number")
    if not re.search(r'[!@#$%^&*(),.?\\":{}|<>]', password):
        raise HTTPException(status_code=400, detail="Password must contain at least one special character")
    
    # 4. Hash and save
    current_user.hashed_password = get_password_hash(password_data.new_password)
    db.commit()
    
    return {"message": "Credentials updated successfully"}

@app.post("/api/v1/auth/2fa/setup", response_model=TwoFASetup, tags=["Security"])
def setup_2fa(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    \"\"\"Generate TOTP secret for 2FA setup\"\"\"
    secret = pyotp.random_base32()
    # Store it but don't enable until verified
    current_user.totp_secret = secret
    db.commit()
    
    otp_uri = pyotp.totp.TOTP(secret).provisioning_uri(
        name=current_user.email, 
        issuer_name="CyberArena"
    )
    
    return {"secret": secret, "qr_code_uri": otp_uri}

@app.post("/api/v1/auth/2fa/verify", tags=["Security"])
def verify_2fa(
    verify_data: TwoFAVerify,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    \"\"\"Verify first TOTP code to enable 2FA\"\"\"
    if not current_user.totp_secret:
        raise HTTPException(status_code=400, detail="2FA not initiated")
    
    totp = pyotp.TOTP(current_user.totp_secret)
    if not totp.verify(verify_data.token):
        raise HTTPException(status_code=400, detail="Invalid verification code")
    
    current_user.is_2fa_enabled = True
    db.commit()
    
    return {"message": "Two-factor authentication enabled"}

@app.post("/api/v1/auth/2fa/disable", tags=["Security"])
def disable_2fa(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    \"\"\"Disable 2FA for the operator\"\"\"
    current_user.is_2fa_enabled = False
    current_user.totp_secret = None
    db.commit()
    return {"message": "Two-factor authentication disabled"}

@app.post("/api/auth/2fa/login", response_model=Token, tags=["Authentication"])
def login_2fa(
    login_data: TwoFALogin,
    db: Session = Depends(get_db)
):
    \"\"\"Complete 2FA login flow\"\"\"
    user = db.query(User).filter(User.id == login_data.user_id).first()
    if not user or not user.is_2fa_enabled or not user.totp_secret:
        raise HTTPException(status_code=401, detail="Invalid login session")
    
    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(login_data.token):
        raise HTTPException(status_code=401, detail="Invalid 2FA token")
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "require_2fa": False, "user_id": user.id}
"""

with open("/home/maria/project/cyber_arena3/cyber_arena/backend/main.py", "a") as f:
    f.write(code_to_append)
print("Security endpoints appended successfully.")
