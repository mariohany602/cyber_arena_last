from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional, List

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    # Company name for the user's first organization. Optional for backward
    # compatibility: if omitted, we default to "<username>'s workspace".
    company_name: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    is_active: bool
    created_at: datetime
    # New Profile Fields
    job_title: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    profile_pic: Optional[str] = None
    is_2fa_enabled: bool = False

    class Config:
        from_attributes = True

class PasswordUpdate(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str

class TwoFASetup(BaseModel):
    message: str
    email: str

class TwoFAVerify(BaseModel):
    token: str

class TwoFALogin(BaseModel):
    user_id: int
    token: str

class UserUpdate(BaseModel):
    job_title: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    profile_pic: Optional[str] = None

class MessageCreate(BaseModel):
    recipient_id: int
    content: str

class MessageResponse(BaseModel):
    id: int
    sender_id: int
    recipient_id: int
    content: str
    timestamp: datetime
    is_encrypted: bool

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: Optional[str] = None
    token_type: Optional[str] = None
    require_2fa: bool = False
    user_id: Optional[int] = None

class TwoFALogin(BaseModel):
    user_id: int
    token: str

class TokenData(BaseModel):
    email: Optional[str] = None
