@echo off
REM MnemoPay Daily Marketing — runs via Task Scheduler
REM Posts 2 tweets/day + checks email follow-ups
REM
REM Required env vars (set in Windows Environment Variables, NOT here):
REM   TWITTER_API_KEY, TWITTER_API_SECRET
REM   TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET
REM   GROQ_API_KEY, DEVTO_API_KEY, RESEND_API_KEY

cd /d C:\Users\bizsu\Projects\mnemopay-sdk\marketing

REM Post 2 tweets
node daily-marketing.js daily >> data\cron.log 2>&1

REM Check and send email follow-ups
node email-followup.js send >> data\cron.log 2>&1

echo [%date% %time%] Daily marketing complete >> data\cron.log
