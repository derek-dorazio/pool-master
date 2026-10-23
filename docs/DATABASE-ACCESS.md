# Database Access

How an operator queries an environment's PostgreSQL from a Mac. The database has no public
endpoint: a small host in the VPC forwards a local port to it over AWS Session Manager, signed in
with your own AWS credentials. There are no SSH keys and no open inbound ports. The host is
`infrastructure/terraform/db-access.tf`, turned on per environment with
`db_access_host_enabled = true`; `infrastructure/terraform/README.md` covers the Terraform side.

Credentials are not in this repo. Database user names and passwords live in the operator's
password manager.

## One-time setup

1. Install the AWS CLI's Session Manager plugin and the PostgreSQL client:

   ```bash
   brew install --cask session-manager-plugin
   brew install libpq
   ```

   `libpq` provides `psql` and is keg-only, so the aliases below put its folder on `PATH`.

2. Optionally install a GUI client. DBeaver Community is free:
   `brew install --cask dbeaver-community`.

3. Add the aliases. Run this from the repository root, since the tunnel alias records where the
   repository is. Replace `<master user>` and `<read-only user>` with the user names from your
   password manager:

   ```bash
   cat >> ~/.zshrc <<ZSHRC

   # Poolmaster QA database (start tunnel-poolmaster-qa first)
   export PATH="/opt/homebrew/opt/libpq/bin:\$PATH"
   alias tunnel-poolmaster-qa='$(pwd)/scripts/db-tunnel.sh qa'
   alias psql-poolmaster-qa='psql "host=localhost port=15432 dbname=poolmaster user=<master user> sslmode=require"'
   alias psql-poolmaster-qa-ro='psql "host=localhost port=15432 dbname=poolmaster user=<read-only user> sslmode=require"'
   ZSHRC
   source ~/.zshrc
   ```

## Connecting

1. Start the tunnel and leave its terminal open. It prints `Waiting for connections...` once
   `localhost:15432` is forwarded, and Ctrl+C closes it:

   ```bash
   tunnel-poolmaster-qa
   ```

2. In another terminal, open a prompt. Use the read-only alias for everyday queries:

   ```bash
   psql-poolmaster-qa-ro
   ```

   Each alias asks for its user's password.

3. Or connect a GUI client. In DBeaver: New Database Connection, PostgreSQL, host `localhost`,
   port `15432`, database `poolmaster`, the read-only user. On the SSL tab, set SSL mode to
   `require`, and tick Read-only connection on the General tab.

RDS requires TLS. Use `sslmode=require`: `verify-full` fails the hostname check, because the
client connects to `localhost`.

## The read-only user

Each environment has one read-only database user, created once by the master user, with the SQL
in `infrastructure/terraform/README.md` *Direct QA Database Access*. It can read every table,
including password hashes and reset and refresh tokens, so guard its password like the master's.
Use the master user only for administrative work.

## Rotating the master password

The master password is the `db_password` Terraform variable. An apply sets it on RDS at once and
writes a new `DATABASE_URL` into new core-api and migrate task definition revisions, but the
running service picks those up only on its next deploy (`infrastructure/terraform/README.md`
*How Terraform's Task Definition Env Reaches the Service*). Until then the app cannot open new
database connections, so apply shortly before a merge to `main`, or run the deploy workflow
straight after.

From `infrastructure/terraform`, with `TF_VAR_jwt_secret` set to the existing value:

```bash
NEWPW=$(openssl rand -hex 24)
sed -i '' "s/^db_password .*/db_password            = \"$NEWPW\"/" envs/<env>.tfvars
echo "$NEWPW" | pbcopy
terraform plan -var-file=envs/<env>.tfvars -out=rotate.plan
```

`sed` rewrites the existing `db_password` line in your local, uncommitted tfvars file, and
`pbcopy` puts the new password on the clipboard for your password manager. Hex keeps it safe
inside `DATABASE_URL` without URL encoding. The plan should change only the RDS password and the
core-api and migrate task definitions; apply it with `terraform apply rotate.plan`. The read-only
user's password is separate and unaffected.

## Troubleshooting

| Message | Cause |
|---|---|
| `No running poolmaster-qa-db-access instance` | The environment's Terraform has not been applied with `db_access_host_enabled = true`. |
| `SessionManagerPlugin is not found` | The plugin isn't installed, or the terminal was opened before it was. Install it and open a new terminal. |
| `TargetNotConnected` | The host was just created or restarted and hasn't registered with Session Manager yet. Wait a minute and retry. |
| `connection refused` on `localhost:15432` | The tunnel isn't running. |
