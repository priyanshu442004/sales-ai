# 🔄 How to Redeploy Updates on EC2

Whenever you push new changes to GitHub (`https://github.com/priyanshu442004/sales-ai.git`), run this single command on your EC2 instance (`13.232.127.142`):

```bash
cd /var/www/company-scrapping && git pull origin main && npm run build && sudo systemctl restart salesai-backend && sudo systemctl restart nginx
```

---

## 🛠️ Recent Fix (CORS & Loopback Error)
The frontend API client URL was updated from `http://localhost:8000/api/v1` to relative path `/api/v1`. 

This routes all API requests seamlessly through Nginx on domain `https://aisalesagent.analytx4t.com/api/v1/...`, resolving all browser CORS, HTTPS mixed content, and loopback block errors.
