# Hader Attendance: Floci deployment

This is **local AWS emulation**, not production AWS hosting. Our service uses:
1. **AWS Lambda**: runs `lambda.handler` (Node.js 22) with the Attendance Express routes
2. **API Gateway HTTP API**: exposes the Attendance REST routes
3. **CloudWatch Logs**: records function invocations and application log events
4. **IAM**: Lambda execution role restricted to its own CloudWatch log stream

All resource names start with `hader-attendance-`, avoiding teammates' registrations/certificates.

## Prerequisites (Windows 10/11 + PowerShell)
- Node.js 22, npm; already installed for the Attendance backend
- Docker Desktop **running** (Linux containers)
- AWS CLI v2 installed and available as `aws` in PowerShell
- The working local `.env` with `DATABASE_URL` (never commit it)
- Internet access to Supabase from Floci Lambda containers
- Already working `test-db.js` and the Supabase CA certificate

## Steps

From `D:\uni\Hader-attendance-backend` in VS Code:

```powershell
git pull origin main
npm install serverless-http
npm install --save-dev archiver
docker compose -f infra/docker-compose.floci.yml up -d
docker compose -f infra/docker-compose.floci.yml ps
.\infra\deploy-attendance.ps1
```

The deployment script forces **dummy credentials**, targets **http://localhost:4566**, and refuses to run unless STS identifies Floci's local account `000000000000`. It creates/updates your own IAM role, Lambda, log group, and HTTP API. The generated ZIP **excludes** `.env`. Your database URL is temporarily transferred to the local Lambda configuration and never printed.

The final output should show an API address such as:

`http://<api-id>.execute-api.localhost.floci.io:4566/health`

Test **GET /health** in a browser. Expect `status: ok` and `database: connected` when the Lambda can reach Supabase.

After invoking the Lambda, check the logs:

```powershell
$env:AWS_ACCESS_KEY_ID="test"
$env:AWS_SECRET_ACCESS_KEY="test"
$env:AWS_DEFAULT_REGION="us-east-1"
aws logs tail /aws/lambda/hader-attendance-api --since 15m --endpoint-url http://localhost:4566
```

If the log stream is empty, invoke your API at least once and recheck.

## Important

- The original `node server.js` and `node demo-server.js` continue to work. These are **not** replaced by Lambda deployment.
- Do **not** copy the login/account or PostgreSQL passwords to Github, screenshots, or report.
- The emulator persists its local state in a Docker volume; anyone with local Docker/Floci access may inspect Lambda environment variables. Use dedicated test credentials and rotate them before production.
- Do **not** confuse this with a public cloud deployment. Floci proves the architecture and AWS command/API integration locally.
- Screenshots of `aws lambda get-function`, `aws apigatewayv2 get-apis`, `aws iam get-role`, and `aws logs tail` are useful for the coursework demonstration.
- API Gateway currently forwards to the **same Supabase project** used by the local backend, so avoid destructive tests against real teammates' registrations.

Official docs: https://floci.io/floci/getting-started/quick-start/ and https://floci.io/floci/services/api-gateway/
