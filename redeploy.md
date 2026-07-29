# 🔄 How to Redeploy Updates on EC2

Whenever you push new changes to GitHub (`https://github.com/priyanshu442004/sales-ai.git`), run this command on your EC2 instance (`13.232.127.142`):

```bash
cd /var/www/company-scrapping && git checkout . && git pull origin main && npm run build && sudo systemctl restart salesai-backend && sudo systemctl restart nginx
```

---

## 🛠️ Why `git checkout .` is Included
`backend/app/serper_quota.json` is updated live at runtime on EC2 whenever search queries run. Running `git checkout .` discards temporary runtime file changes before pulling, preventing git merge conflicts.
