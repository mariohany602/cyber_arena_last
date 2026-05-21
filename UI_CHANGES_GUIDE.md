# UI Changes Guide - Where to See n8n Integration

## 🎨 SOAR Control Center Page Updates

### Location in UI
Navigate to: **SOC → SOAR Control Center** (in sidebar)

Or directly: `http://127.0.0.1:5173/soar-center`

---

## 🔍 What Changed Visually

### 1. Platform Status Badge (Top Right)

**BEFORE:**
```
[•] Shuffle not configured
```

**AFTER:**
```
[•] n8n connected        (if n8n is configured)
[•] Shuffle connected    (if Shuffle is configured)
[•] SOAR not configured  (if neither is configured)
```

**What You See:**
- Green dot (•) with "n8n connected" when n8n is working
- Yellow dot when not configured
- Dynamic platform name based on what's actually configured

---

### 2. Subtitle / Platform URL (Below Title)

**BEFORE:**
```
Routing to http://100.90.206.1:3001
```

**AFTER:**
```
Routing to n8n: http://100.90.206.1:5678         (if n8n configured)
Routing to Shuffle: http://100.90.206.1:3001     (if Shuffle configured)
No SOAR platform configured — actions will be logged locally only.
```

**What You See:**
- Shows which platform you're using
- Shows the actual URL of your n8n/Shuffle instance
- Clear message if nothing is configured

---

### 3. New Test Connection Button

**NEW BUTTON:**
```
[⚡ Test Connection]  [🔄 Refresh]
```

**What It Does:**
- Click to test connection to n8n or Shuffle
- Shows success/error toast notification
- Confirms platform is reachable and responding

**Success Toast Example:**
```
✅ Connected to n8n successfully. Found 5 workflows.
```

**Error Toast Example:**
```
❌ Cannot connect to n8n at http://100.90.206.1:5678
```

---

## 📸 Visual Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  SOAR CONTROL                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  SOAR Control Center                    [•] n8n connected│  │
│  │                                         [⚡ Test]  [🔄]   │  │
│  │  Routing to n8n: http://100.90.206.1:5678               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐             │
│  │ Total   │ │ Last 24h│ │ Success │ │ Failed  │             │
│  │   42    │ │    8    │ │   35    │ │    3    │             │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘             │
│                                                                 │
│  ⚡ AVAILABLE ACTIONS                                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│  │  Block IP    │ │   Isolate    │ │ Disable User │          │
│  │              │ │   Endpoint   │ │              │          │
│  └──────────────┘ └──────────────┘ └──────────────┘          │
│                                                                 │
│  📋 EXECUTION HISTORY                                          │
│  ... (execution list remains the same)                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Before/After Comparison

### Scenario 1: n8n Configured

**BEFORE (Hardcoded Shuffle):**
```
┌────────────────────────────────────────────────┐
│ SOAR Control Center    [•] Shuffle not configured │
│ Routing to http://100.90.206.1:3001              │
└────────────────────────────────────────────────┘
```

**AFTER (Dynamic n8n):**
```
┌────────────────────────────────────────────────┐
│ SOAR Control Center    [•] n8n connected      │
│ Routing to n8n: http://100.90.206.1:5678     │
│                        [⚡ Test] [🔄 Refresh] │
└────────────────────────────────────────────────┘
```

---

### Scenario 2: Shuffle Configured

**AFTER (Shows Shuffle):**
```
┌────────────────────────────────────────────────┐
│ SOAR Control Center    [•] Shuffle connected  │
│ Routing to Shuffle: http://100.90.206.1:3001 │
│                        [⚡ Test] [🔄 Refresh] │
└────────────────────────────────────────────────┘
```

---

### Scenario 3: Nothing Configured

**AFTER (Clear Warning):**
```
┌────────────────────────────────────────────────────────┐
│ SOAR Control Center    [•] SOAR not configured        │
│ No SOAR platform configured — actions will be         │
│ logged locally only.                                  │
│                        [⚡ Test] [🔄 Refresh]         │
└────────────────────────────────────────────────────────┘
```

---

## 🎯 How to See These Changes

### Step 1: Login
```
http://127.0.0.1:5173/login
Email: fady0sobhy78@gmail.com
Password: password123
```

