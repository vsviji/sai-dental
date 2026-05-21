# Sai Dental Clinic — Prescription System

A PWA-ready, offline-capable dental prescription management system backed by Firebase Firestore.

---

## 📁 Project Structure

```
sai-dental/
├── index.html          ← Main HTML
├── manifest.json       ← PWA manifest
├── sw.js               ← Service worker (offline + caching)
├── css/
│   └── style.css       ← All styles
├── js/
│   ├── firebase-init.js  ← Firebase (ES module)
│   └── app.js            ← App logic
└── icons/
    ├── icon-192.png    ← PWA icon (192×192)
    ├── icon-512.png    ← PWA icon (512×512)
    └── logo.png        ← YOUR actual clinic logo (add this!)
```

---

## 🖼️ Adding Your Real Clinic Logo

1. Get your clinic logo as a PNG (ideally square, at least 192×192 px)
2. Save it as `icons/logo.png` inside the project folder
3. In `index.html`, find all `<img src="./icons/icon-192.png"` lines and change them to `<img src="./icons/logo.png"`
4. Also update `manifest.json` — change `"src": "./icons/icon-192.png"` to `"src": "./icons/logo.png"` for both entries

---

## 🚀 Deploying to GitHub Pages (Step-by-Step)

### Step 1 — Create a GitHub Account
If you don't have one, go to https://github.com and sign up (free).

### Step 2 — Create a New Repository
1. Click the **+** button (top-right) → **New repository**
2. Name it: `sai-dental` (or anything you like)
3. Set it to **Public** (required for free GitHub Pages)
4. Click **Create repository**

### Step 3 — Upload Your Files
**Option A — Upload via GitHub website (easiest):**
1. Open your new repository
2. Click **Add file** → **Upload files**
3. Drag and drop your entire `sai-dental/` folder contents (all files and folders)
4. Click **Commit changes**

**Option B — Use Git (for developers):**
```bash
cd sai-dental
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/sai-dental.git
git push -u origin main
```

### Step 4 — Enable GitHub Pages
1. Go to your repository on GitHub
2. Click **Settings** (tab at the top)
3. In the left sidebar, click **Pages**
4. Under **Source**, choose **Deploy from a branch**
5. Set branch to **main** and folder to **/ (root)**
6. Click **Save**

### Step 5 — Access Your Live Site
After about 1–2 minutes, your site will be live at:
```
https://YOUR_USERNAME.github.io/sai-dental/
```
GitHub will show the URL in the Pages settings section.

### Step 6 — Add GitHub Pages URL to Firebase
Your Firebase project must allow your GitHub Pages domain:
1. Go to https://console.firebase.google.com
2. Open your project → **Authentication** → **Settings** → **Authorized domains**
3. Click **Add domain** and add: `YOUR_USERNAME.github.io`

---

## 📲 Making It PWA Installable

Your app is already PWA-ready! Once deployed to GitHub Pages (HTTPS is required for PWA):

### On Android (Chrome):
1. Open the site in Chrome
2. A banner will appear at the bottom: **"Add to Home Screen"** — tap Install
3. Or tap the three-dot menu → **Install app** / **Add to Home screen**

### On iOS (Safari):
1. Open the site in Safari
2. Tap the **Share** button (box with arrow)
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add**

### On Desktop (Chrome/Edge):
1. Open the site
2. Look for the install icon (⊕) in the address bar
3. Click it → **Install**

The app will now appear as a standalone app on the device — works offline too!

---

## ✅ PWA Checklist (all done for you)

- [x] `manifest.json` with name, icons, theme colour
- [x] Service worker (`sw.js`) for offline caching
- [x] HTTPS (provided by GitHub Pages automatically)
- [x] Icons at 192×192 and 512×512
- [x] Apple meta tags for iOS
- [x] `theme-color` meta tag

---

## 🔧 Updating the App Later

Whenever you make changes:
1. Edit your files locally
2. Upload updated files to GitHub (same upload process)
3. GitHub Pages auto-deploys within 1–2 minutes

Or with Git:
```bash
git add .
git commit -m "Update prescription templates"
git push
```

---

## 📞 Support
Contact: saisri.dentalcare@gmail.com | +91 8122835737
