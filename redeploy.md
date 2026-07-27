# 🔄 How to Redeploy Future Updates

Whenever you make new code updates locally and want to deploy them to your EC2 instance (`13.232.127.142` / `aisalesagent.analytx4t.com`), follow these simple 2 steps:

---

## Step 1: Commit and Push Changes from Local Machine

In your local terminal / VS Code terminal:

```bash
git add .
git commit -m "Updated features / bug fixes"
git push origin main
```

---

## Step 2: Pull and Restart on EC2 Server

Connect to your EC2 instance:
```bash
ssh -i "C:\Users\hp\Downloads\sales.pem" ubuntu@13.232.127.142
```

Run this 1-line command (or run step-by-step):

```bash
cd /var/www/company-scrapping && git pull origin main && npm run build && sudo systemctl restart salesai-backend && sudo systemctl restart nginx
```

### Detailed Breakdown of Step 2:

1. **Pull Latest Code:**
   ```bash
   cd /var/www/company-scrapping
   git pull origin main
   ```

2. **Rebuild Frontend Bundle:**
   ```bash
   npm run build
   ```

3. **(Optional) Run Backend Database Migrations (if DB models changed):**
   ```bash
   cd /var/www/company-scrapping/backend
   source venv/bin/activate
   alembic upgrade head
   ```

4. **Restart Backend & Nginx Services:**
   ```bash
   sudo systemctl restart salesai-backend
   sudo systemctl restart nginx
   ```

---

## 🔍 Verification Commands

* **Check Backend Status:** `sudo systemctl status salesai-backend`
* **Watch Live Backend Logs:** `sudo journalctl -u salesai-backend -f`
* **Test Health Endpoint:** `curl http://127.0.0.1:8000/health`
