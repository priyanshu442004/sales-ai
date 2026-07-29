# 🔄 How to Redeploy Updates on EC2

Whenever you push new changes to GitHub (`https://github.com/priyanshu442004/sales-ai.git`), run this command on your EC2 instance (`13.232.127.142`):

```bash
cd /var/www/company-scrapping && git checkout . && git pull origin main && npm run build && sudo systemctl restart salesai-backend && sudo systemctl restart nginx
```

---

## 🐍 When Do You Need `pip install` or `alembic`?

* **Standard code/UI updates (95% of deployments):** No need to reinstall python packages! The command above is all you need.
* **If you added NEW Python packages to `requirements.txt`:**
  ```bash
  cd /var/www/company-scrapping/backend
  source venv/bin/activate
  pip install -r requirements.txt
  ```
* **If you added NEW database models/migrations:**
  ```bash
  cd /var/www/company-scrapping/backend
  source venv/bin/activate
  alembic upgrade head
  ```
