import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { sequelize, User, Group, GroupMembership } from './models/index.js';

const MEMBERS = [
  { name: 'Aisha', email: 'aisha@example.com', joinedAt: '2026-02-01', leftAt: null },
  { name: 'Rohan', email: 'rohan@example.com', joinedAt: '2026-02-01', leftAt: null },
  { name: 'Priya', email: 'priya@example.com', joinedAt: '2026-02-01', leftAt: null },
  { name: 'Meera', email: 'meera@example.com', joinedAt: '2026-02-01', leftAt: '2026-03-31' },
  { name: 'Dev', email: 'dev@example.com', joinedAt: '2026-03-08', leftAt: '2026-03-12' },
  { name: 'Sam', email: 'sam@example.com', joinedAt: '2026-04-08', leftAt: null },
];

const DEFAULT_PASSWORD = 'password123';

async function main() {
  await sequelize.sync({ force: true });

  const group = await Group.create({ name: 'Flat 4B', baseCurrency: 'INR' });

  for (const m of MEMBERS) {
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const user = await User.create({ name: m.name, email: m.email, passwordHash });
    await GroupMembership.create({
      GroupId: group.id,
      UserId: user.id,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
    });
  }

  console.log(`Seeded group "${group.name}" (id=${group.id}) with ${MEMBERS.length} members.`);
  console.log(`All users have password: ${DEFAULT_PASSWORD}`);
  console.log('Emails:', MEMBERS.map((m) => m.email).join(', '));
  await sequelize.close();
}

main();
