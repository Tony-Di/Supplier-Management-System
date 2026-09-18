import { pool } from "../server/db.js";

const email = process.argv[2];

if (!email) {
  console.error("Usage: npm run admin -- <email>");
  process.exit(1);
}

const client = await pool.connect();
try {
  const { rows } = await client.query(
    "UPDATE users SET role = 'admin', session_epoch = session_epoch + 1 WHERE lower(email) = lower($1) RETURNING email, name",
    [email],
  );
  if (rows.length === 0) {
    console.error(`No user with that address. They must sign in once before they can be promoted: ${email}`);
    process.exit(1);
  }
  console.log(`${rows[0].name} <${rows[0].email}> is now an admin.`);
} finally {
  client.release();
  await pool.end();
}
