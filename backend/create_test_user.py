#!/usr/bin/env python3
"""
Create a test user with known credentials for Cyber Arena
"""
from auth import get_password_hash
from database import SessionLocal
from models import User, Organization, OrgMembership
from tenant import new_enrollment_key, unique_slug

def create_test_user():
    """Create a test user with email test@example.com and password: password123"""
    
    email = "test@example.com"
    username = "testuser"
    password = "password123"
    
    db = SessionLocal()
    try:
        # Check if user already exists
        existing_user = db.query(User).filter(User.email == email).first()
        if existing_user:
            print(f"✓ User already exists: {existing_user.username} ({existing_user.email})")
            print(f"  Resetting password to: {password}")
            existing_user.hashed_password = get_password_hash(password)
            db.commit()
            return True
        
        # Create new user
        new_user = User(
            username=username,
            email=email,
            hashed_password=get_password_hash(password),
            is_active=True
        )
        db.add(new_user)
        db.flush()
        
        # Create organization
        org = Organization(
            name=f"{username}'s workspace",
            slug=unique_slug(db, username),
            plan="free",
            status="active",
            enrollment_key=new_enrollment_key(),
            provisioned=False,
        )
        db.add(org)
        db.flush()
        
        org.wazuh_agent_group = f"arena_org_{org.id}"
        org.thehive_org_name = org.slug
        org.shuffle_tag = f"arena_org_{org.id}"
        
        # Create membership
        db.add(OrgMembership(
            organization_id=org.id,
            user_id=new_user.id,
            role="owner",
        ))
        
        db.commit()
        
        print(f"✓ Test user created successfully!")
        print(f"  Email: {email}")
        print(f"  Password: {password}")
        print(f"  Organization: {org.name}")
        
        return True
        
    except Exception as e:
        db.rollback()
        print(f"✗ Error creating test user: {e}")
        return False
    finally:
        db.close()

if __name__ == "__main__":
    create_test_user()