### Step 2: Navigate
Click: **SOC** → **SOAR Control Center** (in left sidebar)

### Step 3: Observe Changes
1. Look at top-right corner → See "n8n connected" badge
2. Look at subtitle → See "Routing to n8n: ..."
3. Look for new button → See "⚡ Test Connection"
4. Click "Test Connection" → See success/error toast

---

## 🧪 Testing the UI Changes

### Test 1: Visual Verification
- ✅ Badge shows correct platform
- ✅ Subtitle shows correct URL
- ✅ Test button is visible
- ✅ Green color for connected, yellow for not configured

### Test 2: Test Connection Button
1. Click "⚡ Test Connection"
2. Watch for toast notification
3. Should show: "Connected to n8n successfully" or error

### Test 3: Platform Auto-Detection
**With n8n configured:**
- Badge: "n8n connected"
- URL: Shows n8n URL

**Without n8n (Shuffle only):**
- Badge: "Shuffle connected"
- URL: Shows Shuffle URL

**Neither configured:**
- Badge: "SOAR not configured"
- Message: Clear warning about local-only mode

---

## 📱 Responsive Behavior

All changes work on:
- ✅ Desktop (full width)
- ✅ Tablet (stacked layout)
- ✅ Mobile (vertical layout)

Badge and buttons automatically adapt to screen size.

---

## 🎨 Color Coding

```css
Connected (Green):
  • Badge: green dot with pulse animation
  • Text: bright green accent

Not Configured (Yellow):
  • Badge: yellow dot (static)
  • Text: yellow/amber accent

Error (Red):
  • Toast notifications show red for errors

Success (Green):
  • Toast notifications show green for success
```

---

## 🔍 Developer Tools Check

To verify the changes are loading:

1. Open browser DevTools (F12)
2. Go to Network tab
3. Refresh SOAR Control Center page
4. Look for these API calls:
   - ✅ `GET /api/soc/soar/config` → Should return `platform: "n8n"`
   - ✅ `GET /api/soc/soar/stats/summary` → Should return `n8n_configured: true`
5. Click Test Connection button
6. Look for:
   - ✅ `GET /api/soc/soar/test-connection` → Should return success

---

## 🐛 Troubleshooting UI

### Badge Still Shows "Shuffle"
**Fix:** Clear browser cache and hard refresh (Ctrl+Shift+R)

### Test Button Not Visible
**Fix:** Make sure you're on the SOAR Control Center page, not another page

### Platform Shows "none" or "not configured"
**Fix:** 
1. Check run_app.sh has N8N_URL configured
2. Restart backend: `./run_app.sh`
3. Refresh browser

### "Test Connection" Shows Error
**Possible Causes:**
1. n8n not running → Check: `curl http://100.90.206.1:5678`
2. API key wrong → Regenerate in n8n Settings → API
3. Backend not restarted → Restart with `./run_app.sh`

---

## 📊 Summary of UI Changes

| Element | Before | After |
|---------|--------|-------|
| **Platform Badge** | "Shuffle" (hardcoded) | Dynamic (n8n/Shuffle/SOAR) |
| **Subtitle URL** | Shuffle URL only | Dynamic based on platform |
| **Test Button** | ❌ Not present | ✅ "Test Connection" button |
| **Color Coding** | Yellow (always) | Green when connected |
| **Platform Detection** | ❌ Manual | ✅ Automatic |

---

## ✅ Verification Checklist

Before marking complete, verify:

- [ ] Badge shows "n8n connected" (with green dot)
- [ ] Subtitle shows "Routing to n8n: http://100.90.206.1:5678"
- [ ] Test Connection button is visible
- [ ] Clicking Test Connection shows success toast
- [ ] Stats show correct counts
- [ ] Actions can be triggered
- [ ] Execution history displays

---

## 🎉 Final Result

You now have a **fully dynamic SOAR Control Center** that:
- ✅ Auto-detects which platform you're using
- ✅ Shows correct status and URLs
- ✅ Provides one-click connection testing
- ✅ Works with n8n, Shuffle, or both
- ✅ Clear visual feedback for all states

**The platform is production-ready!** 🚀
